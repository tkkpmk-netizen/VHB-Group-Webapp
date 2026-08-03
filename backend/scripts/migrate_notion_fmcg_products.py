"""One-off, guarded migration from exported Notion FMCG JSONL into Products.

The export is deliberately values-only and excludes Notion files/media.  This
script refuses to run unless the target Products database is empty, so reruns
cannot silently duplicate production data.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import uuid
from collections import Counter
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.models.data_source import DataSource, DataSourceKind
from app.models.database import Database
from app.models.field import Entity, Field, FieldType
from app.models.user import User
from app.models.workspace import WorkspaceMember

TARGET_DATABASE_ID = uuid.UUID("1dc68135-aa84-4576-b83f-e420bc398166")
TARGET_WORKSPACE_ID = uuid.UUID("1615d7de-0a15-405b-b69c-46ccec07aa4e")
ADMIN_EMAIL = "admin@vhb.com"
EXPECTED_COUNT = 10_695
SOURCE_NAME = "Notion · FMCG Price Database"
CHOICE_COLORS = ("blue", "green", "yellow", "red", "purple", "orange", "gray")
SOURCE_TIME_ZONE = ZoneInfo("Asia/Ho_Chi_Minh")


def parse_iso_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def parse_csv_timestamp(value: str) -> str:
    text = value.removesuffix(" (GMT+7)")
    parsed = datetime.strptime(text, "%B %d, %Y %I:%M %p").replace(tzinfo=SOURCE_TIME_ZONE)
    return parsed.isoformat()


def parse_number(value: str) -> int | float | None:
    text = value.strip().replace(",", "").replace("$", "")
    if not text:
        return None
    try:
        number = Decimal(text)
    except InvalidOperation as exc:
        raise RuntimeError(f"Invalid numeric value {value!r}") from exc
    return int(number) if number == number.to_integral_value() else float(number)


def read_rows(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        source_rows = list(csv.DictReader(handle))
    required_headers = {
        "ID",
        "PRODUCT",
        "Created time",
        "Last edited time",
        "LAST PRICE EDIT",
        "Files & media",
    }
    missing = required_headers.difference(source_rows[0] if source_rows else {})
    if missing:
        raise RuntimeError(f"CSV is missing headers: {sorted(missing)}")
    number_fields = {
        "ID",
        "PACKING",
        "QUANTITY (CARTON BOX)",
        "NCC (VND)",
        "VAT",
        "FOB INTERNATIONAL (NO MARGIN)",
        "MARGIN",
    }
    rows: list[dict[str, Any]] = []
    for source in source_rows:
        row: dict[str, Any] = dict(source)
        row.pop("Files & media", None)
        for field_name in number_fields:
            row[field_name] = parse_number(source.get(field_name, ""))
        row["Created time"] = parse_csv_timestamp(source["Created time"])
        row["Last edited time"] = parse_csv_timestamp(source["Last edited time"])
        row["date:LAST PRICE EDIT:start"] = (
            parse_csv_timestamp(source["LAST PRICE EDIT"]) if source["LAST PRICE EDIT"] else None
        )
        row["date:LAST PRICE EDIT:end"] = None
        rows.append(row)
    if len(rows) != EXPECTED_COUNT:
        raise RuntimeError(f"Expected {EXPECTED_COUNT} rows, found {len(rows)}")
    notion_ids = [row.get("ID") for row in rows]
    if any(value is None for value in notion_ids) or len(set(notion_ids)) != len(rows):
        raise RuntimeError("Notion IDs are missing or duplicated")
    return rows


def choice_options(rows: list[dict[str, Any]], source_key: str) -> dict[str, Any]:
    labels = sorted({str(row[source_key]) for row in rows if row.get(source_key) not in (None, "")})
    return {
        "choices": [
            {
                "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"vhb:notion:fmcg:{source_key}:{label}")),
                "label": label,
                "color": CHOICE_COLORS[index % len(CHOICE_COLORS)],
            }
            for index, label in enumerate(labels)
        ]
    }


def choice_value(field: Field, raw: Any) -> str | None:
    if raw in (None, ""):
        return None
    label = str(raw)
    for choice in (field.options or {}).get("choices", []):
        if choice.get("label") == label:
            return str(choice["id"])
    raise RuntimeError(f"Missing choice {label!r} for {field.name}")


def canonical_names(rows: list[dict[str, Any]]) -> list[str]:
    raw_names = [str(row.get("PRODUCT") or "").strip() for row in rows]
    counts = Counter(name.casefold() for name in raw_names if name)
    names: list[str] = []
    for row, raw in zip(rows, raw_names, strict=True):
        suffix = f" · #{row['ID']}"
        if not raw:
            candidate = f"Untitled product{suffix}"
        elif counts[raw.casefold()] > 1:
            candidate = f"{raw[: 200 - len(suffix)]}{suffix}"
        else:
            candidate = raw[:200]
        names.append(candidate)
    if len({name.casefold() for name in names}) != len(names):
        raise RuntimeError("Canonical product names remain duplicated")
    return names


FIELD_SPECS: list[tuple[str, FieldType, dict[str, Any], str | None]] = [
    ("Notion ID", FieldType.number, {"format": "plain", "source": "Notion ID"}, "ID"),
    ("Origin", FieldType.select, {}, "Origin"),
    ("BRAND", FieldType.select, {}, "BRAND"),
    ("PRODUCT", FieldType.text, {}, "PRODUCT"),
    ("SPECIFICATIONS", FieldType.long_text, {}, "SPECIFICATIONS"),
    ("PACKING", FieldType.number, {"format": "plain"}, "PACKING"),
    ("UNIT", FieldType.select, {}, "UNIT"),
    ("SHELF LIFE", FieldType.select, {}, "SHELF LIFE"),
    ("CONT", FieldType.select, {}, "CONT"),
    ("TERM", FieldType.select, {}, "TERM"),
    ("QUANTITY (CARTON BOX)", FieldType.number, {"format": "plain"}, "QUANTITY (CARTON BOX)"),
    ("NCC (VND)", FieldType.number, {"format": "currency", "currency": "VND"}, "NCC (VND)"),
    ("VAT", FieldType.number, {"format": "plain"}, "VAT"),
    (
        "FOB INTERNATIONAL (NO MARGIN)",
        FieldType.number,
        {"format": "currency", "currency": "USD"},
        "FOB INTERNATIONAL (NO MARGIN)",
    ),
    ("ORIGIN (legacy)", FieldType.select, {"source_name": "ORIGIN"}, "ORIGIN"),
    ("MARGIN", FieldType.number, {"format": "plain"}, "MARGIN"),
    ("PORT OF LOADING", FieldType.long_text, {}, "PORT OF LOADING"),
    ("SUPPIER'S INFORMATION", FieldType.long_text, {}, "SUPPIER'S INFORMATION"),
    (
        "EXW VN (NO MARGIN)",
        FieldType.formula,
        {
            "format": "currency",
            "currency_code": "USD",
            "precision": 2,
            "expression": (
                'if(prop("Origin") == "Vietnam Origin", '
                'if(empty(prop("VAT")) or prop("VAT") == 0, None, '
                '(prop("NCC (VND)") or 0) / 25800 / prop("VAT")), 0)'
            ),
            "source_expression": 'if(Origin=="Vietnam Origin",NCC (VND)/25800/VAT,0)',
        },
        None,
    ),
    (
        "EXW VN (WITH MARGIN)",
        FieldType.formula,
        {
            "format": "currency",
            "currency_code": "USD",
            "precision": 2,
            "expression": '(prop("EXW VN (NO MARGIN)") or 0) * (prop("MARGIN") or 0)',
            "source_expression": "EXW VN (NO MARGIN)*MARGIN",
        },
        None,
    ),
    (
        "LOGISTIC COST",
        FieldType.formula,
        {
            "format": "currency",
            "currency_code": "USD",
            "precision": 2,
            "expression": (
                'if(prop("Origin") == "Vietnam Origin", '
                '530 / prop("QUANTITY (CARTON BOX)"), '
                '300 / prop("QUANTITY (CARTON BOX)"))'
            ),
            "source_expression": (
                'if(Origin=="Vietnam Origin",530/QUANTITY (CARTON BOX), 300/QUANTITY (CARTON BOX))'
            ),
        },
        None,
    ),
    (
        "LABEL COST",
        FieldType.formula,
        {
            "format": "currency",
            "currency_code": "USD",
            "precision": 2,
            "expression": (
                'if(prop("Origin") == "Vietnam Origin", '
                '0.03 * (prop("PACKING") or 0), 0)'
            ),
            "source_expression": 'if(Origin=="Vietnam Origin", 0.03*PACKING,0)',
        },
        None,
    ),
    (
        "FOB (NO LABEL)",
        FieldType.formula,
        {
            "format": "currency",
            "currency_code": "USD",
            "precision": 2,
            "expression": (
                'if(empty(prop("MARGIN")) or prop("MARGIN") == 0, 0, '
                'if(prop("Origin") == "Vietnam Origin", '
                '(prop("EXW VN (WITH MARGIN)") or 0) '
                '+ (prop("LOGISTIC COST") or 0), '
                '(prop("FOB INTERNATIONAL (NO MARGIN)") or 0) * prop("MARGIN") '
                '+ (prop("LOGISTIC COST") or 0)))'
            ),
            "source_expression": (
                'if(empty(MARGIN),0,if(Origin=="Vietnam Origin",'
                "EXW VN (WITH MARGIN)+LOGISTIC COST,"
                "FOB INTERNATIONAL (NO MARGIN)*MARGIN+LOGISTIC COST))"
            ),
        },
        None,
    ),
    (
        "FOB (WITH LABEL)",
        FieldType.formula,
        {
            "format": "currency",
            "currency_code": "USD",
            "precision": 2,
            "expression": (
                'if(prop("Origin") == "Vietnam Origin", '
                '(prop("FOB (NO LABEL)") or 0) + (prop("LABEL COST") or 0), 0)'
            ),
            "source_expression": 'if(Origin=="Vietnam Origin", FOB (NO LABEL)+LABEL COST,0)',
        },
        None,
    ),
    (
        "PRODUCTS NAME",
        FieldType.formula,
        {
            "expression": 'if(empty(prop("PRODUCT")), "", prop("PRODUCT"))',
            "source_expression": "if(empty(PRODUCT), empty(), PRODUCT)",
        },
        None,
    ),
    ("LAST PRICE EDIT", FieldType.date, {}, "date:LAST PRICE EDIT:start"),
    ("Created time", FieldType.created_time, {}, None),
    ("Last edited time", FieldType.last_edited_time, {}, None),
    ("Created by", FieldType.created_by, {}, None),
    ("Last edited by", FieldType.last_edited_by, {}, None),
    ("Notion Created by", FieldType.text, {}, "Created by"),
    ("Notion Last edited by", FieldType.text, {}, "Last edited by"),
    ("Notion Suppliers", FieldType.long_text, {"source_type": "relation"}, "Suppliers"),
    ("Notion Inquiry", FieldType.long_text, {"source_type": "relation"}, "Inquiry"),
]


async def migrate(path: Path) -> None:
    rows = read_rows(path)
    names = canonical_names(rows)
    async with SessionLocal() as session:
        target = await session.get(Database, TARGET_DATABASE_ID)
        if target is None or target.workspace_id != TARGET_WORKSPACE_ID:
            raise RuntimeError("Target Products database/workspace does not match the guard")
        count = await session.scalar(
            select(func.count()).select_from(Entity).where(Entity.database_id == target.id)
        )
        if count:
            raise RuntimeError(
                f"Refusing to import into non-empty Products database ({count} rows)"
            )
        admin = await session.scalar(select(User).where(func.lower(User.email) == ADMIN_EMAIL))
        if admin is None:
            raise RuntimeError(f"Missing {ADMIN_EMAIL}")
        membership = await session.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == TARGET_WORKSPACE_ID,
                WorkspaceMember.user_id == admin.id,
            )
        )
        if membership is None:
            raise RuntimeError("Admin is not a member of the target workspace")

        existing_fields = list(
            (await session.scalars(select(Field).where(Field.database_id == target.id))).all()
        )
        fields_by_name = {field.name: field for field in existing_fields}
        select_sources = {"Origin", "BRAND", "UNIT", "SHELF LIFE", "CONT", "TERM", "ORIGIN"}
        created_fields: list[Field] = []
        next_order = max((field.order for field in existing_fields), default=-1) + 1
        for name, field_type, base_options, source_key in FIELD_SPECS:
            field = fields_by_name.get(name)
            if field is not None:
                if field.type != field_type:
                    raise RuntimeError(
                        f"Existing field {name!r} has incompatible type {field.type}"
                    )
                continue
            options = dict(base_options)
            if source_key in select_sources:
                options.update(choice_options(rows, source_key))
            field = Field(
                database_id=target.id,
                name=name,
                type=field_type,
                options=options,
                order=next_order,
            )
            next_order += 1
            session.add(field)
            fields_by_name[name] = field
            created_fields.append(field)
        await session.flush()

        source = DataSource(
            database_id=target.id,
            name=SOURCE_NAME,
            description=(
                "Values-only migration from Notion FMCG Price Database; files/media excluded."
            ),
            kind=DataSourceKind.imported,
            is_primary=False,
            order=1,
        )
        session.add(source)
        await session.flush()

        formula_names = {name for name, typ, _, _ in FIELD_SPECS if typ is FieldType.formula}
        system_names = {
            name
            for name, typ, _, _ in FIELD_SPECS
            if typ
            in {
                FieldType.created_time,
                FieldType.last_edited_time,
                FieldType.created_by,
                FieldType.last_edited_by,
            }
        }
        spec_by_name = {name: (typ, source_key) for name, typ, _, source_key in FIELD_SPECS}
        entities: list[Entity] = []
        for index, (row, entity_name) in enumerate(zip(rows, names, strict=True), start=1):
            data: dict[str, Any] = {}
            for name, field in fields_by_name.items():
                if name in formula_names or name in system_names or name not in spec_by_name:
                    continue
                field_type, source_key = spec_by_name[name]
                if source_key is None:
                    continue
                raw = row.get(source_key)
                value: Any
                if field_type is FieldType.select:
                    value = choice_value(field, raw)
                elif name == "LAST PRICE EDIT":
                    if raw:
                        value = {"start": raw, "end": row.get("date:LAST PRICE EDIT:end")}
                    else:
                        value = None
                elif name in {"Notion Suppliers", "Notion Inquiry"} and not isinstance(
                    raw, str | type(None)
                ):
                    value = json.dumps(raw, ensure_ascii=False)
                else:
                    value = raw
                if value not in (None, ""):
                    data[str(field.id)] = value
            data[str(fields_by_name["Name"].id)] = entity_name
            data[str(fields_by_name["Created by"].id)] = [str(admin.id)]
            data[str(fields_by_name["Last edited by"].id)] = [str(admin.id)]
            created_at = parse_iso_timestamp(row.get("Created time"))
            updated_at = parse_iso_timestamp(row.get("Last edited time")) or created_at
            notion_id = int(row["ID"])
            entities.append(
                Entity(
                    database_id=target.id,
                    data_source_id=source.id,
                    data=data,
                    uid=f"F-{notion_id}",
                    name=entity_name,
                    seq=notion_id,
                    order=index,
                    created_at=created_at,
                    updated_at=updated_at,
                )
            )
            if len(entities) == 500:
                session.add_all(entities)
                await session.flush()
                entities.clear()
        if entities:
            session.add_all(entities)
        await session.commit()

    print(
        json.dumps(
            {
                "database_id": str(TARGET_DATABASE_ID),
                "imported": len(rows),
                "created_fields": [field.name for field in created_fields],
                "source": SOURCE_NAME,
                "files_imported": 0,
                "min_created_time": min(
                    row["Created time"] for row in rows if row.get("Created time")
                ),
                "max_last_edited_time": max(
                    row["Last edited time"] for row in rows if row.get("Last edited time")
                ),
            },
            ensure_ascii=False,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_file", type=Path)
    args = parser.parse_args()
    asyncio.run(migrate(args.csv_file))


if __name__ == "__main__":
    main()
