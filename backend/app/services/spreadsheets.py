"""CSV/XLSX parsing and export for database transfer jobs."""

import csv
import io
import json
import re
import uuid
from datetime import UTC, date, datetime
from typing import Any, cast

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Database
from app.models.field import Entity, Field, FieldType
from app.services.database_history import (
    record_database_change,
    snapshot_entity,
)
from app.services.engine import CellValidationError, next_entity_seq, validate_required_fields

MAX_IMPORT_ROWS = 100_000
FORMULA_PREFIXES = ("=", "+", "-", "@")
CHOICE_FIELD_TYPES = {
    FieldType.select,
    FieldType.multi_select,
    FieldType.status,
    FieldType.priority,
}
READ_ONLY_IMPORT_TYPES = {
    FieldType.unique_id,
    FieldType.relation,
    FieldType.rollup,
    FieldType.formula,
}
CHOICE_COLORS = (
    "#2563eb",
    "#7c3aed",
    "#db2777",
    "#ea580c",
    "#16a34a",
    "#0891b2",
    "#64748b",
)


def read_tabular(data: bytes, file_format: str) -> tuple[list[str], list[list[Any]]]:
    records: list[list[Any]]
    if file_format == "csv":
        reader = csv.reader(io.StringIO(data.decode("utf-8-sig")))
        records = list(reader)
    else:
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        sheet = cast(Worksheet, workbook.active)
        records = [list(row) for row in sheet.iter_rows(values_only=True)]
        workbook.close()
    if not records:
        return [], []
    headers = [str(value or "").strip() for value in records[0]]
    rows = records[1 : MAX_IMPORT_ROWS + 1]
    return headers, rows


def _infer_type(values: list[Any]) -> FieldType:
    present = [value for value in values if value not in (None, "")]
    if present and all(
        isinstance(value, int | float) and not isinstance(value, bool) for value in present
    ):
        return FieldType.number
    return FieldType.text


def _parse_timestamp(value: Any) -> datetime | None:
    """Parse spreadsheet-native or common exported timestamp values."""
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, datetime.min.time())
    elif isinstance(value, int | float) and not isinstance(value, bool):
        numeric = float(value)
        if numeric > 1_000_000_000_000:
            parsed = datetime.fromtimestamp(numeric / 1000, tz=UTC)
        elif numeric > 1_000_000_000:
            parsed = datetime.fromtimestamp(numeric, tz=UTC)
        else:
            return None
    else:
        text = str(value or "").strip()
        if not text:
            return None
        normalized = text.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            parsed = None
            for pattern in (
                "%d/%m/%Y %H:%M:%S",
                "%d/%m/%Y %H:%M",
                "%d/%m/%Y",
                "%m/%d/%Y %H:%M:%S",
                "%m/%d/%Y %H:%M",
                "%m/%d/%Y",
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%d %H:%M",
            ):
                try:
                    parsed = datetime.strptime(text, pattern)
                    break
                except ValueError:
                    continue
            if parsed is None:
                return None
    if parsed is None:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _parse_number(value: Any) -> int | float | None:
    if isinstance(value, int | float) and not isinstance(value, bool):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    negative = text.startswith("(") and text.endswith(")")
    # Keep digits, decimal separators and a leading sign. A comma followed by
    # exactly three digits is treated as a thousands separator.
    cleaned = re.sub(r"[^0-9,.\-+]", "", text)
    if re.fullmatch(r"[-+]?\d{1,3}(,\d{3})+(\.\d+)?", cleaned):
        cleaned = cleaned.replace(",", "")
    elif "," in cleaned and "." not in cleaned:
        parts = cleaned.split(",")
        cleaned = (
            "".join(parts)
            if all(len(part) == 3 for part in parts[1:])
            else cleaned.replace(",", ".")
        )
    else:
        cleaned = cleaned.replace(",", "")
    try:
        result = float(cleaned)
    except ValueError:
        return None
    if negative:
        result = -abs(result)
    return int(result) if result.is_integer() else result


def _choice_labels(value: Any, *, multiple: bool) -> list[str]:
    if isinstance(value, list):
        values = value
    elif multiple:
        values = re.split(r"[,;|\n]", str(value))
    else:
        values = [value]
    return [str(item).strip() for item in values if str(item).strip()]


def _choice_options(values: list[Any], *, multiple: bool) -> list[dict[str, str]]:
    labels = list(
        dict.fromkeys(
            label for value in values for label in _choice_labels(value, multiple=multiple)
        )
    )
    return [
        {
            "id": str(uuid.uuid4()),
            "label": label,
            "color": CHOICE_COLORS[index % len(CHOICE_COLORS)],
        }
        for index, label in enumerate(labels)
    ]


def _normalize_import_value(field: Field, value: Any) -> Any:
    if value in (None, ""):
        return None
    if field.type in {
        FieldType.text,
        FieldType.long_text,
        FieldType.url,
        FieldType.email,
        FieldType.phone,
        FieldType.country,
        FieldType.name,
    }:
        return str(value)
    if field.type is FieldType.number:
        return _parse_number(value)
    if field.type is FieldType.rating:
        parsed = _parse_number(value)
        return max(1, min(5, int(parsed))) if parsed is not None else None
    if field.type is FieldType.progress:
        parsed = _parse_number(value)
        return max(0, min(100, parsed)) if parsed is not None else None
    if field.type is FieldType.checkbox:
        if isinstance(value, bool):
            return value
        return str(value).strip().casefold() in {"1", "true", "yes", "y", "x", "checked"}
    if field.type is FieldType.date:
        timestamp = _parse_timestamp(value)
        return timestamp.isoformat() if timestamp else None
    if field.type in CHOICE_FIELD_TYPES:
        choices = {
            str(choice.get("label", "")).casefold(): str(choice["id"])
            for choice in (field.options or {}).get("choices", [])
            if choice.get("id")
        }
        labels = _choice_labels(value, multiple=field.type is FieldType.multi_select)
        ids = [choices[label.casefold()] for label in labels if label.casefold() in choices]
        return ids if field.type is FieldType.multi_select else (ids[0] if ids else None)
    if field.type is FieldType.people:
        return [item.strip() for item in re.split(r"[,;]", str(value)) if item.strip()]
    if field.type is FieldType.files:
        if isinstance(value, list):
            return value
        try:
            parsed = json.loads(str(value))
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, list) else None
    return value


def _export_value(value: Any) -> str | int | float | bool | date | datetime | None:
    """Convert JSONB cell values into safe, portable spreadsheet values."""
    if value is None or isinstance(value, int | float | bool | date | datetime):
        return value
    if isinstance(value, str):
        # Prevent imported user content from becoming an executable spreadsheet formula.
        return f"'{value}" if value.startswith(FORMULA_PREFIXES) else value
    if isinstance(value, dict):
        start = value.get("start")
        end = value.get("end")
        if start is not None and set(value).issubset({"start", "end"}):
            return f"{start} → {end}" if end else str(start)
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if isinstance(value, list):
        if all(item is None or isinstance(item, str | int | float | bool) for item in value):
            return ", ".join("" if item is None else str(item) for item in value)
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return str(value)


def _export_field_value(
    field: Field, value: Any
) -> str | int | float | bool | date | datetime | None:
    """Resolve stored field identifiers into reader-facing spreadsheet values."""
    field_type = getattr(field, "type", None)
    if field_type not in CHOICE_FIELD_TYPES:
        return _export_value(value)

    choice_labels = {
        str(choice.get("id")): str(choice.get("label") or choice.get("id"))
        for choice in (getattr(field, "options", None) or {}).get("choices", [])
        if choice.get("id") is not None
    }

    def label_for(raw: Any) -> str:
        identifier = str(raw)
        return choice_labels.get(identifier, identifier)

    if field_type is FieldType.multi_select:
        values = value if isinstance(value, list) else ([] if value in (None, "") else [value])
        return _export_value([label_for(item) for item in values])
    if value in (None, ""):
        return _export_value(value)
    return _export_value(label_for(value))


async def import_entities(
    db: AsyncSession,
    *,
    database: Database,
    headers: list[str],
    records: list[list[Any]],
    mapping: dict[str, str],
    field_types: dict[str, str],
    skipped_columns: list[str],
    create_missing_fields: bool,
    data_source_id: uuid.UUID,
    created_data_source: bool,
    actor_id: uuid.UUID | None,
    name_column: str,
    include_rows: list[int] | None = None,
    incoming_duplicate_policy: str = "suffix",
    existing_name_policy: str = "suffix",
) -> dict[str, int]:
    result = await db.execute(
        select(Field).where(Field.database_id == database.id).order_by(Field.order)
    )
    fields = list(result.scalars())
    by_name = {field.name.casefold(): field for field in fields}
    by_id = {str(field.id): field for field in fields}
    if name_column not in headers:
        raise ValueError("A Name column must be selected before importing")
    name_index = headers.index(name_column)
    system_uid = next((f for f in fields if (f.options or {}).get("system_key") == "uid"), None)
    system_name = next((f for f in fields if (f.options or {}).get("system_key") == "name"), None)
    if system_name is None:
        raise ValueError("Database is missing its built-in Name field")

    original_field_count = len(fields)
    original_field_ids = {field.id for field in fields}
    skipped = set(skipped_columns)
    column_fields: list[Field | None] = []
    for index, header in enumerate(headers):
        if header in skipped:
            column_fields.append(None)
            continue
        mapped = by_id.get(mapping.get(header, ""))
        if header in mapping and mapped is None:
            raise ValueError(f'Field mapping for "{header}" no longer exists')
        field = mapped or by_name.get(header.casefold())
        if (
            field is not None
            and field.type in READ_ONLY_IMPORT_TYPES
            and field is not system_uid
        ):
            raise ValueError(
                f'{field.type.value} field "{field.name}" cannot receive imported cell values; '
                "choose Don't Import or create an editable field"
            )
        if field is system_name and header != name_column:
            raise ValueError(
                f'The built-in Name field can only receive the selected Name column, not "{header}"'
            )
        if field is None and create_missing_fields and header:
            values = [row[index] if index < len(row) else None for row in records]
            requested_type = FieldType(field_types.get(header, _infer_type(values)))
            if requested_type in READ_ONLY_IMPORT_TYPES or requested_type is FieldType.name:
                raise ValueError(
                    f'{requested_type.value} cannot be created from imported column "{header}"'
                )
            options: dict[str, Any] = {}
            if requested_type in CHOICE_FIELD_TYPES:
                options["choices"] = _choice_options(
                    values, multiple=requested_type is FieldType.multi_select
                )
            field = Field(
                database_id=database.id,
                name=header,
                type=requested_type,
                options=options,
                order=len(fields),
            )
            db.add(field)
            await db.flush()
            fields.append(field)
            by_name[header.casefold()] = field
        # UID/Name are system identity, not ordinary import target columns.
        column_fields.append(None if field is system_uid or field is system_name else field)

    auto_types = {
        FieldType.unique_id,
        FieldType.rollup,
        FieldType.formula,
        FieldType.created_time,
        FieldType.created_by,
        FieldType.last_edited_time,
        FieldType.last_edited_by,
    }
    required_fields = [
        field
        for field in fields
        if field.type not in auto_types
        and (field.options or {}).get("required") is True
        and field is not system_name
    ]
    mapped_field_ids = {field.id for field in column_fields if field is not None}
    missing_mappings = [field.name for field in required_fields if field.id not in mapped_field_ids]
    if missing_mappings:
        raise ValueError(f"Required field mapping missing: {', '.join(missing_mappings)}")

    selected = set(include_rows) if include_rows is not None else None
    indexed_records = [
        (index, record)
        for index, record in enumerate(records)
        if selected is None or index in selected
    ]
    entities_result = await db.execute(select(Entity).where(Entity.database_id == database.id))
    existing_by_name: dict[str, Entity] = {
        entity.name.casefold(): entity for entity in entities_result.scalars()
    }
    original_existing_by_name = dict(existing_by_name)
    taken_names = set(existing_by_name)
    seen_incoming: set[str] = set()

    def reserve_name(raw: Any) -> str:
        base_name = str(raw or "").strip()
        if not base_name:
            raise ValueError("Every imported entity needs a Name")
        if len(base_name) > 200:
            base_name = base_name[:200]
        candidate = base_name
        suffix = 2
        while candidate.casefold() in taken_names:
            candidate = f"{base_name[:190]} {suffix}"
            suffix += 1
        taken_names.add(candidate.casefold())
        return candidate

    base = await next_entity_seq(db, database.id) - 1
    imported = updated = skipped_rows = suffixed = 0
    created_entities: list[Entity] = []
    before_entities: dict[uuid.UUID, dict[str, Any]] = {}
    for _row_index, record in indexed_records:
        source_name = record[name_index] if name_index < len(record) else None
        raw_name = str(source_name or "").strip()
        if not raw_name:
            skipped_rows += 1
            continue
        key = raw_name.casefold()
        duplicate_in_file = key in seen_incoming
        seen_incoming.add(key)
        if duplicate_in_file and incoming_duplicate_policy == "skip":
            skipped_rows += 1
            continue
        data: dict[str, Any] = {}
        imported_created_at: datetime | None = None
        imported_updated_at: datetime | None = None
        for index, field in enumerate(column_fields):
            if field is None or index >= len(record):
                continue
            value = record[index]
            if value in (None, ""):
                continue
            if field.type is FieldType.created_time:
                imported_created_at = _parse_timestamp(value)
                continue
            if field.type is FieldType.last_edited_time:
                imported_updated_at = _parse_timestamp(value)
                continue
            normalized = _normalize_import_value(field, value)
            if normalized is not None:
                data[str(field.id)] = normalized
        existing = original_existing_by_name.get(key)
        if existing is not None and existing_name_policy == "update":
            before_entities.setdefault(existing.id, snapshot_entity(existing))
            next_data = {**existing.data, **data, str(system_name.id): existing.name}
            try:
                validate_required_fields(fields, next_data)
            except CellValidationError as exc:
                raise ValueError(f"Row {_row_index + 2}: {exc}") from exc
            existing.data = next_data
            if imported_created_at is not None:
                existing.created_at = imported_created_at
            if imported_updated_at is not None:
                existing.updated_at = imported_updated_at
            updated += 1
            continue
        name = reserve_name(raw_name)
        if name.casefold() != key:
            suffixed += 1
        seq = base + imported + 1
        uid = str(seq)
        data[str(system_name.id)] = name
        if system_uid is not None:
            data[str(system_uid.id)] = uid
        try:
            validate_required_fields(fields, data)
        except CellValidationError as exc:
            raise ValueError(f"Row {_row_index + 2}: {exc}") from exc
        entity = Entity(
            database_id=database.id,
            data_source_id=data_source_id,
            data=data,
            uid=uid,
            name=name,
            seq=seq,
            order=seq,
        )
        if imported_created_at is not None:
            entity.created_at = imported_created_at
        if imported_updated_at is not None:
            entity.updated_at = imported_updated_at
        elif imported_created_at is not None:
            entity.updated_at = imported_created_at
        db.add(entity)
        created_entities.append(entity)
        existing_by_name[name.casefold()] = entity
        imported += 1
        if (imported + updated) % 1000 == 0:
            await db.flush()
    await db.flush()
    created_fields = [field for field in fields if field.id not in original_field_ids]
    record_database_change(
        db,
        workspace_id=database.workspace_id,
        database_id=database.id,
        actor_id=actor_id,
        action="database.imported",
        summary=f"Imported {imported} entities and updated {updated}",
        before={"entities": list(before_entities.values())},
        created={
            "entities": [entity.id for entity in created_entities],
            "fields": [field.id for field in created_fields],
            "data_sources": [data_source_id] if created_data_source else [],
        },
    )
    await db.commit()
    return {
        "entities_imported": imported,
        "entities_updated": updated,
        "entities_skipped": skipped_rows,
        "entities_suffixed": suffixed,
        "fields_created": len(fields) - original_field_count,
    }


def export_entities(
    fields: list[Field], entities: list[Entity], file_format: str
) -> tuple[bytes, str]:
    headers = [field.name for field in fields]
    values = [
        [_export_field_value(field, entity.data.get(str(field.id))) for field in fields]
        for entity in entities
    ]
    if file_format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        writer.writerows(values)
        return output.getvalue().encode("utf-8-sig"), "text/csv"

    output_bytes = io.BytesIO()
    workbook = Workbook(write_only=False)
    sheet = cast(Worksheet, workbook.active)
    sheet.title = "Data"
    sheet.append(headers)
    for cell in sheet[1]:
        cell.font = Font(name="Arial", bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="2563EB")
    for row_values in values:
        sheet.append(row_values)
    for row in sheet.iter_rows(min_row=2):
        for cell in row:
            cell.font = Font(name="Arial")
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    for index, column in enumerate(sheet.columns, start=1):
        width = min(50, max(12, max(len(str(cell.value or "")) for cell in column) + 2))
        sheet.column_dimensions[get_column_letter(index)].width = width
    workbook.save(output_bytes)
    return (
        output_bytes.getvalue(),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
