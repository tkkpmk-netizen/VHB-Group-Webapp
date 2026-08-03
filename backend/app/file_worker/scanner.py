"""Static, non-executing inspection for supported untrusted file formats."""

import csv
import io
import json
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree

from app.file_worker.protocol import (
    FindingSeverity,
    FormulaPolicy,
    ResourceLimits,
    SecurityFinding,
    SecurityPolicy,
)

ZIP_SIGNATURES = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")
PDF_SIGNATURE = b"%PDF-"
OLE_SIGNATURE = bytes.fromhex("D0CF11E0A1B11AE1")


@dataclass(frozen=True)
class Inspection:
    detected_content_type: str | None
    findings: list[SecurityFinding]
    metadata: dict[str, object]

    @property
    def passed(self) -> bool:
        return not any(item.severity is FindingSeverity.blocked for item in self.findings)


def _finding(
    code: str,
    message: str,
    *,
    location: str | None = None,
    severity: FindingSeverity = FindingSeverity.blocked,
) -> SecurityFinding:
    return SecurityFinding(
        code=code,
        severity=severity,
        message=message,
        location=location,
    )


def _detect(data: bytes, filename: str) -> str | None:
    suffix = Path(filename).suffix.casefold()
    if data.startswith(ZIP_SIGNATURES):
        if suffix == ".xlsx":
            return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if suffix == ".docx":
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        return "application/zip"
    if data.startswith(PDF_SIGNATURE):
        return "application/pdf"
    if data.startswith(OLE_SIGNATURE):
        return "application/x-ole-storage"
    if suffix == ".csv":
        return "text/csv"
    if suffix == ".json":
        try:
            json.loads(data)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return "application/json"
    return None


def _extension_matches(filename: str, detected: str | None) -> bool:
    expected = {
        ".csv": "text/csv",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".pdf": "application/pdf",
        ".json": "application/json",
    }
    suffix = Path(filename).suffix.casefold()
    return suffix in expected and expected[suffix] == detected


def _inspect_archive(
    data: bytes,
    *,
    limits: ResourceLimits,
    security: SecurityPolicy,
) -> tuple[list[SecurityFinding], dict[str, object]]:
    findings: list[SecurityFinding] = []
    expanded = 0
    has_formula = False
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        entry_names = {item.filename.replace("\\", "/") for item in entries}
        if len(entries) > limits.max_archive_entries:
            findings.append(
                _finding(
                    "ARCHIVE_ENTRY_LIMIT_EXCEEDED",
                    "Archive contains too many entries.",
                )
            )
        for entry in entries[: limits.max_archive_entries + 1]:
            normalized = entry.filename.replace("\\", "/")
            path = PurePosixPath(normalized)
            if path.is_absolute() or ".." in path.parts:
                findings.append(
                    _finding(
                        "ARCHIVE_PATH_TRAVERSAL",
                        "Archive entry escapes the extraction root.",
                        location=normalized[:500],
                    )
                )
            expanded += entry.file_size
            if expanded > limits.max_expanded_bytes:
                findings.append(
                    _finding(
                        "ARCHIVE_EXPANDED_SIZE_EXCEEDED",
                        "Expanded archive exceeds the configured limit.",
                    )
                )
                break
            ratio = entry.file_size / max(entry.compress_size, 1)
            if ratio > limits.max_archive_ratio:
                findings.append(
                    _finding(
                        "ARCHIVE_RATIO_EXCEEDED",
                        "Archive entry compression ratio exceeds the configured limit.",
                        location=normalized[:500],
                    )
                )
            if entry.flag_bits & 0x1:
                findings.append(
                    _finding(
                        "ARCHIVE_ENCRYPTED_ENTRY",
                        "Encrypted archive entries are not supported.",
                        location=normalized[:500],
                    )
                )
                continue
            lowered = normalized.casefold()
            if lowered.endswith("vbaproject.bin") and not security.allow_macros:
                findings.append(
                    _finding(
                        "MACRO_BLOCKED",
                        "Embedded macros are not permitted.",
                        location=normalized,
                    )
                )
            if (
                lowered.startswith("xl/externallinks/")
                or lowered.startswith("word/externallinks/")
            ) and not security.allow_external_links:
                findings.append(
                    _finding(
                        "EXTERNAL_LINK_BLOCKED",
                        "External document links are not permitted.",
                        location=normalized,
                    )
                )
            if lowered.endswith(".rels") and not security.allow_external_links:
                relationship_xml = archive.read(entry)
                if b'TargetMode="External"' in relationship_xml:
                    findings.append(
                        _finding(
                            "EXTERNAL_LINK_BLOCKED",
                            "External relationship targets are not permitted.",
                            location=normalized,
                        )
                    )
            if lowered.startswith("xl/worksheets/") and lowered.endswith(".xml"):
                xml = archive.read(entry)
                if b"<f" in xml:
                    has_formula = True
    if has_formula and security.formula_policy is FormulaPolicy.reject:
        findings.append(_finding("FORMULA_BLOCKED", "Spreadsheet formulas are not permitted."))
    return findings, {
        "archive_entries": min(len(entries), limits.max_archive_entries + 1),
        "expanded_bytes": expanded,
        "contains_formulas": has_formula,
        "xlsx_package": {
            "[Content_Types].xml",
            "xl/workbook.xml",
        }.issubset(entry_names),
        "docx_package": {
            "[Content_Types].xml",
            "word/document.xml",
        }.issubset(entry_names),
    }


def _inspect_csv(data: bytes) -> dict[str, object]:
    text = data.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text))
    row_count = 0
    column_count = 0
    headers: list[str] = []
    for row in reader:
        if row_count == 0:
            headers = [str(value)[:200] for value in row[:500]]
        row_count += 1
        column_count = max(column_count, len(row))
        if row_count > 100_001:
            break
    return {
        "row_count": max(row_count - 1, 0),
        "column_count": column_count,
        "headers": headers,
        "truncated": row_count > 100_000,
    }


def _xlsx_dimensions(data: bytes) -> dict[str, object]:
    row_count = 0
    column_count = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        worksheet_names = sorted(
            name
            for name in archive.namelist()
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
        )
        if worksheet_names:
            root = ElementTree.fromstring(archive.read(worksheet_names[0]))
            namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            rows = root.findall(".//x:sheetData/x:row", namespace)
            row_count = max(len(rows) - 1, 0)
            column_count = max(
                (len(row.findall("x:c", namespace)) for row in rows),
                default=0,
            )
    return {
        "row_count": row_count,
        "column_count": column_count,
        "worksheet_count": len(worksheet_names),
    }


def inspect_file(
    data: bytes,
    *,
    filename: str,
    declared_content_type: str,
    limits: ResourceLimits,
    security: SecurityPolicy,
    include_tabular_metadata: bool,
) -> Inspection:
    findings: list[SecurityFinding] = []
    metadata: dict[str, object] = {}
    detected = _detect(data, filename)
    if not _extension_matches(filename, detected):
        findings.append(
            _finding(
                "CONTENT_EXTENSION_MISMATCH",
                "File extension does not match its signature or supported text format.",
            )
        )
    if detected != declared_content_type:
        findings.append(
            _finding(
                "DECLARED_CONTENT_TYPE_MISMATCH",
                "Declared content type does not match detected content.",
            )
        )
    if len(data) > limits.max_input_bytes:
        findings.append(_finding("INPUT_SIZE_EXCEEDED", "Input exceeds the configured limit."))
    if detected in {
        "application/zip",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }:
        try:
            archive_findings, archive_metadata = _inspect_archive(
                data,
                limits=limits,
                security=security,
            )
            findings.extend(archive_findings)
            metadata.update(archive_metadata)
            if (
                detected
                == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                and not metadata.get("xlsx_package")
            ) or (
                detected
                == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                and not metadata.get("docx_package")
            ):
                findings.append(
                    _finding(
                        "OFFICE_PACKAGE_MISMATCH",
                        "Office archive does not contain the required package structure.",
                    )
                )
        except (zipfile.BadZipFile, ElementTree.ParseError):
            findings.append(_finding("ARCHIVE_MALFORMED", "Archive structure is malformed."))
    if detected == "application/x-ole-storage":
        findings.append(
            _finding("LEGACY_OFFICE_BLOCKED", "Legacy OLE Office files are unsupported.")
        )
    if detected == "text/csv":
        try:
            decoded = data.decode("utf-8-sig")
            if "\x00" in decoded:
                findings.append(
                    _finding("TEXT_BINARY_CONTENT", "CSV contains binary null bytes.")
                )
            elif security.formula_policy is FormulaPolicy.reject:
                reader = csv.reader(io.StringIO(decoded))
                if any(
                    str(value).startswith(("=", "+", "-", "@"))
                    for row_index, row in enumerate(reader)
                    for value in row
                    if row_index <= 100_000
                ):
                    findings.append(
                        _finding("FORMULA_BLOCKED", "CSV formula-like cells are not permitted.")
                    )
        except UnicodeDecodeError:
            findings.append(_finding("TEXT_ENCODING_INVALID", "CSV must be valid UTF-8."))
    if detected == "application/json":
        try:
            json.loads(data)
        except (UnicodeDecodeError, json.JSONDecodeError):
            findings.append(_finding("JSON_PARSE_FAILED", "JSON input is malformed."))
    if include_tabular_metadata and not findings:
        try:
            if detected == "text/csv":
                metadata.update(_inspect_csv(data))
            elif detected == (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ):
                metadata.update(_xlsx_dimensions(data))
            else:
                findings.append(
                    _finding(
                        "TABULAR_FORMAT_UNSUPPORTED",
                        "Tabular inspection supports CSV and XLSX only.",
                    )
                )
        except (UnicodeDecodeError, csv.Error, zipfile.BadZipFile, ElementTree.ParseError):
            findings.append(_finding("TABULAR_PARSE_FAILED", "Tabular input is malformed."))
    return Inspection(
        detected_content_type=detected,
        findings=findings,
        metadata=metadata,
    )
