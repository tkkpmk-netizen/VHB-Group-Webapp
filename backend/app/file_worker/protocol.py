"""Bounded manifest/result protocol shared by trusted and isolated workers."""

import enum
import re
import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.file_worker import PROTOCOL_VERSION

SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")


class FileOperation(enum.StrEnum):
    scan = "file.scan"
    tabular_inspect = "tabular.inspect"
    order_list_render = "document.order_list.render"


class FormulaPolicy(enum.StrEnum):
    reject = "reject"
    preserve_as_value = "preserve_as_value"


class FileWorkerStatus(enum.StrEnum):
    succeeded = "succeeded"
    rejected = "rejected"
    failed = "failed"
    cancelled = "cancelled"


class FindingSeverity(enum.StrEnum):
    info = "info"
    warning = "warning"
    blocked = "blocked"


def _safe_relative_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    parts = normalized.split("/")
    if (
        not normalized
        or normalized.startswith("/")
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise ValueError("Path must be a normalized relative path")
    return normalized


class InputDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1, max_length=500)
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=200)
    size_bytes: int = Field(ge=1, le=250 * 1024 * 1024)
    sha256: str

    @model_validator(mode="after")
    def validate_descriptor(self) -> "InputDescriptor":
        self.path = _safe_relative_path(self.path)
        if not SHA256_PATTERN.fullmatch(self.sha256):
            raise ValueError("sha256 must be lowercase hexadecimal")
        return self


class ResourceLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_input_bytes: int = Field(default=100 * 1024 * 1024, ge=1, le=250 * 1024 * 1024)
    max_expanded_bytes: int = Field(
        default=250 * 1024 * 1024,
        ge=1,
        le=1024 * 1024 * 1024,
    )
    max_output_bytes: int = Field(default=25 * 1024 * 1024, ge=1, le=100 * 1024 * 1024)
    max_archive_entries: int = Field(default=10_000, ge=1, le=50_000)
    max_archive_ratio: float = Field(default=100.0, ge=1.0, le=1000.0)
    wall_time_seconds: int = Field(default=60, ge=1, le=900)


class SecurityPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allow_macros: Literal[False] = False
    allow_external_links: Literal[False] = False
    formula_policy: FormulaPolicy = FormulaPolicy.reject


class FileWorkerManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protocol_version: Literal["1.0"] = PROTOCOL_VERSION
    job_id: uuid.UUID
    operation: FileOperation
    input: InputDescriptor
    limits: ResourceLimits = Field(default_factory=ResourceLimits)
    security: SecurityPolicy = Field(default_factory=SecurityPolicy)
    options: dict[str, Any] = Field(default_factory=dict)


class SecurityFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,99}$")
    severity: FindingSeverity
    message: str = Field(min_length=1, max_length=500)
    location: str | None = Field(default=None, max_length=500)


class ArtifactDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1, max_length=500)
    content_type: str = Field(min_length=1, max_length=200)
    size_bytes: int = Field(ge=0, le=100 * 1024 * 1024)
    sha256: str

    @model_validator(mode="after")
    def validate_artifact(self) -> "ArtifactDescriptor":
        self.path = _safe_relative_path(self.path)
        if not SHA256_PATTERN.fullmatch(self.sha256):
            raise ValueError("sha256 must be lowercase hexadecimal")
        return self


class FileWorkerResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protocol_version: Literal["1.0"] = PROTOCOL_VERSION
    job_id: uuid.UUID
    status: FileWorkerStatus
    input_sha256: str
    security_passed: bool
    detected_content_type: str | None = Field(default=None, max_length=200)
    findings: list[SecurityFinding] = Field(default_factory=list, max_length=500)
    artifacts: list[ArtifactDescriptor] = Field(default_factory=list, max_length=20)
    tool_versions: dict[str, str] = Field(min_length=1, max_length=20)
    error_code: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]{1,99}$")
    error_message: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_result(self) -> "FileWorkerResult":
        if not SHA256_PATTERN.fullmatch(self.input_sha256):
            raise ValueError("input_sha256 must be lowercase hexadecimal")
        if self.status is FileWorkerStatus.succeeded:
            if not self.security_passed or self.error_code is not None:
                raise ValueError("Succeeded results require a clean security result")
        elif self.security_passed:
            raise ValueError("Non-succeeded results cannot pass security")
        if self.status is FileWorkerStatus.rejected and not self.findings:
            raise ValueError("Rejected results require at least one finding")
        return self
