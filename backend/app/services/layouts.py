"""Canonical and placement-specific Layout helpers."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.layout import Layout, LayoutType
from app.models.resource import SpaceDatabasePlacement


async def ensure_canonical_layouts(
    db: AsyncSession,
    database_id: uuid.UUID,
) -> tuple[list[Layout], bool]:
    """Return Database-owned layouts, lazily seeding the default Table."""

    result = await db.execute(
        select(Layout)
        .where(Layout.database_id == database_id, Layout.placement_id.is_(None))
        .order_by(Layout.order, Layout.created_at)
    )
    layouts = list(result.scalars().all())
    if layouts:
        return layouts, False
    layout = Layout(
        database_id=database_id,
        name="Table",
        type=LayoutType.table,
        icon="table",
        config={},
        order=0,
    )
    db.add(layout)
    await db.flush()
    return [layout], True


async def ensure_placement_layouts(
    db: AsyncSession,
    placement: SpaceDatabasePlacement,
) -> tuple[list[Layout], bool]:
    """Clone canonical layouts once, then return the placement-owned copies."""

    result = await db.execute(
        select(Layout)
        .where(Layout.placement_id == placement.id)
        .order_by(Layout.order, Layout.created_at)
    )
    layouts = list(result.scalars().all())
    if layouts:
        if placement.layout_id not in {layout.id for layout in layouts}:
            placement.layout_id = layouts[0].id
            return layouts, True
        return layouts, False

    canonical, _ = await ensure_canonical_layouts(db, placement.database_id)
    selected_source_id = placement.layout_id
    clones: list[Layout] = []
    for source in canonical:
        clone = Layout(
            database_id=placement.database_id,
            placement_id=placement.id,
            source_layout_id=source.id,
            name=source.name,
            type=source.type,
            icon=source.icon,
            icon_color=source.icon_color,
            config=dict(source.config or {}),
            order=source.order,
        )
        db.add(clone)
        clones.append(clone)
    await db.flush()
    placement.layout_id = next(
        (
            clone.id
            for clone in clones
            if clone.source_layout_id == selected_source_id
        ),
        clones[0].id,
    )
    return clones, True
