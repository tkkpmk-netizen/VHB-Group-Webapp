"""CSV/XLSX parsing and export for database transfer jobs."""

import csv
import io
import json
from datetime import date, datetime
from typing import Any, cast

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Database
from app.models.field import Field, FieldType, Row

MAX_IMPORT_ROWS = 100_000
FORMULA_PREFIXES = ("=", "+", "-", "@")


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


async def import_rows(
    db: AsyncSession,
    *,
    database: Database,
    headers: list[str],
    records: list[list[Any]],
    mapping: dict[str, str],
    create_missing_fields: bool,
) -> dict[str, int]:
    result = await db.execute(
        select(Field).where(Field.database_id == database.id).order_by(Field.order)
    )
    fields = list(result.scalars())
    by_name = {field.name.casefold(): field for field in fields}
    by_id = {str(field.id): field for field in fields}
    column_fields: list[Field | None] = []
    for index, header in enumerate(headers):
        mapped = by_id.get(mapping.get(header, ""))
        field = mapped or by_name.get(header.casefold())
        if field is None and create_missing_fields and header:
            values = [row[index] if index < len(row) else None for row in records]
            field = Field(
                database_id=database.id,
                name=header,
                type=_infer_type(values),
                options={},
                order=len(fields),
            )
            db.add(field)
            await db.flush()
            fields.append(field)
            by_name[header.casefold()] = field
        column_fields.append(field)

    base = int(
        await db.scalar(
            select(func.coalesce(func.max(Row.seq), 0)).where(Row.database_id == database.id)
        )
        or 0
    )
    imported = 0
    for record in records:
        data: dict[str, Any] = {}
        for index, field in enumerate(column_fields):
            if field is None or index >= len(record):
                continue
            value = record[index]
            if value in (None, ""):
                continue
            data[str(field.id)] = value
        db.add(
            Row(
                database_id=database.id,
                data=data,
                seq=base + imported + 1,
                order=base + imported + 1,
            )
        )
        imported += 1
        if imported % 1000 == 0:
            await db.flush()
    await db.commit()
    return {"rows_imported": imported, "fields_created": len(fields) - len(by_id)}


def export_rows(fields: list[Field], rows: list[Row], file_format: str) -> tuple[bytes, str]:
    headers = [field.name for field in fields]
    values = [[_export_value(row.data.get(str(field.id))) for field in fields] for row in rows]
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
