"""Trusted launcher and result validator for the isolated file-worker image."""

import asyncio
import hashlib
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from app.core.config import get_settings
from app.file_worker import PROTOCOL_VERSION, WORKER_VERSION
from app.file_worker.protocol import (
    FileWorkerManifest,
    FileWorkerResult,
    FileWorkerStatus,
)


class FileWorkerError(Exception):
    code = "FILE_WORKER_ERROR"


class FileWorkerTimeoutError(FileWorkerError):
    code = "FILE_WORKER_TIMEOUT"


class FileWorkerResultError(FileWorkerError):
    code = "FILE_WORKER_RESULT_INVALID"


class FileWorkerRejectedError(FileWorkerError):
    code = "FILE_WORKER_REJECTED"


@dataclass(frozen=True)
class ValidatedFileWorkerOutput:
    result: FileWorkerResult
    artifacts: dict[str, bytes]


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def _remove_container(container_name: str, environment: dict[str, str]) -> None:
    cleanup = await asyncio.create_subprocess_exec(
        "docker",
        "rm",
        "-f",
        container_name,
        env=environment,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await cleanup.wait()


def validate_file_worker_output(
    *,
    manifest: FileWorkerManifest,
    output_root: Path,
) -> ValidatedFileWorkerOutput:
    try:
        result = FileWorkerResult.model_validate_json(
            (output_root / "result.json").read_bytes()
        )
    except (OSError, ValidationError) as exc:
        raise FileWorkerResultError("Missing or invalid file-worker result.") from exc
    if result.job_id != manifest.job_id or result.input_sha256 != manifest.input.sha256:
        raise FileWorkerResultError("Result identity does not match the manifest.")
    expected_versions = {
        "file_worker": WORKER_VERSION,
        "protocol": PROTOCOL_VERSION,
    }
    if any(result.tool_versions.get(key) != value for key, value in expected_versions.items()):
        raise FileWorkerResultError("File-worker tool versions do not match the contract.")
    artifacts: dict[str, bytes] = {}
    total_output_bytes = 0
    for descriptor in result.artifacts:
        artifact_path = (output_root / descriptor.path).resolve()
        try:
            artifact_path.relative_to(output_root.resolve())
            data = artifact_path.read_bytes()
        except (OSError, ValueError) as exc:
            raise FileWorkerResultError("Artifact escapes or is missing from output root.") from exc
        if (
            len(data) != descriptor.size_bytes
            or _sha256(data) != descriptor.sha256
        ):
            raise FileWorkerResultError("Artifact checksum or size validation failed.")
        total_output_bytes += len(data)
        if total_output_bytes > manifest.limits.max_output_bytes:
            raise FileWorkerResultError("Artifacts exceed the total output limit.")
        artifacts[descriptor.path] = data
    if result.status is FileWorkerStatus.rejected:
        raise FileWorkerRejectedError(result.error_code or "File rejected.")
    if result.status is not FileWorkerStatus.succeeded or not result.security_passed:
        raise FileWorkerResultError(result.error_code or "File worker failed.")
    return ValidatedFileWorkerOutput(result=result, artifacts=artifacts)


async def run_isolated_file_worker(
    *,
    manifest: FileWorkerManifest,
    input_data: bytes,
) -> ValidatedFileWorkerOutput:
    settings = get_settings()
    if len(input_data) != manifest.input.size_bytes or _sha256(input_data) != manifest.input.sha256:
        raise FileWorkerResultError("Trusted input does not match the manifest.")
    with tempfile.TemporaryDirectory(prefix="vhb-file-worker-") as temporary:
        root = Path(temporary)
        input_root = root / "input"
        output_root = root / "output"
        input_root.mkdir(mode=0o700)
        output_root.mkdir(mode=0o700)
        (input_root / manifest.input.path).write_bytes(input_data)
        (input_root / "manifest.json").write_text(
            manifest.model_dump_json(),
            encoding="utf-8",
        )
        container_name = f"vhb-file-worker-{manifest.job_id.hex}"
        command = [
            "docker",
            "run",
            "--rm",
            "--name",
            container_name,
            "--network",
            "none",
            "--read-only",
            "--user",
            f"{os.getuid()}:{os.getgid()}",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--pids-limit",
            str(settings.file_worker_pids_limit),
            "--memory",
            settings.file_worker_memory,
            "--cpus",
            str(settings.file_worker_cpus),
            "--tmpfs",
            f"/tmp:rw,noexec,nosuid,size={settings.file_worker_tmpfs}",
            "--mount",
            f"type=bind,src={input_root},dst=/work/input,readonly",
            "--mount",
            f"type=bind,src={output_root},dst=/work/output",
            settings.file_worker_image,
            "--manifest",
            "/work/input/manifest.json",
            "--input-root",
            "/work/input",
            "--output-root",
            "/work/output",
        ]
        safe_environment = {
            key: value
            for key, value in os.environ.items()
            if key in {"PATH", "DOCKER_HOST", "DOCKER_CONTEXT"}
        }
        process = await asyncio.create_subprocess_exec(
            *command,
            env=safe_environment,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=manifest.limits.wall_time_seconds,
            )
        except TimeoutError as exc:
            process.kill()
            await process.wait()
            await _remove_container(container_name, safe_environment)
            raise FileWorkerTimeoutError("File worker exceeded its wall-time limit.") from exc
        except asyncio.CancelledError:
            process.kill()
            await process.wait()
            await _remove_container(container_name, safe_environment)
            raise
        if process.returncode not in {0, 2, 3}:
            safe_error = (stderr or b"").decode(errors="replace")[:500]
            raise FileWorkerResultError(
                f"File worker exited unexpectedly ({process.returncode}): {safe_error}"
            )
        return validate_file_worker_output(manifest=manifest, output_root=output_root)
