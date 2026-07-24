"""Field + Entity engine API — all scoped to the caller's workspace."""

import uuid
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Float, String, case, cast, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.data_source import DataSource
from app.models.database import Database
from app.models.field import Entity, EntityLink, Field, FieldType
from app.models.user import User
from app.models.workspace import MemberRole, Workspace, WorkspaceMember
from app.schemas.engine import (
    BulkEntityCreate,
    EntityCreate,
    EntityGroup,
    EntityOut,
    EntityPage,
    EntityQuery,
    EntityUpdate,
    FieldCreate,
    FieldOut,
    FieldTypeConversionRequest,
    FieldTypeConversionResult,
    FieldUpdate,
    FormulaPreview,
    FormulaPreviewResult,
    ReorderRequest,
    SubItemTreeQuery,
)
from app.services.drive_file_cleanup import cleanup_drive_files
from app.services.engine import (
    CellValidationError,
    check_formula,
    evaluate_formula,
    next_entity_seq,
    validate_entity_data,
    validate_required_fields,
)
from app.services.field_conversion import (
    CONVERTIBLE_FIELD_TYPES,
    build_field_conversion_plan,
)

router = APIRouter(tags=["engine"])

# Computed/server-set field types: clients never write these into Entity.data.
_AUTO_TYPES = {
    FieldType.unique_id,
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


async def _assert_field_write_permissions(
    db: AsyncSession,
    *,
    fields: list[Field],
    data: dict[str, Any],
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Enforce a Field's edit scope in addition to Database-level access."""
    by_id = {str(field.id): field for field in fields}
    protected = [
        by_id[field_id].name
        for field_id in data
        if field_id in by_id
        and (by_id[field_id].options or {}).get("edit_permission") == "admins"
    ]
    if not protected:
        return
    role = await db.scalar(
        select(WorkspaceMember.role).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if role not in {MemberRole.owner, MemberRole.admin}:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Only workspace admins can edit: {', '.join(protected)}",
        )


def _system_field(fields: list[Field], key: str) -> Field | None:
    """Return one of the two protected identity fields for a database."""
    return next((f for f in fields if (f.options or {}).get("system_key") == key), None)


async def _unique_name(
    db: AsyncSession,
    database_id: uuid.UUID,
    requested: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> str:
    """Keep Name unique per database, adding a predictable numeric suffix.

    The comparison is case-insensitive in application code so ``Acme`` and
    ``acme`` cannot become confusing near-duplicates.  The database constraint
    remains a final concurrency backstop for exact duplicates.
    """
    base = requested.strip()
    if not base:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Entity name is required")
    if len(base) > 200:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Entity name is too long")
    stmt = select(Entity.name).where(Entity.database_id == database_id)
    if exclude_id is not None:
        stmt = stmt.where(Entity.id != exclude_id)
    taken = {name.casefold() for name in (await db.scalars(stmt)).all()}
    if base.casefold() not in taken:
        return base
    n = 2
    while f"{base} {n}".casefold() in taken:
        n += 1
    return f"{base} {n}"


def _mirror_identity(
    fields: list[Field], data: dict[str, Any], *, uid: str, name: str
) -> dict[str, Any]:
    """Keep legacy field cells and canonical Entity identity in lock-step."""
    result = dict(data)
    if uid_field := _system_field(fields, "uid"):
        result[str(uid_field.id)] = uid
    if name_field := _system_field(fields, "name"):
        result[str(name_field.id)] = name
    return result


async def _inject_relations(db: AsyncSession, fields: list[Field], entities: list[Entity]) -> None:
    """Populate each relation field's value (list of linked entity ids) per entity."""
    rel_fields = [f for f in fields if f.type == FieldType.relation]
    if not rel_fields or not entities:
        return
    entity_ids = [r.id for r in entities]
    for f in rel_fields:
        opts = f.options or {}
        m: dict[uuid.UUID, list[str]] = defaultdict(list)
        if opts.get("mirror"):
            owner = opts.get("owner_field_id")
            if owner:
                res = await db.execute(
                    select(EntityLink).where(
                        EntityLink.field_id == uuid.UUID(owner),
                        EntityLink.target_entity_id.in_(entity_ids),
                    )
                )
                for link in res.scalars().all():
                    m[link.target_entity_id].append(str(link.source_entity_id))
        else:
            res = await db.execute(
                select(EntityLink).where(
                    EntityLink.field_id == f.id,
                    EntityLink.source_entity_id.in_(entity_ids),
                )
            )
            for link in res.scalars().all():
                m[link.source_entity_id].append(str(link.target_entity_id))
        for r in entities:
            r.data = {**r.data, str(f.id): m.get(r.id, [])}


async def _sync_relation(db: AsyncSession, field: Field, entity: Entity, target_ids: Any) -> None:
    ids: list[uuid.UUID] = []
    for t in target_ids or []:
        try:
            ids.append(uuid.UUID(str(t)))
        except (ValueError, TypeError):
            continue
    opts = field.options or {}
    is_sub_item = bool(opts.get("sub_item"))
    # Only link entities that live in the field's target database (which was
    # verified to be workspace-local at field creation). Anything else —
    # unknown ids, entities from other databases/workspaces — is dropped.
    if ids:
        target_db_id = uuid.UUID(str(opts["target_database_id"]))
        valid = await db.scalars(
            select(Entity.id).where(Entity.id.in_(ids), Entity.database_id == target_db_id)
        )
        allowed = set(valid.all())
        ids = [i for i in ids if i in allowed]
    if is_sub_item:
        ids = [target_id for target_id in ids if target_id != entity.id]
    # A hierarchy node has at most one parent. The mirror field is still
    # represented as an ID list for relation compatibility, but only its first
    # valid value is accepted.
    if is_sub_item and opts.get("mirror"):
        ids = ids[:1]
    if opts.get("mirror"):
        owner = uuid.UUID(opts["owner_field_id"])
        await db.execute(
            delete(EntityLink).where(
                EntityLink.field_id == owner, EntityLink.target_entity_id == entity.id
            )
        )
        for sid in ids:
            db.add(EntityLink(field_id=owner, source_entity_id=sid, target_entity_id=entity.id))
    else:
        await db.execute(
            delete(EntityLink).where(
                EntityLink.field_id == field.id, EntityLink.source_entity_id == entity.id
            )
        )
        if is_sub_item and ids:
            # Re-parenting through the owner-side Sub-item field must detach
            # each child from any previous parent before creating the new link.
            await db.execute(
                delete(EntityLink).where(
                    EntityLink.field_id == field.id,
                    EntityLink.target_entity_id.in_(ids),
                )
            )
        for tid in ids:
            db.add(EntityLink(field_id=field.id, source_entity_id=entity.id, target_entity_id=tid))


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


async def _inject_rollups(db: AsyncSession, fields: list[Field], entities: list[Entity]) -> None:
    """Compute rollup fields. Requires _inject_relations to have run first."""
    rollups = [f for f in fields if f.type == FieldType.rollup]
    if not rollups or not entities:
        return
    fmap = {str(f.id): f for f in fields}
    for f in rollups:
        opts = f.options or {}
        rel_field = fmap.get(str(opts.get("relation_field_id")))
        if rel_field is None:
            for r in entities:
                r.data = {**r.data, str(f.id): None}
            continue
        tgt_id = opts.get("target_field_id")
        func = opts.get("function", "count")
        per_row = {r.id: list(r.data.get(str(rel_field.id)) or []) for r in entities}
        all_ids = {i for ids in per_row.values() for i in ids}
        tmap: dict[str, Entity] = {}
        if all_ids:
            # Scope to the relation's target database so stale/foreign links
            # can never surface another workspace's entity data.
            rel_target = (rel_field.options or {}).get("target_database_id")
            stmt = select(Entity).where(Entity.id.in_([uuid.UUID(i) for i in all_ids]))
            if rel_target:
                stmt = stmt.where(Entity.database_id == uuid.UUID(str(rel_target)))
            res = await db.execute(stmt)
            tmap = {str(tr.id): tr for tr in res.scalars().all()}
        for r in entities:
            values: list[Any] = []
            for tid in per_row[r.id]:
                tr = tmap.get(tid)
                if tr is None:
                    continue
                values.append(tr.data.get(str(tgt_id)) if tgt_id else tr.seq)
            r.data = {**r.data, str(f.id): _aggregate(func, values)}


def _inject_formulas(fields: list[Field], entities: list[Entity]) -> None:
    """Compute formula fields. Requires relations + rollups injected first."""
    formula_fields = [f for f in fields if f.type == FieldType.formula]
    if not formula_fields or not entities:
        return
    name_by_id = {str(f.id): f.name for f in fields}
    for f in formula_fields:
        expr = (f.options or {}).get("expression")
        for r in entities:
            if not expr:
                r.data = {**r.data, str(f.id): None}
                continue
            lookup = {name: r.data.get(fid) for fid, name in name_by_id.items()}
            r.data = {**r.data, str(f.id): evaluate_formula(expr, lookup)}


def _inject_system(fields: list[Field], entities: list[Entity]) -> None:
    """Read-only timestamp fields, reflected live from Entity.created_at/updated_at."""
    sys_fields = [
        f for f in fields if f.type in (FieldType.created_time, FieldType.last_edited_time)
    ]
    if not entities:
        return
    uid_field = _system_field(fields, "uid")
    name_field = _system_field(fields, "name")
    for r in entities:
        data = dict(r.data)
        if uid_field:
            data[str(uid_field.id)] = r.uid
        if name_field:
            data[str(name_field.id)] = r.name
        for f in sys_fields:
            ts = r.created_at if f.type == FieldType.created_time else r.updated_at
            data[str(f.id)] = ts.isoformat() if ts else None
        r.data = data


def _apply_auto_by(
    fields: list[Field], cleaned: dict[str, Any], user_id: str, *, created: bool
) -> None:
    """Stamp created_by (on insert) and last_edited_by (insert + update) into data."""
    for f in fields:
        if f.type is FieldType.last_edited_by or (created and f.type is FieldType.created_by):
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
        select(Entity)
        .where(Entity.database_id == database_id)
        .order_by(Entity.order, Entity.seq)
        .limit(1)
    )
    entities = list(res.scalars().all())
    await _inject_relations(db, fields, entities)
    await _inject_rollups(db, fields, entities)
    lookup: dict[str, Any] = {}
    if entities:
        lookup = {f.name: entities[0].data.get(str(f.id)) for f in fields}
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
            icon=payload.icon,
            icon_color=payload.icon_color,
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
                icon=payload.icon,
                icon_color=payload.icon_color,
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
        icon=payload.icon,
        icon_color=payload.icon_color,
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
    if any(f.type == FieldType.relation and (f.options or {}).get("sub_item") for f in existing):
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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Field:
    field = await db.get(Field, field_id)
    if field is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Field not found")
    await _scoped_database(field.database_id, workspace, db)
    if (field.options or {}).get("system_key") in {"uid", "name"}:
        if payload.name is not None and payload.name != field.name:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Built-in UID and Name fields cannot be renamed"
            )
    if payload.name is not None:
        field.name = payload.name
    if "icon" in payload.model_fields_set:
        field.icon = payload.icon
    if "icon_color" in payload.model_fields_set:
        field.icon_color = payload.icon_color
    if payload.options is not None:
        options = payload.options
        previous_scope = (field.options or {}).get("edit_permission", "workspace")
        requested_scope = options.get("edit_permission", previous_scope)
        if requested_scope not in {"workspace", "admins"}:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Invalid field edit permission",
            )
        if requested_scope != previous_scope:
            role = await db.scalar(
                select(WorkspaceMember.role).where(
                    WorkspaceMember.workspace_id == workspace.id,
                    WorkspaceMember.user_id == current_user.id,
                )
            )
            if role not in {MemberRole.owner, MemberRole.admin}:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "Only workspace admins can change field permissions",
                )
        if field.type == FieldType.relation:
            # Structural keys define the link topology (and its workspace
            # guarantees); they are set at creation and must survive updates.
            structural = {
                "target_database_id",
                "two_way",
                "mirror",
                "owner_field_id",
                "paired_field_id",
                "sub_item",
            }
            preserved = {k: v for k, v in (field.options or {}).items() if k in structural}
            options = {**{k: v for k, v in options.items() if k not in structural}, **preserved}
        field.options = options
    await db.commit()
    await db.refresh(field)
    return field


@router.post(
    "/fields/{field_id}/convert-type",
    response_model=FieldTypeConversionResult,
)
async def convert_field_type(
    field_id: uuid.UUID,
    payload: FieldTypeConversionRequest,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> FieldTypeConversionResult:
    """Preview or apply a lossy conversion of every persisted cell in a field."""
    field = await db.get(Field, field_id)
    if field is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Field not found")
    await _scoped_database(field.database_id, workspace, db)
    source_type = field.type
    if (field.options or {}).get("system_key") in {"uid", "name"}:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Built-in identity fields cannot change type",
        )
    if source_type not in CONVERTIBLE_FIELD_TYPES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{source_type.value} fields cannot change type",
        )
    if payload.target_type not in CONVERTIBLE_FIELD_TYPES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Cannot convert to {payload.target_type.value}",
        )
    if payload.target_type == source_type:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Choose a different field type",
        )

    entities = list(
        (
            await db.scalars(
                select(Entity)
                .where(Entity.database_id == field.database_id)
                .order_by(Entity.seq)
            )
        ).all()
    )
    plan = build_field_conversion_plan(
        field, entities, payload.target_type, payload.options
    )
    converted_field: Field | None = None
    if not payload.dry_run:
        for entity in entities:
            entity.data = plan.entity_data[entity.id]
        field.type = payload.target_type
        field.options = plan.target_options
        await db.commit()
        await db.refresh(field)
        converted_field = field

    return FieldTypeConversionResult(
        field=FieldOut.model_validate(converted_field) if converted_field else None,
        source_type=source_type,
        target_type=payload.target_type,
        total_cells=plan.total_cells,
        converted_cells=plan.converted_cells,
        cleared_cells=plan.cleared_cells,
        empty_cells=plan.empty_cells,
        generated_choices=plan.generated_choices,
        cleared_samples=plan.cleared_samples,
    )


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
    if (field.options or {}).get("system_key") in {"uid", "name"}:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Built-in UID and Name fields cannot be deleted"
        )
    await cleanup_drive_files(db, field_id=field.id)
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


# ---------- Entities ----------


@router.get("/databases/{database_id}/entities", response_model=list[EntityOut])
async def list_entities(
    database_id: uuid.UUID,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=200),
    data_source_id: uuid.UUID | None = Query(default=None),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Entity]:
    await _scoped_database(database_id, workspace, db)
    conditions: list[Any] = [Entity.database_id == database_id]
    if data_source_id is not None:
        conditions.append(Entity.data_source_id == data_source_id)
    result = await db.execute(
        select(Entity)
        .where(*conditions)
        .order_by(Entity.order, Entity.seq)
        .offset(offset)
        .limit(limit)
    )
    entities = list(result.scalars().all())
    fields = await _list_fields(db, database_id)
    # Detach: the injects below reassign Entity.data; on an attached entity that marks
    # it dirty, and a later autoflush would UPDATE it and expire server-managed
    # columns (updated_at), breaking the read with an async lazy-load.
    for r in entities:
        db.expunge(r)
    await _inject_relations(db, fields, entities)
    await _inject_rollups(db, fields, entities)
    _inject_formulas(fields, entities)
    _inject_system(fields, entities)
    return entities


def _field_expression(field_id: str, fields: dict[str, Field]) -> Any:
    if field_id == "seq":
        return Entity.seq
    if field_id == "order":
        return Entity.order
    if field_id == "data_source_id":
        return Entity.data_source_id
    field = fields.get(field_id)
    if field is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Unknown query field: {field_id}",
        )
    if (field.options or {}).get("system_key") == "uid":
        return Entity.uid
    if (field.options or {}).get("system_key") == "name":
        return Entity.name
    text_expr = Entity.data[field_id].astext
    if field.type in {FieldType.number, FieldType.rating, FieldType.progress}:
        return cast(func.nullif(text_expr, ""), Float)
    return cast(text_expr, String)


@router.post(
    "/databases/{database_id}/entities/query",
    response_model=EntityPage,
)
async def query_entities(
    database_id: uuid.UUID,
    payload: EntityQuery,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> EntityPage:
    """Bounded server-side filtering, sorting, pagination and aggregation."""
    await _scoped_database(database_id, workspace, db)
    fields = await _list_fields(db, database_id)
    field_map = {str(field.id): field for field in fields}
    conditions: list[Any] = [Entity.database_id == database_id]
    numeric_aggregation_types = {
        FieldType.number,
        FieldType.rating,
        FieldType.progress,
    }
    for aggregation_item in payload.aggregations:
        field = field_map.get(aggregation_item.field_id)
        if (
            aggregation_item.function in {"sum", "avg", "min", "max"}
            and (field is None or field.type not in numeric_aggregation_types)
        ):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"{aggregation_item.function} requires a numeric field",
            )

    for filter_item in payload.filters:
        expression = _field_expression(filter_item.field_id, field_map)
        if filter_item.operator == "eq":
            conditions.append(expression == filter_item.value)
        elif filter_item.operator == "neq":
            conditions.append(expression != filter_item.value)
        elif filter_item.operator == "contains":
            conditions.append(cast(expression, String).ilike(f"%{filter_item.value}%"))
        elif filter_item.operator == "gt":
            conditions.append(expression > filter_item.value)
        elif filter_item.operator == "gte":
            conditions.append(expression >= filter_item.value)
        elif filter_item.operator == "lt":
            conditions.append(expression < filter_item.value)
        elif filter_item.operator == "lte":
            conditions.append(expression <= filter_item.value)
        elif filter_item.operator == "is_empty":
            conditions.append(expression.is_(None) | (cast(expression, String) == ""))
        else:
            conditions.append(expression.is_not(None) & (cast(expression, String) != ""))

    total = int(await db.scalar(select(func.count()).select_from(Entity).where(*conditions)) or 0)
    order_by: list[Any] = []
    for sort_item in payload.sorts:
        expression = _field_expression(sort_item.field_id, field_map)
        order_by.append(
            expression.desc().nullslast()
            if sort_item.direction == "desc"
            else expression.asc().nullslast()
        )
    if not order_by:
        order_by = [Entity.order.asc(), Entity.seq.asc()]

    result = await db.execute(
        select(Entity)
        .where(*conditions)
        .order_by(*order_by)
        .offset((payload.page - 1) * payload.page_size)
        .limit(payload.page_size)
    )
    entities = list(result.scalars())
    for entity in entities:
        db.expunge(entity)
    await _inject_relations(db, fields, entities)
    await _inject_rollups(db, fields, entities)
    _inject_formulas(fields, entities)
    _inject_system(fields, entities)

    aggregates: dict[str, Any] = {}
    for aggregation_item in payload.aggregations:
        expression = _field_expression(aggregation_item.field_id, field_map)
        non_empty = expression.is_not(None) & (cast(expression, String) != "")
        aggregate = {
            "count": func.count(),
            "filled": func.count().filter(non_empty),
            "empty": func.count().filter(~non_empty),
            "unique": func.count(func.distinct(expression)).filter(non_empty),
            "percent_filled": func.coalesce(func.avg(case((non_empty, 1.0), else_=0.0)) * 100, 0),
            "sum": func.sum(expression),
            "avg": func.avg(expression),
            "min": func.min(expression),
            "max": func.max(expression),
        }[aggregation_item.function]
        value = await db.scalar(select(aggregate).select_from(Entity).where(*conditions))
        aggregates[f"{aggregation_item.function}:{aggregation_item.field_id}"] = value

    groups: list[EntityGroup] = []
    if payload.group_by:
        group_expression = _field_expression(payload.group_by, field_map)
        selections = [group_expression.label("group_key")]
        aggregate_keys: list[str] = []
        for aggregation_item in payload.aggregations:
            expression = _field_expression(aggregation_item.field_id, field_map)
            non_empty = expression.is_not(None) & (cast(expression, String) != "")
            aggregate = {
                "count": func.count(),
                "filled": func.count().filter(non_empty),
                "empty": func.count().filter(~non_empty),
                "unique": func.count(func.distinct(expression)).filter(non_empty),
                "percent_filled": func.coalesce(
                    func.avg(case((non_empty, 1.0), else_=0.0)) * 100, 0
                ),
                "sum": func.sum(expression),
                "avg": func.avg(expression),
                "min": func.min(expression),
                "max": func.max(expression),
            }[aggregation_item.function]
            key = f"{aggregation_item.function}:{aggregation_item.field_id}"
            aggregate_keys.append(key)
            selections.append(aggregate.label(f"aggregate_{len(aggregate_keys)}"))
        grouped = await db.execute(
            select(*selections)
            .select_from(Entity)
            .where(*conditions)
            .group_by(group_expression)
            .order_by(group_expression.asc().nullslast())
            .limit(100)
        )
        for grouped_row in grouped:
            groups.append(
                EntityGroup(
                    key=grouped_row[0],
                    aggregates={
                        key: grouped_row[index + 1] for index, key in enumerate(aggregate_keys)
                    },
                )
            )

    return EntityPage(
        items=entities,
        page=payload.page,
        page_size=payload.page_size,
        total=total,
        pages=(total + payload.page_size - 1) // payload.page_size,
        aggregates=aggregates,
        groups=groups,
    )


@router.post(
    "/databases/{database_id}/entities/sub-item-tree",
    response_model=list[EntityOut],
)
async def query_sub_item_tree(
    database_id: uuid.UUID,
    payload: SubItemTreeQuery,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Entity]:
    """Return sub-item components connected to the currently loaded Table page."""
    await _scoped_database(database_id, workspace, db)
    fields = await _list_fields(db, database_id)
    owner = next(
        (
            field
            for field in fields
            if field.type == FieldType.relation
            and (field.options or {}).get("sub_item")
            and not (field.options or {}).get("mirror")
        ),
        None,
    )
    if owner is None:
        return []

    requested = set(payload.entity_ids)
    scoped = set(
        (
            await db.scalars(
                select(Entity.id).where(
                    Entity.database_id == database_id,
                    Entity.id.in_(requested),
                )
            )
        ).all()
    )
    if not scoped:
        return []

    connected = set(scoped)
    frontier = set(scoped)
    while frontier:
        links = (
            await db.scalars(
                select(EntityLink).where(
                    EntityLink.field_id == owner.id,
                    or_(
                        EntityLink.source_entity_id.in_(frontier),
                        EntityLink.target_entity_id.in_(frontier),
                    ),
                )
            )
        ).all()
        discovered = {
            entity_id
            for link in links
            for entity_id in (link.source_entity_id, link.target_entity_id)
        }
        frontier = discovered - connected
        connected.update(frontier)

    result = await db.execute(
        select(Entity)
        .where(Entity.database_id == database_id, Entity.id.in_(connected))
        .order_by(Entity.order, Entity.seq)
    )
    entities = list(result.scalars())
    for entity in entities:
        db.expunge(entity)
    await _inject_relations(db, fields, entities)
    await _inject_rollups(db, fields, entities)
    _inject_formulas(fields, entities)
    _inject_system(fields, entities)
    return entities


async def _validate(
    db: AsyncSession, database_id: uuid.UUID, data: dict[str, Any]
) -> dict[str, Any]:
    fields = await _list_fields(db, database_id)
    try:
        return validate_entity_data(fields, data)
    except CellValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


async def _resolve_data_source(
    db: AsyncSession, database_id: uuid.UUID, data_source_id: uuid.UUID | None
) -> uuid.UUID:
    """An explicit id must belong to the database; omitted defaults to primary."""
    if data_source_id is not None:
        data_source = await db.get(DataSource, data_source_id)
        if data_source is None or data_source.database_id != database_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Data source not found")
        return data_source_id
    primary = await db.scalar(
        select(DataSource.id).where(
            DataSource.database_id == database_id, DataSource.is_primary.is_(True)
        )
    )
    if primary is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "Database is missing its primary data source"
        )
    return primary


@router.post(
    "/databases/{database_id}/entities",
    response_model=EntityOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_entity(
    database_id: uuid.UUID,
    payload: EntityCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Entity:
    await _scoped_database(database_id, workspace, db)
    data_source_id = await _resolve_data_source(db, database_id, payload.data_source_id)
    fields = await _list_fields(db, database_id)
    rel, reg, fmap = _split_relation(fields, payload.data)
    await _assert_field_write_permissions(
        db,
        fields=fields,
        data=reg,
        workspace_id=workspace.id,
        user_id=current_user.id,
    )
    cleaned = await _validate(db, database_id, reg)
    _apply_auto_by(fields, cleaned, str(current_user.id), created=True)
    next_seq = await next_entity_seq(db, database_id)
    name = await _unique_name(db, database_id, payload.name)
    uid = str(next_seq)
    cleaned = _mirror_identity(fields, cleaned, uid=uid, name=name)
    try:
        validate_required_fields(fields, cleaned)
    except CellValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    entity = Entity(
        database_id=database_id,
        data_source_id=data_source_id,
        data=cleaned,
        uid=uid,
        name=name,
        seq=next_seq,
        order=next_seq,
    )
    db.add(entity)
    await db.flush()
    for fid, ids in rel.items():
        await _sync_relation(db, fmap[fid], entity, ids)
    await db.commit()
    await db.refresh(entity)
    db.expunge(entity)  # detach before injecting computed values (see list_entities)
    await _inject_relations(db, fields, [entity])
    await _inject_rollups(db, fields, [entity])
    _inject_formulas(fields, [entity])
    _inject_system(fields, [entity])
    return entity


@router.post(
    "/databases/{database_id}/entities/bulk",
    response_model=list[EntityOut],
    status_code=status.HTTP_201_CREATED,
)
async def bulk_create_entities(
    database_id: uuid.UUID,
    payload: BulkEntityCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Entity]:
    await _scoped_database(database_id, workspace, db)
    data_source_id = await _resolve_data_source(db, database_id, payload.data_source_id)
    fields = await _list_fields(db, database_id)
    base = await next_entity_seq(db, database_id) - 1
    created: list[Entity] = []
    for i, requested_name in enumerate(payload.names):
        data: dict[str, Any] = {}
        _apply_auto_by(fields, data, str(current_user.id), created=True)
        seq = base + i + 1
        name = await _unique_name(db, database_id, requested_name)
        uid = str(seq)
        data = _mirror_identity(fields, data, uid=uid, name=name)
        try:
            validate_required_fields(fields, data)
        except CellValidationError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
        entity = Entity(
            database_id=database_id,
            data_source_id=data_source_id,
            data=data,
            uid=uid,
            name=name,
            seq=seq,
            order=seq,
        )
        db.add(entity)
        created.append(entity)
    await db.commit()
    for r in created:
        await db.refresh(r)
        db.expunge(r)
    await _inject_relations(db, fields, created)
    await _inject_rollups(db, fields, created)
    _inject_formulas(fields, created)
    _inject_system(fields, created)
    return created


@router.patch("/entities/{entity_id}", response_model=EntityOut)
async def update_entity(
    entity_id: uuid.UUID,
    payload: EntityUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Entity:
    entity = await db.get(Entity, entity_id)
    if entity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entity not found")
    await _scoped_database(entity.database_id, workspace, db)
    fields = await _list_fields(db, entity.database_id)
    rel, reg, fmap = _split_relation(fields, payload.data)
    await _assert_field_write_permissions(
        db,
        fields=fields,
        data=reg,
        workspace_id=workspace.id,
        user_id=current_user.id,
    )
    cleaned = await _validate(db, entity.database_id, reg)
    name_field = _system_field(fields, "name")
    requested_name = payload.name
    if requested_name is None and name_field:
        requested_name = cleaned.get(str(name_field.id))
    if requested_name is not None:
        if not isinstance(requested_name, str):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Entity name must be text")
        entity.name = await _unique_name(
            db, entity.database_id, requested_name, exclude_id=entity.id
        )
    _apply_auto_by(fields, cleaned, str(current_user.id), created=False)
    # Merge partial update into existing cell map (reassign to flag JSONB change).
    entity.data = _mirror_identity(
        fields, {**entity.data, **cleaned}, uid=entity.uid, name=entity.name
    )
    try:
        validate_required_fields(fields, entity.data)
    except CellValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    for fid, ids in rel.items():
        await _sync_relation(db, fmap[fid], entity, ids)
    await db.commit()
    await db.refresh(entity)
    db.expunge(entity)  # detach before injecting computed values (see list_entities)
    await _inject_relations(db, fields, [entity])
    await _inject_rollups(db, fields, [entity])
    _inject_formulas(fields, [entity])
    _inject_system(fields, [entity])
    return entity


@router.delete("/entities/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entity(
    entity_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    entity = await db.get(Entity, entity_id)
    if entity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entity not found")
    await _scoped_database(entity.database_id, workspace, db)
    await cleanup_drive_files(db, entity_id=entity.id)
    await db.delete(entity)
    await db.commit()


@router.post(
    "/databases/{database_id}/entities/reorder",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def reorder_entities(
    database_id: uuid.UUID,
    payload: ReorderRequest,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    await _scoped_database(database_id, workspace, db)
    result = await db.execute(select(Entity).where(Entity.database_id == database_id))
    entities = {r.id: r for r in result.scalars().all()}
    for index, rid in enumerate(payload.ids):
        entity = entities.get(rid)
        if entity is not None:
            entity.order = index
    await db.commit()
