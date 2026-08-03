"""One-shot isolated file worker.

The process reads one manifest and one mounted input, then writes one result
and optional artifact. It has no storage, database, or network client.
"""

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
from pathlib import Path

from pydantic import ValidationError

from app.file_worker import PROTOCOL_VERSION, WORKER_VERSION
from app.file_worker.order_list_renderer import render_order_list
from app.file_worker.protocol import (
    ArtifactDescriptor,
    FileOperation,
    FileWorkerManifest,
    FileWorkerResult,
    FileWorkerStatus,
)
from app.file_worker.scanner import inspect_file

FORBIDDEN_CREDENTIAL_ENV = {
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "REDIS_URL",
    "JWT_SECRET",
    "STORAGE_ACCESS_KEY",
    "STORAGE_SECRET_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE",
    "SMTP_PASSWORD",
}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _tool_versions() -> dict[str, str]:
    return {
        "file_worker": WORKER_VERSION,
        "protocol": PROTOCOL_VERSION,
        "python": platform.python_version(),
    }


def _write_json(path: Path, payload: dict[str, object]) -> None:
    encoded = json.dumps(
        payload,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_bytes(encoded)
    temporary.replace(path)


def _result(
    manifest: FileWorkerManifest,
    *,
    status: FileWorkerStatus,
    security_passed: bool,
    input_sha256: str,
    detected_content_type: str | None = None,
    findings: list[object] | None = None,
    artifacts: list[ArtifactDescriptor] | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> FileWorkerResult:
    return FileWorkerResult(
        job_id=manifest.job_id,
        status=status,
        input_sha256=input_sha256,
        security_passed=security_passed,
        detected_content_type=detected_content_type,
        findings=findings or [],
        artifacts=artifacts or [],
        tool_versions=_tool_versions(),
        error_code=error_code,
        error_message=error_message,
    )


def run(manifest_path: Path, input_root: Path, output_root: Path) -> int:
    output_root.mkdir(parents=True, exist_ok=True)
    try:
        manifest = FileWorkerManifest.model_validate_json(manifest_path.read_bytes())
    except (OSError, ValidationError) as exc:
        print(f"invalid manifest: {type(exc).__name__}", file=sys.stderr)
        return 3

    forbidden = sorted(name for name in FORBIDDEN_CREDENTIAL_ENV if os.environ.get(name))
    if forbidden:
        result = _result(
            manifest,
            status=FileWorkerStatus.failed,
            security_passed=False,
            input_sha256=manifest.input.sha256,
            error_code="FORBIDDEN_CREDENTIAL_ENV",
            error_message="Credential-bearing environment variables are not permitted.",
        )
        _write_json(output_root / "result.json", result.model_dump(mode="json"))
        return 3

    input_path = input_root / manifest.input.path
    try:
        input_path.resolve().relative_to(input_root.resolve())
        data = input_path.read_bytes()
    except (OSError, ValueError):
        result = _result(
            manifest,
            status=FileWorkerStatus.failed,
            security_passed=False,
            input_sha256=manifest.input.sha256,
            error_code="INPUT_UNAVAILABLE",
            error_message="Input is unavailable inside the mounted input root.",
        )
        _write_json(output_root / "result.json", result.model_dump(mode="json"))
        return 3

    actual_hash = _sha256(data)
    if len(data) != manifest.input.size_bytes or actual_hash != manifest.input.sha256:
        result = _result(
            manifest,
            status=FileWorkerStatus.rejected,
            security_passed=False,
            input_sha256=actual_hash,
            findings=[
                {
                    "code": "INPUT_INTEGRITY_MISMATCH",
                    "severity": "blocked",
                    "message": "Input size or checksum does not match the manifest.",
                }
            ],
            error_code="INPUT_INTEGRITY_MISMATCH",
            error_message="Input integrity validation failed.",
        )
        _write_json(output_root / "result.json", result.model_dump(mode="json"))
        return 2

    inspection = inspect_file(
        data,
        filename=manifest.input.filename,
        declared_content_type=manifest.input.content_type,
        limits=manifest.limits,
        security=manifest.security,
        include_tabular_metadata=manifest.operation is FileOperation.tabular_inspect,
    )
    if not inspection.passed:
        result = _result(
            manifest,
            status=FileWorkerStatus.rejected,
            security_passed=False,
            input_sha256=actual_hash,
            detected_content_type=inspection.detected_content_type,
            findings=list(inspection.findings),
            error_code="SECURITY_POLICY_REJECTED",
            error_message="Input was rejected by the file security policy.",
        )
        _write_json(output_root / "result.json", result.model_dump(mode="json"))
        return 2

    artifacts: list[ArtifactDescriptor] = []
    if manifest.operation is FileOperation.tabular_inspect:
        artifact_data = json.dumps(
            inspection.metadata,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        if len(artifact_data) > manifest.limits.max_output_bytes:
            result = _result(
                manifest,
                status=FileWorkerStatus.failed,
                security_passed=False,
                input_sha256=actual_hash,
                error_code="OUTPUT_SIZE_EXCEEDED",
                error_message="Generated artifact exceeds the configured output limit.",
            )
            _write_json(output_root / "result.json", result.model_dump(mode="json"))
            return 3
        artifact_path = output_root / "tabular-inspection.json"
        artifact_path.write_bytes(artifact_data)
        artifacts.append(
            ArtifactDescriptor(
                path=artifact_path.name,
                content_type="application/json",
                size_bytes=len(artifact_data),
                sha256=_sha256(artifact_data),
            )
        )
    elif manifest.operation is FileOperation.order_list_render:
        try:
            artifacts = render_order_list(
                data,
                output_root=output_root,
                timeout_seconds=max(manifest.limits.wall_time_seconds - 5, 1),
            )
        except (OSError, RuntimeError, subprocess.SubprocessError, ValidationError):
            result = _result(
                manifest,
                status=FileWorkerStatus.failed,
                security_passed=False,
                input_sha256=actual_hash,
                detected_content_type=inspection.detected_content_type,
                findings=list(inspection.findings),
                error_code="ORDER_LIST_RENDER_FAILED",
                error_message="Order List input or renderer output is invalid.",
            )
            _write_json(output_root / "result.json", result.model_dump(mode="json"))
            return 3
        if sum(item.size_bytes for item in artifacts) > manifest.limits.max_output_bytes:
            result = _result(
                manifest,
                status=FileWorkerStatus.failed,
                security_passed=False,
                input_sha256=actual_hash,
                detected_content_type=inspection.detected_content_type,
                findings=list(inspection.findings),
                error_code="OUTPUT_SIZE_EXCEEDED",
                error_message="Generated artifacts exceed the configured output limit.",
            )
            _write_json(output_root / "result.json", result.model_dump(mode="json"))
            return 3
    result = _result(
        manifest,
        status=FileWorkerStatus.succeeded,
        security_passed=True,
        input_sha256=actual_hash,
        detected_content_type=inspection.detected_content_type,
        findings=list(inspection.findings),
        artifacts=artifacts,
    )
    _write_json(output_root / "result.json", result.model_dump(mode="json"))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--input-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    raise SystemExit(run(args.manifest, args.input_root, args.output_root))


if __name__ == "__main__":
    main()
