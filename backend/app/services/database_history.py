"""Record and reverse scoped changes made inside a Database."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.data_source import DataSource, DataSourceKind
from app.models.database import Database
from app.models.database_change import DatabaseChange
from app.models.field import Entity, EntityLink, Field, FieldType
from app.models.layout import Layout, LayoutType
from app.models.view_preset import ViewPreset


def _json_value(value: Any) -> Any:
    if isinstance(value, (uuid.UUID, datetime)):
        return value.isoformat() if isinstance(value, datetime) else str(value)
    return value


def snapshot_database(database: Database) -> dict[str, Any]:
    return {
        "id": str(database.id),
        "name": database.name,
        "icon": database.icon,
        "icon_color": database.icon_color,
        "description": database.description,
        "order": database.order,
    }


def snapshot_field(field: Field) -> dict[str, Any]:
    return {
        "id": str(field.id),
        "database_id": str(field.database_id),
        "name": field.name,
        "type": field.type.value,
        "icon": field.icon,
        "icon_color": field.icon_color,
        "options": field.options or {},
        "order": field.order,
        "created_at": _json_value(field.created_at),
        "updated_at": _json_value(field.updated_at),
    }


def snapshot_entity(entity: Entity) -> dict[str, Any]:
    return {
        "id": str(entity.id),
        "database_id": str(entity.database_id),
        "data_source_id": str(entity.data_source_id),
        "data": entity.data or {},
        "uid": entity.uid,
        "name": entity.name,
        "seq": entity.seq,
        "order": entity.order,
        "created_at": _json_value(entity.created_at),
        "updated_at": _json_value(entity.updated_at),
    }


def snapshot_link(link: EntityLink) -> dict[str, Any]:
    return {
        "id": str(link.id),
        "field_id": str(link.field_id),
        "source_entity_id": str(link.source_entity_id),
        "target_entity_id": str(link.target_entity_id),
        "created_at": _json_value(link.created_at),
        "updated_at": _json_value(link.updated_at),
    }


def snapshot_layout(layout: Layout) -> dict[str, Any]:
    return {
        "id": str(layout.id),
        "database_id": str(layout.database_id),
        "placement_id": str(layout.placement_id) if layout.placement_id else None,
        "source_layout_id": str(layout.source_layout_id) if layout.source_layout_id else None,
        "name": layout.name,
        "type": layout.type.value,
        "icon": layout.icon,
        "icon_color": layout.icon_color,
        "config": layout.config or {},
        "order": layout.order,
        "active_view_preset_id": (
            str(layout.active_view_preset_id) if layout.active_view_preset_id else None
        ),
        "created_at": _json_value(layout.created_at),
        "updated_at": _json_value(layout.updated_at),
    }


def snapshot_view_preset(preset: ViewPreset) -> dict[str, Any]:
    return {
        "id": str(preset.id),
        "layout_id": str(preset.layout_id),
        "name": preset.name,
        "filter": preset.filter or {},
        "sorts": preset.sorts or [],
        "group_field_id": preset.group_field_id,
        "hide_empty": preset.hide_empty,
        "order": preset.order,
        "created_at": _json_value(preset.created_at),
        "updated_at": _json_value(preset.updated_at),
    }


def snapshot_data_source(source: DataSource) -> dict[str, Any]:
    return {
        "id": str(source.id),
        "database_id": str(source.database_id),
        "name": source.name,
        "description": source.description,
        "kind": source.kind.value,
        "is_primary": source.is_primary,
        "origin_asset_id": str(source.origin_asset_id) if source.origin_asset_id else None,
        "origin_job_id": str(source.origin_job_id) if source.origin_job_id else None,
        "order": source.order,
        "created_at": _json_value(source.created_at),
        "updated_at": _json_value(source.updated_at),
    }


def record_database_change(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    database_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    action: str,
    summary: str,
    before: dict[str, Any] | None = None,
    created: dict[str, list[str | uuid.UUID]] | None = None,
) -> DatabaseChange:
    normalized_created = {
        key: [str(item) for item in values] for key, values in (created or {}).items() if values
    }
    change = DatabaseChange(
        workspace_id=workspace_id,
        database_id=database_id,
        actor_id=actor_id,
        action=action,
        summary=summary,
        before=before or {},
        created=normalized_created,
    )
    db.add(change)
    return change


def _dt(value: Any) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


async def _restore_data_source(db: AsyncSession, data: dict[str, Any]) -> None:
    source_id = uuid.UUID(data["id"])
    source = await db.get(DataSource, source_id)
    if source is None:
        source = DataSource(id=source_id, database_id=uuid.UUID(data["database_id"]))
        db.add(source)
    source.name = data["name"]
    source.description = data.get("description")
    source.kind = DataSourceKind(data["kind"])
    source.is_primary = bool(data.get("is_primary"))
    source.origin_asset_id = (
        uuid.UUID(data["origin_asset_id"]) if data.get("origin_asset_id") else None
    )
    source.origin_job_id = uuid.UUID(data["origin_job_id"]) if data.get("origin_job_id") else None
    source.order = int(data.get("order", 0))
    if created_at := _dt(data.get("created_at")):
        source.created_at = created_at
    if updated_at := _dt(data.get("updated_at")):
        source.updated_at = updated_at


async def _restore_field(db: AsyncSession, data: dict[str, Any]) -> None:
    field_id = uuid.UUID(data["id"])
    field = await db.get(Field, field_id)
    if field is None:
        field = Field(id=field_id, database_id=uuid.UUID(data["database_id"]))
        db.add(field)
    field.name = data["name"]
    field.type = FieldType(data["type"])
    field.icon = data.get("icon")
    field.icon_color = data.get("icon_color")
    field.options = dict(data.get("options") or {})
    field.order = int(data.get("order", 0))
    if created_at := _dt(data.get("created_at")):
        field.created_at = created_at
    if updated_at := _dt(data.get("updated_at")):
        field.updated_at = updated_at


async def _restore_entity(db: AsyncSession, data: dict[str, Any]) -> None:
    entity_id = uuid.UUID(data["id"])
    entity = await db.get(Entity, entity_id)
    if entity is None:
        entity = Entity(
            id=entity_id,
            database_id=uuid.UUID(data["database_id"]),
            data_source_id=uuid.UUID(data["data_source_id"]),
        )
        db.add(entity)
    entity.data_source_id = uuid.UUID(data["data_source_id"])
    entity.data = dict(data.get("data") or {})
    entity.uid = data["uid"]
    entity.name = data["name"]
    entity.seq = int(data["seq"])
    entity.order = int(data.get("order", data["seq"]))
    if created_at := _dt(data.get("created_at")):
        entity.created_at = created_at
    if updated_at := _dt(data.get("updated_at")):
        entity.updated_at = updated_at


async def _restore_link(db: AsyncSession, data: dict[str, Any]) -> None:
    link_id = uuid.UUID(data["id"])
    link = await db.get(EntityLink, link_id)
    if link is None:
        link = EntityLink(
            id=link_id,
            field_id=uuid.UUID(data["field_id"]),
            source_entity_id=uuid.UUID(data["source_entity_id"]),
            target_entity_id=uuid.UUID(data["target_entity_id"]),
        )
        db.add(link)
    if created_at := _dt(data.get("created_at")):
        link.created_at = created_at
    if updated_at := _dt(data.get("updated_at")):
        link.updated_at = updated_at


async def _restore_layout(db: AsyncSession, data: dict[str, Any]) -> None:
    layout_id = uuid.UUID(data["id"])
    layout = await db.get(Layout, layout_id)
    if layout is None:
        layout = Layout(id=layout_id, database_id=uuid.UUID(data["database_id"]))
        db.add(layout)
    layout.placement_id = uuid.UUID(data["placement_id"]) if data.get("placement_id") else None
    layout.source_layout_id = (
        uuid.UUID(data["source_layout_id"]) if data.get("source_layout_id") else None
    )
    layout.name = data["name"]
    layout.type = LayoutType(data["type"])
    layout.icon = data.get("icon")
    layout.icon_color = data.get("icon_color")
    layout.config = dict(data.get("config") or {})
    layout.order = int(data.get("order", 0))
    # ViewPreset points back to Layout, so the circular relationship is restored
    # in two phases. The active preset is assigned after presets exist again.
    layout.active_view_preset_id = None
    if created_at := _dt(data.get("created_at")):
        layout.created_at = created_at
    if updated_at := _dt(data.get("updated_at")):
        layout.updated_at = updated_at


async def _restore_view_preset(db: AsyncSession, data: dict[str, Any]) -> None:
    preset_id = uuid.UUID(data["id"])
    preset = await db.get(ViewPreset, preset_id)
    if preset is None:
        preset = ViewPreset(id=preset_id, layout_id=uuid.UUID(data["layout_id"]))
        db.add(preset)
    preset.name = data["name"]
    preset.filter = dict(data.get("filter") or {})
    preset.sorts = list(data.get("sorts") or [])
    preset.group_field_id = data.get("group_field_id")
    preset.hide_empty = bool(data.get("hide_empty"))
    preset.order = int(data.get("order", 0))
    if created_at := _dt(data.get("created_at")):
        preset.created_at = created_at
    if updated_at := _dt(data.get("updated_at")):
        preset.updated_at = updated_at


async def restore_database_change(
    db: AsyncSession,
    *,
    change: DatabaseChange,
    actor_id: uuid.UUID,
) -> tuple[dict[str, int], dict[str, list[uuid.UUID]]]:
    """Apply the inverse payload for one history item in dependency-safe order."""
    if change.reverted_at is not None:
        raise ValueError("This change has already been restored")

    created = change.created or {}
    affected: dict[str, list[uuid.UUID]] = {}
    restored: dict[str, int] = {}

    created_entity_ids = [uuid.UUID(value) for value in created.get("entities", [])]
    created_link_ids = [uuid.UUID(value) for value in created.get("links", [])]
    created_field_ids = [uuid.UUID(value) for value in created.get("fields", [])]
    created_layout_ids = [uuid.UUID(value) for value in created.get("layouts", [])]
    created_preset_ids = [uuid.UUID(value) for value in created.get("view_presets", [])]
    created_source_ids = [uuid.UUID(value) for value in created.get("data_sources", [])]

    if created_link_ids:
        await db.execute(delete(EntityLink).where(EntityLink.id.in_(created_link_ids)))
        affected["links"] = created_link_ids
        restored["removed_links"] = len(created_link_ids)
    if created_entity_ids:
        await db.execute(
            delete(EntityLink).where(
                or_(
                    EntityLink.source_entity_id.in_(created_entity_ids),
                    EntityLink.target_entity_id.in_(created_entity_ids),
                )
            )
        )
        await db.execute(delete(Entity).where(Entity.id.in_(created_entity_ids)))
        affected["entities"] = created_entity_ids
        restored["removed_entities"] = len(created_entity_ids)
    if created_layout_ids:
        await db.execute(delete(Layout).where(Layout.id.in_(created_layout_ids)))
        affected["layouts"] = created_layout_ids
        restored["removed_layouts"] = len(created_layout_ids)
    elif created_preset_ids:
        await db.execute(delete(ViewPreset).where(ViewPreset.id.in_(created_preset_ids)))
        affected["view_presets"] = created_preset_ids
        restored["removed_view_presets"] = len(created_preset_ids)
    if created_field_ids:
        await db.execute(delete(Field).where(Field.id.in_(created_field_ids)))
        affected["fields"] = created_field_ids
        restored["removed_fields"] = len(created_field_ids)
    if created_source_ids:
        await db.execute(delete(DataSource).where(DataSource.id.in_(created_source_ids)))
        affected["data_sources"] = created_source_ids
        restored["removed_data_sources"] = len(created_source_ids)

    before = change.before or {}
    if database_data := before.get("database"):
        database = await db.get(Database, change.database_id)
        if database is None:
            raise ValueError("Database no longer exists")
        database.name = database_data["name"]
        database.icon = database_data.get("icon")
        database.icon_color = database_data.get("icon_color")
        database.description = database_data.get("description")
        database.order = int(database_data.get("order", database.order))
        restored["database"] = 1

    for data in before.get("data_sources", []):
        await _restore_data_source(db, data)
    await db.flush()
    for data in before.get("fields", []):
        await _restore_field(db, data)
    await db.flush()
    for data in before.get("entities", []):
        await _restore_entity(db, data)
    await db.flush()
    for data in before.get("links", []):
        await _restore_link(db, data)
    for data in before.get("layouts", []):
        await _restore_layout(db, data)
    await db.flush()
    for data in before.get("view_presets", []):
        await _restore_view_preset(db, data)
    await db.flush()
    for data in before.get("layouts", []):
        if active_id := data.get("active_view_preset_id"):
            layout = await db.get(Layout, uuid.UUID(data["id"]))
            preset = await db.get(ViewPreset, uuid.UUID(active_id))
            if layout is not None and preset is not None and preset.layout_id == layout.id:
                layout.active_view_preset_id = preset.id

    for key in ("data_sources", "fields", "entities", "links", "layouts", "view_presets"):
        count = len(before.get(key, []))
        if count:
            restored[f"restored_{key}"] = count
            ids = [
                uuid.UUID(item["id"])
                for item in before[key]
                if isinstance(item, dict) and item.get("id")
            ]
            if ids:
                affected[key] = ids

    change.reverted_at = datetime.now(UTC)
    change.reverted_by_id = actor_id
    return restored, affected


async def latest_undoable_change(db: AsyncSession, database_id: uuid.UUID) -> DatabaseChange | None:
    result = await db.scalars(
        select(DatabaseChange)
        .where(
            DatabaseChange.database_id == database_id,
            DatabaseChange.reverted_at.is_(None),
        )
        .order_by(DatabaseChange.created_at.desc(), DatabaseChange.id.desc())
        .limit(1)
    )
    return result.first()
