"""Field + Row engine API — all scoped to the caller's workspace."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.workspace import get_current_workspace
from app.models.database import Database
from app.models.field import Field, Row
from app.models.workspace import Workspace
from app.schemas.engine import (
    FieldCreate,
    FieldOut,
    FieldUpdate,
    ReorderRequest,
    RowCreate,
    RowOut,
    RowUpdate,
)
from app.services.engine import CellValidationError, validate_row_data

router = APIRouter(tags=["engine"])


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
    await _scoped_database(database_id, workspace, db)
    existing = await _list_fields(db, database_id)
    order = (max((f.order for f in existing), default=0)) + 1
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
    return list(result.scalars().all())


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
    db: AsyncSession = Depends(get_db),
) -> Row:
    await _scoped_database(database_id, workspace, db)
    cleaned = await _validate(db, database_id, payload.data)
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
    await db.commit()
    await db.refresh(row)
    return row


@router.patch("/rows/{row_id}", response_model=RowOut)
async def update_row(
    row_id: uuid.UUID,
    payload: RowUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Row:
    row = await db.get(Row, row_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Row not found")
    await _scoped_database(row.database_id, workspace, db)
    cleaned = await _validate(db, row.database_id, payload.data)
    # Merge partial update into existing cell map (reassign to flag JSONB change).
    row.data = {**row.data, **cleaned}
    await db.commit()
    await db.refresh(row)
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
