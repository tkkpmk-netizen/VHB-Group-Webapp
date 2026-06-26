"""Field + Row engine API — all scoped to the caller's workspace."""

import uuid
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.database import Database
from app.models.field import Field, FieldType, Row, RowLink
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.engine import (
    FieldCreate,
    FieldOut,
    FieldUpdate,
    FormulaPreview,
    FormulaPreviewResult,
    ReorderRequest,
    RowCreate,
    RowOut,
    RowUpdate,
)
from app.services.engine import (
    CellValidationError,
    check_formula,
    evaluate_formula,
    validate_row_data,
)

router = APIRouter(tags=["engine"])

# Computed/server-set field types: clients never write these into Row.data.
_AUTO_TYPES = {
    FieldType.rollup,
    FieldType.formula,
    FieldType.created_time,
    FieldType.created_by,
    FieldType.last_edited_time,
    FieldType.last_edited_by,
}


async def _scoped_database(
    database_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> Database:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    return database


async def _list_fields(db: AsyncSession, database_id: uuid.UUID) -> list[Field]:
    result = await db.execute(
        select(Field).where(Field.database_id == database_id).order_by(Field.order)
    )
    return list(result.scalars().all())


async def _inject_relations(
    db: AsyncSession, fields: list[Field], rows: list[Row]
) -> None:
    """Populate each relation field's value (list of linked row ids) per row."""
    rel_fields = [f for f in fields if f.type == FieldType.relation]
    if not rel_fields or not rows:
        return
    row_ids = [r.id for r in rows]
    for f in rel_fields:
        opts = f.options or {}
        m: dict[uuid.UUID, list[str]] = defaultdict(list)
        if opts.get("mirror"):
            owner = opts.get("owner_field_id")
            if owner:
                res = await db.execute(
                    select(RowLink).where(
                        RowLink.field_id == uuid.UUID(owner),
                        RowLink.target_row_id.in_(row_ids),
                    )
                )
                for link in res.scalars().all():
                    m[link.target_row_id].append(str(link.source_row_id))
        else:
            res = await db.execute(
                select(RowLink).where(
                    RowLink.field_id == f.id,
                    RowLink.source_row_id.in_(row_ids),
                )
            )
            for link in res.scalars().all():
                m[link.source_row_id].append(str(link.target_row_id))
        for r in rows:
            r.data = {**r.data, str(f.id): m.get(r.id, [])}


async def _sync_relation(
    db: AsyncSession, field: Field, row: Row, target_ids: Any
) -> None:
    ids: list[uuid.UUID] = []
    for t in target_ids or []:
        try:
            ids.append(uuid.UUID(str(t)))
        except (ValueError, TypeError):
            continue
    opts = field.options or {}
    if opts.get("mirror"):
        owner = uuid.UUID(opts["owner_field_id"])
        await db.execute(
            delete(RowLink).where(
                RowLink.field_id == owner, RowLink.target_row_id == row.id
            )
        )
        for sid in ids:
            db.add(RowLink(field_id=owner, source_row_id=sid, target_row_id=row.id))
    else:
        await db.execute(
            delete(RowLink).where(
                RowLink.field_id == field.id, RowLink.source_row_id == row.id
            )
        )
        for tid in ids:
            db.add(
                RowLink(field_id=field.id, source_row_id=row.id, target_row_id=tid)
            )


def _split_relation(
    fields: list[Field], data: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Field]]:
    fmap = {str(f.id): f for f in fields}
    rel: dict[str, Any] = {}
    reg: dict[str, Any] = {}
    for k, v in data.items():
        f = fmap.get(k)
        if f is None:
            reg[k] = v
        elif f.type == FieldType.relation:
            rel[k] = v
        elif f.type in _AUTO_TYPES:
            continue  # computed / server-set, never written by clients
        else:
            reg[k] = v
    return rel, reg, fmap


def _aggregate(func: str, values: list[Any]) -> Any:
    nums = [v for v in values if isinstance(v, int | float) and not isinstance(v, bool)]
    if func == "original":
        return [v for v in values if v not in (None, "")]
    if func == "sum":
        return sum(nums)
    if func == "avg":
        return round(sum(nums) / len(nums), 4) if nums else None
    if func == "min":
        return min(nums) if nums else None
    if func == "max":
        return max(nums) if nums else None
    if func == "concat":
        return ", ".join(str(v) for v in values if v not in (None, ""))
    return len(values)  # count


async def _inject_rollups(
    db: AsyncSession, fields: list[Field], rows: list[Row]
) -> None:
    """Compute rollup fields. Requires _inject_relations to have run first."""
    rollups = [f for f in fields if f.type == FieldType.rollup]
    if not rollups or not rows:
        return
    fmap = {str(f.id): f for f in fields}
    for f in rollups:
        opts = f.options or {}
        rel_field = fmap.get(str(opts.get("relation_field_id")))
        if rel_field is None:
            for r in rows:
                r.data = {**r.data, str(f.id): None}
            continue
        tgt_id = opts.get("target_field_id")
        func = opts.get("function", "count")
        per_row = {r.id: list(r.data.get(str(rel_field.id)) or []) for r in rows}
        all_ids = {i for ids in per_row.values() for i in ids}
        tmap: dict[str, Row] = {}
        if all_ids:
            res = await db.execute(
                select(Row).where(Row.id.in_([uuid.UUID(i) for i in all_ids]))
            )
            tmap = {str(tr.id): tr for tr in res.scalars().all()}
        for r in rows:
            values: list[Any] = []
            for tid in per_row[r.id]:
                tr = tmap.get(tid)
                if tr is None:
                    continue
                values.append(tr.data.get(str(tgt_id)) if tgt_id else tr.seq)
            r.data = {**r.data, str(f.id): _aggregate(func, values)}


def _inject_formulas(fields: list[Field], rows: list[Row]) -> None:
    """Compute formula fields. Requires relations + rollups injected first."""
    formula_fields = [f for f in fields if f.type == FieldType.formula]
    if not formula_fields or not rows:
        return
    name_by_id = {str(f.id): f.name for f in fields}
    for f in formula_fields:
        expr = (f.options or {}).get("expression")
        for r in rows:
            if not expr:
                r.data = {**r.data, str(f.id): None}
                continue
            lookup = {name: r.data.get(fid) for fid, name in name_by_id.items()}
            r.data = {**r.data, str(f.id): evaluate_formula(expr, lookup)}


def _inject_system(fields: list[Field], rows: list[Row]) -> None:
    """Read-only timestamp fields, reflected live from Row.created_at/updated_at."""
    sys_fields = [
        f
        for f in fields
        if f.type in (FieldType.created_time, FieldType.last_edited_time)
    ]
    if not sys_fields or not rows:
        return
    for f in sys_fields:
        for r in rows:
            ts = r.created_at if f.type == FieldType.created_time else r.updated_at
            r.data = {**r.data, str(f.id): ts.isoformat() if ts else None}


def _apply_auto_by(
    fields: list[Field], cleaned: dict[str, Any], user_id: str, *, created: bool
) -> None:
    """Stamp created_by (on insert) and last_edited_by (insert + update) into data."""
    for f in fields:
        if f.type is FieldType.last_edited_by or (
            created and f.type is FieldType.created_by
        ):
            cleaned[str(f.id)] = user_id


@router.post(
    "/databases/{database_id}/formula-preview",
    response_model=FormulaPreviewResult,
)
async def formula_preview(
    database_id: uuid.UUID,
    payload: FormulaPreview,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> FormulaPreviewResult:
    await _scoped_database(database_id, workspace, db)
    fields = await _list_fields(db, database_id)
    res = await db.execute(
        select(Row)
        .where(Row.database_id == database_id)
        .order_by(Row.order, Row.seq)
        .limit(1)
    )
    rows = list(res.scalars().all())
    await _inject_relations(db, fields, rows)
    await _inject_rollups(db, fields, rows)
    lookup: dict[str, Any] = {}
    if rows:
        lookup = {f.name: rows[0].data.get(str(f.id)) for f in fields}
    value, error = check_formula(payload.expression, lookup)
    if error:
        return FormulaPreviewResult(value=None, type="error", error=error)
    type_name = "empty" if value is None else type(value).__name__
    return FormulaPreviewResult(value=value, type=type_name)


# ---------- Fields ----------


@router.get("/databases/{database_id}/fields", response_model=list[FieldOut])
async def list_fields(
    database_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Field]:
    await _scoped_database(database_id, workspace, db)
    return await _list_fields(db, database_id)


@router.post(
    "/databases/{database_id}/fields",
    response_model=FieldOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_field(
    database_id: uuid.UUID,
    payload: FieldCreate,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Field:
    source_db = await _scoped_database(database_id, workspace, db)
    existing = await _list_fields(db, database_id)
    order = (max((f.order for f in existing), default=0)) + 1

    if payload.type == FieldType.relation:
        target_id = payload.options.get("target_database_id")
        try:
            target_uuid = uuid.UUID(str(target_id))
        except (ValueError, TypeError) as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "relation needs target_database_id"
            ) from exc
        await _scoped_database(target_uuid, workspace, db)
        two_way = bool(payload.options.get("two_way"))
        field = Field(
            database_id=database_id,
            name=payload.name,
            type=FieldType.relation,
            options={"target_database_id": str(target_uuid), "two_way": two_way},
            order=order,
        )
        db.add(field)
        await db.flush()
        if two_way:
            t_existing = await _list_fields(db, target_uuid)
            mirror = Field(
                database_id=target_uuid,
                name=source_db.name,
                type=FieldType.relation,
                options={
                    "target_database_id": str(database_id),
                    "mirror": True,
                    "owner_field_id": str(field.id),
                },
                order=(max((f.order for f in t_existing), default=0)) + 1,
            )
            db.add(mirror)
            await db.flush()
            field.options = {**field.options, "paired_field_id": str(mirror.id)}
        await db.commit()
        await db.refresh(field)
        return field

    field = Field(
        database_id=database_id,
        name=payload.name,
        type=payload.type,
        options=payload.options,
        order=order,
    )
    db.add(field)
    await db.commit()
    await db.refresh(field)
    return field


@router.post(
    "/databases/{database_id}/sub-items",
    status_code=status.HTTP_201_CREATED,
)
async def enable_sub_items(
    database_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Create a two-way self-relation: 'Sub-item' (owner) + 'Parent item' (mirror)."""
    await _scoped_database(database_id, workspace, db)
    existing = await _list_fields(db, database_id)
    if any(
        f.type == FieldType.relation
        and (f.options or {}).get("sub_item")
        for f in existing
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Sub-items already enabled")
    order = (max((f.order for f in existing), default=0)) + 1
    owner = Field(
        database_id=database_id,
        name="Sub-item",
        type=FieldType.relation,
        options={
            "target_database_id": str(database_id),
            "two_way": True,
            "sub_item": True,
        },
        order=order,
    )
    db.add(owner)
    await db.flush()
    mirror = Field(
        database_id=database_id,
        name="Parent item",
        type=FieldType.relation,
        options={
            "target_database_id": str(database_id),
            "mirror": True,
            "owner_field_id": str(owner.id),
            "sub_item": True,
        },
        order=order + 1,
    )
    db.add(mirror)
    await db.flush()
    owner.options = {**owner.options, "paired_field_id": str(mirror.id)}
    await db.commit()
    return {"sub_item_field": str(owner.id), "parent_field": str(mirror.id)}


@router.patch("/fields/{field_id}", response_model=FieldOut)
async def update_field(
    field_id: uuid.UUID,
    payload: FieldUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Field:
    field = await db.get(Field, field_id)
    if field is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Field not found")
    await _scoped_database(field.database_id, workspace, db)
    if payload.name is not None:
        field.name = payload.name
    if payload.options is not None:
        field.options = payload.options
    await db.commit()
    await db.refresh(field)
    return field


@router.delete("/fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_field(
    field_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    field = await db.get(Field, field_id)
    if field is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Field not found")
    await _scoped_database(field.database_id, workspace, db)
    await db.delete(field)
    await db.commit()


@router.post(
    "/databases/{database_id}/fields/reorder",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def reorder_fields(
    database_id: uuid.UUID,
    payload: ReorderRequest,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    await _scoped_database(database_id, workspace, db)
    fields = {f.id: f for f in await _list_fields(db, database_id)}
    for index, fid in enumerate(payload.ids):
        field = fields.get(fid)
        if field is not None:
            field.order = index
    await db.commit()


# ---------- Rows ----------


@router.get("/databases/{database_id}/rows", response_model=list[RowOut])
async def list_rows(
    database_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Row]:
    await _scoped_database(database_id, workspace, db)
    result = await db.execute(
        select(Row)
        .where(Row.database_id == database_id)
        .order_by(Row.order, Row.seq)
    )
    rows = list(result.scalars().all())
    fields = await _list_fields(db, database_id)
    # Detach: the injects below reassign Row.data; on an attached row that marks
    # it dirty, and a later autoflush would UPDATE it and expire server-managed
    # columns (updated_at), breaking the read with an async lazy-load.
    for r in rows:
        db.expunge(r)
    await _inject_relations(db, fields, rows)
    await _inject_rollups(db, fields, rows)
    _inject_formulas(fields, rows)
    _inject_system(fields, rows)
    return rows


async def _validate(
    db: AsyncSession, database_id: uuid.UUID, data: dict[str, Any]
) -> dict[str, Any]:
    fields = await _list_fields(db, database_id)
    try:
        return validate_row_data(fields, data)
    except CellValidationError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)
        ) from exc


@router.post(
    "/databases/{database_id}/rows",
    response_model=RowOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_row(
    database_id: uuid.UUID,
    payload: RowCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Row:
    await _scoped_database(database_id, workspace, db)
    fields = await _list_fields(db, database_id)
    rel, reg, fmap = _split_relation(fields, payload.data)
    cleaned = await _validate(db, database_id, reg)
    _apply_auto_by(fields, cleaned, str(current_user.id), created=True)
    next_seq = (
        await db.scalar(
            select(func.coalesce(func.max(Row.seq), 0)).where(
                Row.database_id == database_id
            )
        )
    ) or 0
    row = Row(
        database_id=database_id, data=cleaned, seq=next_seq + 1, order=next_seq + 1
    )
    db.add(row)
    await db.flush()
    for fid, ids in rel.items():
        await _sync_relation(db, fmap[fid], row, ids)
    await db.commit()
    await db.refresh(row)
    db.expunge(row)  # detach before injecting computed values (see list_rows)
    await _inject_relations(db, fields, [row])
    await _inject_rollups(db, fields, [row])
    _inject_formulas(fields, [row])
    _inject_system(fields, [row])
    return row


@router.patch("/rows/{row_id}", response_model=RowOut)
async def update_row(
    row_id: uuid.UUID,
    payload: RowUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Row:
    row = await db.get(Row, row_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Row not found")
    await _scoped_database(row.database_id, workspace, db)
    fields = await _list_fields(db, row.database_id)
    rel, reg, fmap = _split_relation(fields, payload.data)
    cleaned = await _validate(db, row.database_id, reg)
    _apply_auto_by(fields, cleaned, str(current_user.id), created=False)
    # Merge partial update into existing cell map (reassign to flag JSONB change).
    row.data = {**row.data, **cleaned}
    for fid, ids in rel.items():
        await _sync_relation(db, fmap[fid], row, ids)
    await db.commit()
    await db.refresh(row)
    db.expunge(row)  # detach before injecting computed values (see list_rows)
    await _inject_relations(db, fields, [row])
    await _inject_rollups(db, fields, [row])
    _inject_formulas(fields, [row])
    _inject_system(fields, [row])
    return row


@router.delete("/rows/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_row(
    row_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    row = await db.get(Row, row_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Row not found")
    await _scoped_database(row.database_id, workspace, db)
    await db.delete(row)
    await db.commit()


@router.post(
    "/databases/{database_id}/rows/reorder",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def reorder_rows(
    database_id: uuid.UUID,
    payload: ReorderRequest,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    await _scoped_database(database_id, workspace, db)
    result = await db.execute(
        select(Row).where(Row.database_id == database_id)
    )
    rows = {r.id: r for r in result.scalars().all()}
    for index, rid in enumerate(payload.ids):
        row = rows.get(rid)
        if row is not None:
            row.order = index
    await db.commit()
