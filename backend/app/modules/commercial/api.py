"""Commercial Data foundation routes."""

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.commercial import (
    CommercialCatalogBinding,
    CommercialCatalogKind,
    CustomerAccount,
    CustomerAddress,
    CustomerContact,
    FxRateVersion,
    LegalParty,
    MasterLifecycle,
    MigrationBatch,
    MigrationCandidate,
    MigrationConflict,
    MigrationConflictStatus,
    MigrationSourceRow,
    PriceStatus,
    ProductMaster,
    ProductPriceVersion,
    SupplierMaster,
)
from app.models.data_source import DataSource
from app.models.database import Database
from app.models.field import Field, FieldType
from app.models.user import User
from app.models.workspace import Workspace
from app.modules.commercial.commands import execute_commercial_command, version_conflict
from app.modules.commercial.migration_quality.service import (
    batch_out,
    candidate_out,
    create_batch,
    promote_candidate,
    remap_candidate,
    resolve_conflict,
    review_candidate,
)
from app.modules.commercial.policy import (
    resolve_capabilities,
    update_capability_assignment,
    update_cohort,
)
from app.modules.commercial.pricing.service import cost_plus_margin
from app.modules.commercial.schemas import (
    AddressCreateIn,
    CommercialBootstrapOut,
    CommercialCapability,
    CommercialCapabilityAssignmentOut,
    CommercialCapabilityAssignmentUpdate,
    CommercialCatalogOut,
    CommercialCohortOut,
    CommercialCohortUpdate,
    CommercialNavigationItem,
    ContactCreateIn,
    CustomerCreateIn,
    CustomerUpdateIn,
    FxRateCreateIn,
    LegalPartyCreateIn,
    MasterLifecycleIn,
    MigrationBatchCreate,
    MigrationBatchOut,
    MigrationCandidateOut,
    MigrationConflictOut,
    MigrationConflictResolveIn,
    MigrationQualitySummaryOut,
    MigrationRemapIn,
    MigrationReviewIn,
    OralPriceDecisionIn,
    PriceApprovalIn,
    PriceDecisionIn,
    PriceVersionCreateIn,
    ProductCreateIn,
    ProductUpdateIn,
    SupplierCreateIn,
)
from app.services.authorization import Action, require_workspace_action
from app.services.events import record_event

router = APIRouter(prefix="/commercial", tags=["commercial"])


def _product_out(row: ProductMaster) -> dict[str, object]:
    return {
        "id": str(row.id),
        "sku": row.sku,
        "name": row.name,
        "base_unit": row.base_unit,
        "origin_country": row.origin_country,
        "lifecycle": row.lifecycle.value,
        "merged_into_id": str(row.merged_into_id) if row.merged_into_id else None,
        "version": row.version,
    }


def _customer_out(row: CustomerAccount) -> dict[str, object]:
    return {
        "id": str(row.id),
        "name": row.name,
        "sales_pic_id": str(row.sales_pic_id) if row.sales_pic_id else None,
        "lifecycle": row.lifecycle.value,
        "merged_into_id": str(row.merged_into_id) if row.merged_into_id else None,
        "version": row.version,
    }


_CAPABILITY_CONTRACT_VERSION = "commercial-foundation-v1"
_LIFECYCLE_CHOICES = [
    {"id": "not_started", "label": "Not started", "color": "gray", "group": "not_started"},
    {"id": "active", "label": "Active", "color": "green", "group": "in_progress"},
    {"id": "on_hold", "label": "On hold", "color": "yellow", "group": "in_progress"},
    {"id": "retired", "label": "Retired", "color": "red", "group": "complete"},
]
_LIFECYCLE_OPTIONS: dict[str, object] = {
    "domain_key": "lifecycle",
    "choices": _LIFECYCLE_CHOICES,
}
_CATALOG_DEFINITIONS: dict[
    CommercialCatalogKind, tuple[str, str, str, list[tuple[str, FieldType, dict[str, object]]]]
] = {
    CommercialCatalogKind.products: (
        "Products",
        "box-open",
        "Product master data. Add fields such as CBM, packaging, brand or "
        "certifications as needed.",
        [
            ("SKU", FieldType.text, {"domain_key": "sku"}),
            ("Base unit", FieldType.text, {"domain_key": "base_unit"}),
            ("Origin country", FieldType.country, {"domain_key": "origin_country"}),
            ("Barcode", FieldType.text, {"domain_key": "barcode"}),
            ("CBM", FieldType.number, {"domain_key": "cbm", "format": "plain"}),
            ("Lifecycle", FieldType.status, _LIFECYCLE_OPTIONS),
        ],
    ),
    CommercialCatalogKind.customers: (
        "Customers",
        "users",
        "Customer accounts and commercial profile. Add market-specific fields "
        "without schema changes.",
        [
            ("Email", FieldType.email, {"domain_key": "email"}),
            ("Phone", FieldType.phone, {"domain_key": "phone"}),
            ("Country", FieldType.country, {"domain_key": "country"}),
            ("Website", FieldType.url, {"domain_key": "website"}),
            ("Sales PIC", FieldType.people, {"domain_key": "sales_pic"}),
            ("Lifecycle", FieldType.status, _LIFECYCLE_OPTIONS),
        ],
    ),
    CommercialCatalogKind.suppliers: (
        "Suppliers",
        "truck",
        "Supplier master data and sourcing attributes with configurable fields and views.",
        [
            ("Supplier code", FieldType.text, {"domain_key": "supplier_code"}),
            ("Country", FieldType.country, {"domain_key": "country"}),
            ("Email", FieldType.email, {"domain_key": "email"}),
            ("Phone", FieldType.phone, {"domain_key": "phone"}),
            ("Website", FieldType.url, {"domain_key": "website"}),
            ("Lifecycle", FieldType.status, _LIFECYCLE_OPTIONS),
        ],
    ),
}
_DESTINATIONS = (
    CommercialNavigationItem(
        id="quality",
        href="/commercial-data/quality",
        label_key="navigation.quality",
        icon="shield-alt",
        order=10,
        capability="commercial.quality.read",
        badge_source_id="migration-quality.open-assigned",
        fallback_eligible=True,
    ),
    CommercialNavigationItem(
        id="pricing",
        href="/commercial-data/pricing",
        label_key="navigation.pricing",
        icon="calculator",
        order=20,
        capability="commercial.pricing.read",
    ),
)


@router.post(
    "/catalogs/{kind}/ensure",
    response_model=CommercialCatalogOut,
)
async def ensure_commercial_catalog(
    kind: CommercialCatalogKind,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CommercialCatalogOut:
    """Return or idempotently provision the dynamic Database behind a catalog mini app."""
    binding = await db.scalar(
        select(CommercialCatalogBinding).where(
            CommercialCatalogBinding.workspace_id == workspace.id,
            CommercialCatalogBinding.kind == kind,
        )
    )
    if binding is not None:
        database = await db.get(Database, binding.database_id)
        if database is None or database.workspace_id != workspace.id:
            raise HTTPException(409, "Catalog binding points to a missing database")
        lifecycle_field = await db.scalar(
            select(Field).where(
                Field.database_id == database.id,
                Field.type == FieldType.status,
            )
        )
        if lifecycle_field is not None and not lifecycle_field.options.get("choices"):
            await require_workspace_action(
                db,
                workspace_id=workspace.id,
                user_id=current_user.id,
                action=Action.write,
            )
            lifecycle_field.options = {
                **lifecycle_field.options,
                "choices": [dict(choice) for choice in _LIFECYCLE_CHOICES],
            }
            record_event(
                db,
                action="commercial.catalog_defaults_reconciled",
                resource_type="database",
                resource_id=str(database.id),
                workspace_id=workspace.id,
                actor_id=current_user.id,
                data={"kind": kind.value, "field_id": str(lifecycle_field.id)},
            )
            await db.commit()
        return CommercialCatalogOut(
            kind=kind,
            database_id=database.id,
            name=database.name,
            created=False,
        )

    await require_workspace_action(
        db,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    name, icon, description, definitions = _CATALOG_DEFINITIONS[kind]
    highest_order = await db.scalar(
        select(func.coalesce(func.max(Database.order), -1)).where(
            Database.workspace_id == workspace.id
        )
    )
    database = Database(
        workspace_id=workspace.id,
        name=name,
        icon=icon,
        icon_color="#1264d7",
        description=description,
        order=int(highest_order if highest_order is not None else -1) + 1,
    )
    db.add(database)
    await db.flush()
    fields = [
        Field(
            database_id=database.id,
            name="ID",
            type=FieldType.unique_id,
            icon="fingerprint",
            options={"prefix": kind.value[:3].upper(), "system_key": "uid", "required": True},
            order=0,
        ),
        Field(
            database_id=database.id,
            name="Name",
            type=FieldType.name,
            icon="font",
            options={"system_key": "name", "required": True},
            order=1,
        ),
    ]
    fields.extend(
        Field(
            database_id=database.id,
            name=field_name,
            type=field_type,
            options=options,
            order=index + 2,
        )
        for index, (field_name, field_type, options) in enumerate(definitions)
    )
    source = DataSource(
        database_id=database.id,
        name="Manual",
        description=f"Manual records created in the {name} mini app",
        is_primary=True,
        order=0,
    )
    db.add_all([*fields, source])
    await db.flush()
    binding = CommercialCatalogBinding(
        workspace_id=workspace.id,
        kind=kind,
        database_id=database.id,
        created_by_id=current_user.id,
    )
    db.add(binding)
    record_event(
        db,
        action="commercial.catalog_provisioned",
        resource_type="database",
        resource_id=str(database.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={"kind": kind.value},
    )
    await db.commit()
    return CommercialCatalogOut(
        kind=kind,
        database_id=database.id,
        name=database.name,
        created=True,
    )


@router.get("/bootstrap", response_model=CommercialBootstrapOut)
async def commercial_bootstrap(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> CommercialBootstrapOut:
    """Return the complete authorized shell contract in one bounded request."""
    capabilities, policy = await resolve_capabilities(
        db,
        workspace_id=workspace.id,
        user_id=current_user.id,
    )
    destinations = [
        item for item in _DESTINATIONS if CommercialCapability(item.capability) in capabilities
    ]
    if CommercialCapability.quality_read in capabilities:
        open_quality_items = (
            await db.scalar(
                select(func.count(MigrationCandidate.id)).where(
                    MigrationCandidate.workspace_id == workspace.id,
                    MigrationCandidate.status.in_(["pending", "needs_review"]),
                )
            )
            or 0
        )
        destinations = [
            item.model_copy(update={"badge_count": open_quality_items})
            if item.id == "quality"
            else item
            for item in destinations
        ]
    enabled = settings.commercial_foundation_enabled and bool(destinations)
    policy_version = policy.version if policy is not None else 0
    return CommercialBootstrapOut(
        enabled=enabled,
        workspace_id=workspace.id,
        capability_version=f"{_CAPABILITY_CONTRACT_VERSION}:{policy_version}",
        cohort=policy.cohort if policy is not None else "foundation",
        as_of=dt.datetime.now(dt.UTC),
        destinations=destinations if enabled else [],
    )


IdempotencyKey = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=1, max_length=200),
]


@router.put(
    "/capabilities/{capability}",
    response_model=CommercialCapabilityAssignmentOut,
)
async def put_capability_assignment(
    capability: CommercialCapability,
    payload: CommercialCapabilityAssignmentUpdate,
    response: Response,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await require_workspace_action(
        db,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )

    async def handler() -> dict[str, object]:
        try:
            return await update_capability_assignment(
                db,
                workspace=workspace,
                actor=current_user,
                capability=capability,
                payload=payload,
            )
        except ValueError as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                str(exc),
            ) from exc

    result, replayed = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name=f"commercial.capability.update:{capability.value}",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    response.headers["Idempotency-Replayed"] = "true" if replayed else "false"
    return result


@router.post("/pricing/versions/{price_id}/approve")
async def approve_price_version(
    price_id: uuid.UUID,
    payload: PriceApprovalIn,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await require_workspace_action(
        db,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.pricing_read,
        detail="Pricing access is required",
    )

    async def handler() -> dict[str, object]:
        row = await db.scalar(
            select(ProductPriceVersion)
            .where(
                ProductPriceVersion.id == price_id, ProductPriceVersion.workspace_id == workspace.id
            )
            .with_for_update()
        )
        if row is None:
            raise HTTPException(404, "Price version not found")
        if row.version != payload.expected_version:
            raise version_conflict(
                expected_version=payload.expected_version,
                current_version=row.version,
                changed_fields=["approved_price", "status"],
            )
        row.approved_price, row.approval_note, row.approved_by_id = (
            payload.approved_price,
            payload.approval_note,
            current_user.id,
        )
        row.status = PriceStatus.oral_pending if payload.oral_pending else PriceStatus.approved
        row.approved_at, row.version = dt.datetime.now(dt.UTC), row.version + 1
        record_event(
            db,
            action="commercial.price_approved",
            resource_type="product_price_version",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=current_user.id,
            data={
                "status": row.status.value,
                "approved_price": str(row.approved_price),
                "version": row.version,
            },
        )
        return {
            "id": str(row.id),
            "status": row.status.value,
            "approved_price": str(row.approved_price),
            "version": row.version,
        }

    result, _ = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name=f"commercial.price.approve:{price_id}",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    return result


@router.put("/cohort", response_model=CommercialCohortOut)
async def put_commercial_cohort(
    payload: CommercialCohortUpdate,
    response: Response,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await require_workspace_action(
        db,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )

    async def handler() -> dict[str, object]:
        return await update_cohort(
            db,
            workspace=workspace,
            actor=current_user,
            payload=payload,
        )

    result, replayed = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name="commercial.cohort.update",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    response.headers["Idempotency-Replayed"] = "true" if replayed else "false"
    return result


async def _require_quality_access(
    db: AsyncSession, workspace: Workspace, current_user: User
) -> None:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.quality_read,
        detail="Commercial Data Quality access is required",
    )


async def _require_commercial_capability(
    db: AsyncSession,
    *,
    workspace: Workspace,
    current_user: User,
    capability: CommercialCapability,
    detail: str,
) -> None:
    capabilities, _ = await resolve_capabilities(
        db, workspace_id=workspace.id, user_id=current_user.id
    )
    if capability not in capabilities:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail)


@router.get("/quality/summary", response_model=MigrationQualitySummaryOut)
async def migration_quality_summary(
    limit: int = Query(default=100, ge=1, le=250),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_quality_access(db, workspace, current_user)
    batches = (
        (
            await db.execute(
                select(MigrationBatch)
                .where(MigrationBatch.workspace_id == workspace.id)
                .order_by(MigrationBatch.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    candidates = (
        (
            await db.execute(
                select(MigrationCandidate)
                .where(
                    MigrationCandidate.workspace_id == workspace.id,
                    MigrationCandidate.status.in_(["needs_review", "pending", "verified"]),
                )
                .order_by(MigrationCandidate.updated_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    exceptions = [await candidate_out(db, candidate) for candidate in candidates]
    open_conflicts = (
        await db.scalar(
            select(func.count(MigrationConflict.id)).where(
                MigrationConflict.workspace_id == workspace.id,
                MigrationConflict.status == MigrationConflictStatus.open,
            )
        )
        or 0
    )
    verified = (
        await db.scalar(
            select(func.count(MigrationCandidate.id)).where(
                MigrationCandidate.workspace_id == workspace.id,
                MigrationCandidate.status.in_(["verified", "promoted"]),
            )
        )
        or 0
    )
    return {
        "batches": [batch_out(batch) for batch in batches],
        "exceptions": exceptions,
        "open_conflicts": open_conflicts,
        "verified_candidates": verified,
        "as_of": dt.datetime.now(dt.UTC),
    }


@router.get("/quality/candidates/{candidate_id}")
async def migration_candidate_detail(
    candidate_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_quality_access(db, workspace, current_user)
    candidate = await db.scalar(
        select(MigrationCandidate).where(
            MigrationCandidate.id == candidate_id,
            MigrationCandidate.workspace_id == workspace.id,
        )
    )
    if candidate is None:
        raise HTTPException(404, "Candidate not found")
    source = await db.get(MigrationSourceRow, candidate.source_row_id)
    conflicts = (
        (
            await db.execute(
                select(MigrationConflict)
                .where(MigrationConflict.candidate_id == candidate.id)
                .order_by(MigrationConflict.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    result = await candidate_out(db, candidate)
    result["raw_values"] = source.raw_values if source else {}
    result["source_url"] = source.source_url if source else None
    result["conflicts"] = [
        {
            "id": str(item.id),
            "kind": item.kind,
            "detail": item.detail,
            "field_paths": item.field_paths,
            "status": item.status.value,
            "resolution": item.resolution,
        }
        for item in conflicts
    ]
    return result


@router.get("/quality/reconciliation")
async def migration_reconciliation(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    await _require_quality_access(db, workspace, current_user)
    rows = (
        await db.execute(
            select(
                MigrationBatch.id,
                MigrationBatch.source_label,
                MigrationBatch.total_rows,
                MigrationCandidate.status,
                func.count(MigrationCandidate.id),
            )
            .outerjoin(MigrationCandidate, MigrationCandidate.batch_id == MigrationBatch.id)
            .where(MigrationBatch.workspace_id == workspace.id)
            .group_by(MigrationBatch.id, MigrationCandidate.status)
            .order_by(MigrationBatch.created_at.desc())
        )
    ).all()
    grouped: dict[str, dict[str, object]] = {}
    for batch_id, label, total, candidate_status, count in rows:
        entry = grouped.setdefault(
            str(batch_id),
            {"batch_id": str(batch_id), "source_label": label, "total_rows": total, "states": {}},
        )
        if candidate_status is not None:
            states = entry["states"]
            assert isinstance(states, dict)
            states[candidate_status.value] = count
    return list(grouped.values())


@router.post(
    "/quality/batches", response_model=MigrationBatchOut, status_code=status.HTTP_201_CREATED
)
async def post_migration_batch(
    payload: MigrationBatchCreate,
    response: Response,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_quality_access(db, workspace, current_user)
    result, replayed = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name="commercial.migration.batch.stage",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=lambda: create_batch(
            db, workspace_id=workspace.id, actor=current_user, payload=payload
        ),
    )
    response.headers["Idempotency-Replayed"] = "true" if replayed else "false"
    response.status_code = status.HTTP_200_OK if replayed else status.HTTP_201_CREATED
    return result


@router.post("/quality/candidates/{candidate_id}/review", response_model=MigrationCandidateOut)
async def post_candidate_review(
    candidate_id: uuid.UUID,
    payload: MigrationReviewIn,
    response: Response,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_quality_access(db, workspace, current_user)

    async def handler() -> dict[str, object]:
        try:
            return await review_candidate(
                db,
                workspace_id=workspace.id,
                actor=current_user,
                candidate_id=candidate_id,
                payload=payload,
            )
        except LookupError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    result, replayed = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name=f"commercial.migration.candidate.review:{candidate_id}",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    response.headers["Idempotency-Replayed"] = "true" if replayed else "false"
    return result


@router.post("/quality/candidates/{candidate_id}/remap", response_model=MigrationCandidateOut)
async def post_candidate_remap(
    candidate_id: uuid.UUID,
    payload: MigrationRemapIn,
    response: Response,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_quality_access(db, workspace, current_user)

    async def handler() -> dict[str, object]:
        try:
            return await remap_candidate(
                db,
                workspace_id=workspace.id,
                actor=current_user,
                candidate_id=candidate_id,
                payload=payload,
            )
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc

    result, replayed = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name=f"commercial.migration.candidate.remap:{candidate_id}",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    response.headers["Idempotency-Replayed"] = "true" if replayed else "false"
    return result


@router.post("/quality/conflicts/{conflict_id}/resolve", response_model=MigrationConflictOut)
async def post_conflict_resolution(
    conflict_id: uuid.UUID,
    payload: MigrationConflictResolveIn,
    response: Response,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_quality_access(db, workspace, current_user)

    async def handler() -> dict[str, object]:
        try:
            return await resolve_conflict(
                db,
                workspace_id=workspace.id,
                actor=current_user,
                conflict_id=conflict_id,
                payload=payload,
            )
        except LookupError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    result, replayed = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name=f"commercial.migration.conflict.resolve:{conflict_id}",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    response.headers["Idempotency-Replayed"] = "true" if replayed else "false"
    return result


@router.post("/quality/candidates/{candidate_id}/promote")
async def post_candidate_promotion(
    candidate_id: uuid.UUID,
    response: Response,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_quality_access(db, workspace, current_user)

    async def handler() -> dict[str, object]:
        try:
            return await promote_candidate(
                db, workspace_id=workspace.id, actor=current_user, candidate_id=candidate_id
            )
        except LookupError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    result, replayed = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name=f"commercial.migration.candidate.promote:{candidate_id}",
        idempotency_key=idempotency_key,
        request_payload={"candidate_id": str(candidate_id)},
        handler=handler,
    )
    response.headers["Idempotency-Replayed"] = "true" if replayed else "false"
    return result


@router.get("/products")
async def list_products(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.products_read,
        detail="Product access is required",
    )
    rows = (
        (
            await db.execute(
                select(ProductMaster)
                .where(ProductMaster.workspace_id == workspace.id)
                .order_by(ProductMaster.name)
            )
        )
        .scalars()
        .all()
    )
    return [_product_out(row) for row in rows]


@router.post("/products", status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreateIn,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.products_read,
        detail="Product access is required",
    )

    async def handler() -> dict[str, object]:
        row = ProductMaster(
            workspace_id=workspace.id, created_by_id=current_user.id, **payload.model_dump()
        )
        db.add(row)
        await db.flush()
        return {
            "id": str(row.id),
            "sku": row.sku,
            "name": row.name,
            "lifecycle": row.lifecycle.value,
            "version": row.version,
        }

    result, _ = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name="commercial.product.create",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    return result


@router.patch("/products/{product_id}")
async def update_product(
    product_id: uuid.UUID,
    payload: ProductUpdateIn,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.products_read,
        detail="Product access is required",
    )

    async def handler() -> dict[str, object]:
        row = await db.scalar(
            select(ProductMaster)
            .where(ProductMaster.id == product_id, ProductMaster.workspace_id == workspace.id)
            .with_for_update()
        )
        if row is None:
            raise HTTPException(404, "Product not found")
        if row.version != payload.expected_version:
            raise version_conflict(
                expected_version=payload.expected_version,
                current_version=row.version,
                changed_fields=["sku", "name", "base_unit", "origin_country"],
            )
        for field, value in payload.model_dump(
            exclude={"expected_version"}, exclude_unset=True
        ).items():
            setattr(row, field, value)
        row.version += 1
        record_event(
            db,
            action="commercial.product_updated",
            resource_type="product_master",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=current_user.id,
            data={"version": row.version},
        )
        return _product_out(row)

    result, _ = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name=f"commercial.product.update:{product_id}",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    return result


@router.post("/products/{product_id}/lifecycle")
async def change_product_lifecycle(
    product_id: uuid.UUID,
    payload: MasterLifecycleIn,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.products_read,
        detail="Product access is required",
    )

    async def handler() -> dict[str, object]:
        row = await db.scalar(
            select(ProductMaster)
            .where(ProductMaster.id == product_id, ProductMaster.workspace_id == workspace.id)
            .with_for_update()
        )
        if row is None:
            raise HTTPException(404, "Product not found")
        if row.version != payload.expected_version:
            raise version_conflict(
                expected_version=payload.expected_version,
                current_version=row.version,
                changed_fields=["lifecycle", "merged_into_id"],
            )
        if payload.action == "merge":
            if payload.merge_into_id is None or payload.merge_into_id == row.id:
                raise HTTPException(422, "A different merge target is required")
            target = await db.scalar(
                select(ProductMaster).where(
                    ProductMaster.id == payload.merge_into_id,
                    ProductMaster.workspace_id == workspace.id,
                )
            )
            if target is None:
                raise HTTPException(422, "Merge target not found")
            row.lifecycle, row.merged_into_id = MasterLifecycle.merged, target.id
        else:
            row.lifecycle = MasterLifecycle.discontinued
        row.version += 1
        record_event(
            db,
            action=f"commercial.product_{payload.action}d",
            resource_type="product_master",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=current_user.id,
            data={"merge_into_id": str(row.merged_into_id) if row.merged_into_id else None},
        )
        return _product_out(row)

    result, _ = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name=f"commercial.product.lifecycle:{product_id}",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    return result


@router.get("/suppliers")
async def list_suppliers(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.products_read,
        detail="Product access is required",
    )
    rows = (
        (
            await db.execute(
                select(SupplierMaster)
                .where(SupplierMaster.workspace_id == workspace.id)
                .order_by(SupplierMaster.name)
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": str(row.id),
            "name": row.name,
            "supplier_code": row.supplier_code,
            "country": row.country,
            "lifecycle": row.lifecycle.value,
            "version": row.version,
        }
        for row in rows
    ]


@router.post("/suppliers", status_code=status.HTTP_201_CREATED)
async def create_supplier(
    payload: SupplierCreateIn,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.products_read,
        detail="Product access is required",
    )

    async def handler() -> dict[str, object]:
        row = SupplierMaster(
            workspace_id=workspace.id, created_by_id=current_user.id, **payload.model_dump()
        )
        db.add(row)
        await db.flush()
        record_event(
            db,
            action="commercial.supplier_created",
            resource_type="supplier_master",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=current_user.id,
            data={"name": row.name},
        )
        return {
            "id": str(row.id),
            "name": row.name,
            "supplier_code": row.supplier_code,
            "country": row.country,
            "lifecycle": row.lifecycle.value,
            "version": row.version,
        }

    result, _ = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name="commercial.supplier.create",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    return result


@router.get("/customers")
async def list_customers(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.customers_read,
        detail="Customer access is required",
    )
    rows = (
        (
            await db.execute(
                select(CustomerAccount)
                .where(CustomerAccount.workspace_id == workspace.id)
                .order_by(CustomerAccount.name)
            )
        )
        .scalars()
        .all()
    )
    return [_customer_out(row) for row in rows]


@router.post("/customers", status_code=status.HTTP_201_CREATED)
async def create_customer(
    payload: CustomerCreateIn,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.customers_read,
        detail="Customer access is required",
    )

    async def handler() -> dict[str, object]:
        row = CustomerAccount(
            workspace_id=workspace.id, created_by_id=current_user.id, **payload.model_dump()
        )
        db.add(row)
        await db.flush()
        return {
            "id": str(row.id),
            "name": row.name,
            "lifecycle": row.lifecycle.value,
            "version": row.version,
        }

    result, _ = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name="commercial.customer.create",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    return result


@router.patch("/customers/{customer_id}")
async def update_customer(
    customer_id: uuid.UUID,
    payload: CustomerUpdateIn,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.customers_read,
        detail="Customer access is required",
    )

    async def handler() -> dict[str, object]:
        row = await db.scalar(
            select(CustomerAccount)
            .where(CustomerAccount.id == customer_id, CustomerAccount.workspace_id == workspace.id)
            .with_for_update()
        )
        if row is None:
            raise HTTPException(404, "Customer not found")
        if row.version != payload.expected_version:
            raise version_conflict(
                expected_version=payload.expected_version,
                current_version=row.version,
                changed_fields=["name", "sales_pic_id"],
            )
        for field, value in payload.model_dump(
            exclude={"expected_version"}, exclude_unset=True
        ).items():
            setattr(row, field, value)
        row.version += 1
        record_event(
            db,
            action="commercial.customer_updated",
            resource_type="customer_account",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=current_user.id,
            data={"version": row.version},
        )
        return _customer_out(row)

    result, _ = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name=f"commercial.customer.update:{customer_id}",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    return result


@router.post("/customers/{customer_id}/lifecycle")
async def change_customer_lifecycle(
    customer_id: uuid.UUID,
    payload: MasterLifecycleIn,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.customers_read,
        detail="Customer access is required",
    )

    async def handler() -> dict[str, object]:
        row = await db.scalar(
            select(CustomerAccount)
            .where(CustomerAccount.id == customer_id, CustomerAccount.workspace_id == workspace.id)
            .with_for_update()
        )
        if row is None:
            raise HTTPException(404, "Customer not found")
        if row.version != payload.expected_version:
            raise version_conflict(
                expected_version=payload.expected_version,
                current_version=row.version,
                changed_fields=["lifecycle", "merged_into_id"],
            )
        if payload.action == "merge":
            if payload.merge_into_id is None or payload.merge_into_id == row.id:
                raise HTTPException(422, "A different merge target is required")
            target = await db.scalar(
                select(CustomerAccount).where(
                    CustomerAccount.id == payload.merge_into_id,
                    CustomerAccount.workspace_id == workspace.id,
                )
            )
            if target is None:
                raise HTTPException(422, "Merge target not found")
            row.lifecycle, row.merged_into_id = MasterLifecycle.merged, target.id
        else:
            row.lifecycle = MasterLifecycle.discontinued
        row.version += 1
        record_event(
            db,
            action=f"commercial.customer_{payload.action}d",
            resource_type="customer_account",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=current_user.id,
            data={"merge_into_id": str(row.merged_into_id) if row.merged_into_id else None},
        )
        return _customer_out(row)

    result, _ = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name=f"commercial.customer.lifecycle:{customer_id}",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    return result


@router.get("/customers/{customer_id}/profile")
async def customer_profile(
    customer_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.customers_read,
        detail="Customer access is required",
    )
    customer = await db.scalar(
        select(CustomerAccount).where(
            CustomerAccount.id == customer_id, CustomerAccount.workspace_id == workspace.id
        )
    )
    if customer is None:
        raise HTTPException(404, "Customer not found")
    parties = (
        (
            await db.execute(
                select(LegalParty).where(
                    LegalParty.workspace_id == workspace.id,
                    LegalParty.customer_account_id == customer_id,
                )
            )
        )
        .scalars()
        .all()
    )
    contacts = (
        (
            await db.execute(
                select(CustomerContact).where(
                    CustomerContact.workspace_id == workspace.id,
                    CustomerContact.customer_account_id == customer_id,
                )
            )
        )
        .scalars()
        .all()
    )
    addresses = (
        (
            await db.execute(
                select(CustomerAddress).where(
                    CustomerAddress.workspace_id == workspace.id,
                    CustomerAddress.customer_account_id == customer_id,
                )
            )
        )
        .scalars()
        .all()
    )
    return {
        "customer": _customer_out(customer),
        "legal_parties": [
            {
                "id": str(x.id),
                "legal_name": x.legal_name,
                "tax_identifier": x.tax_identifier,
                "country": x.country,
            }
            for x in parties
        ],
        "contacts": [
            {
                "id": str(x.id),
                "full_name": x.full_name,
                "email": x.email,
                "phone": x.phone,
                "consent": x.consent,
            }
            for x in contacts
        ],
        "addresses": [
            {
                "id": str(x.id),
                "label": x.label,
                "line_1": x.line_1,
                "line_2": x.line_2,
                "city": x.city,
                "region": x.region,
                "postal_code": x.postal_code,
                "country": x.country,
                "is_default": x.is_default,
            }
            for x in addresses
        ],
    }


async def _scoped_customer(
    customer_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> CustomerAccount:
    customer = await db.scalar(
        select(CustomerAccount).where(
            CustomerAccount.id == customer_id, CustomerAccount.workspace_id == workspace.id
        )
    )
    if customer is None:
        raise HTTPException(404, "Customer not found")
    return customer


@router.post("/customers/{customer_id}/legal-parties", status_code=status.HTTP_201_CREATED)
async def create_legal_party(
    customer_id: uuid.UUID,
    payload: LegalPartyCreateIn,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.customers_read,
        detail="Customer access is required",
    )
    await _scoped_customer(customer_id, workspace, db)
    row = LegalParty(
        workspace_id=workspace.id, customer_account_id=customer_id, **payload.model_dump()
    )
    db.add(row)
    await db.flush()
    record_event(
        db,
        action="commercial.legal_party_created",
        resource_type="legal_party",
        resource_id=str(row.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={"customer_id": str(customer_id)},
    )
    await db.commit()
    return {"id": str(row.id), **payload.model_dump(mode="json")}


@router.post("/customers/{customer_id}/contacts", status_code=status.HTTP_201_CREATED)
async def create_contact(
    customer_id: uuid.UUID,
    payload: ContactCreateIn,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.customers_read,
        detail="Customer access is required",
    )
    await _scoped_customer(customer_id, workspace, db)
    row = CustomerContact(
        workspace_id=workspace.id, customer_account_id=customer_id, **payload.model_dump()
    )
    db.add(row)
    await db.flush()
    record_event(
        db,
        action="commercial.contact_created",
        resource_type="customer_contact",
        resource_id=str(row.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={"customer_id": str(customer_id)},
    )
    await db.commit()
    return {"id": str(row.id), **payload.model_dump(mode="json")}


@router.post("/customers/{customer_id}/addresses", status_code=status.HTTP_201_CREATED)
async def create_address(
    customer_id: uuid.UUID,
    payload: AddressCreateIn,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.customers_read,
        detail="Customer access is required",
    )
    await _scoped_customer(customer_id, workspace, db)
    row = CustomerAddress(
        workspace_id=workspace.id, customer_account_id=customer_id, **payload.model_dump()
    )
    db.add(row)
    await db.flush()
    record_event(
        db,
        action="commercial.address_created",
        resource_type="customer_address",
        resource_id=str(row.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={"customer_id": str(customer_id)},
    )
    await db.commit()
    return {"id": str(row.id), **payload.model_dump(mode="json")}


@router.post("/pricing/versions", status_code=status.HTTP_201_CREATED)
async def create_price_version(
    payload: PriceVersionCreateIn,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.pricing_read,
        detail="Pricing access is required",
    )

    async def handler() -> dict[str, object]:
        product = await db.scalar(
            select(ProductMaster).where(
                ProductMaster.id == payload.product_id, ProductMaster.workspace_id == workspace.id
            )
        )
        if product is None:
            raise HTTPException(422, "Product must belong to selected workspace")
        proposed = cost_plus_margin(
            input_cost=payload.input_cost,
            fx_rate=payload.fx_rate,
            logistics_cost=payload.logistics_cost,
            tax_cost=payload.tax_cost,
            margin_percent=payload.margin_percent,
        )
        row = ProductPriceVersion(
            workspace_id=workspace.id,
            created_by_id=current_user.id,
            proposed_price=proposed,
            **payload.model_dump(),
        )
        db.add(row)
        await db.flush()
        return {
            "id": str(row.id),
            "product_id": str(row.product_id),
            "proposed_price": str(row.proposed_price),
            "status": row.status.value,
            "version": row.version,
        }

    result, _ = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name="commercial.price.create",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    return result


@router.get("/pricing")
async def list_price_versions(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.pricing_read,
        detail="Pricing access is required",
    )
    rows = (
        (
            await db.execute(
                select(ProductPriceVersion)
                .where(ProductPriceVersion.workspace_id == workspace.id)
                .order_by(ProductPriceVersion.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    product_ids = {row.product_id for row in rows}
    products = (
        (
            await db.execute(
                select(ProductMaster).where(
                    ProductMaster.workspace_id == workspace.id,
                    ProductMaster.id.in_(product_ids),
                )
            )
        )
        .scalars()
        .all()
        if product_ids
        else []
    )
    product_names = {row.id: row.name for row in products}
    return [
        {
            "id": str(row.id),
            "product_id": str(row.product_id),
            "product_name": product_names.get(row.product_id, "Unknown product"),
            "currency": row.currency,
            "input_cost": str(row.input_cost),
            "fx_rate": str(row.fx_rate),
            "logistics_cost": str(row.logistics_cost),
            "tax_cost": str(row.tax_cost),
            "margin_percent": str(row.margin_percent),
            "proposed_price": str(row.proposed_price),
            "approved_price": str(row.approved_price) if row.approved_price else None,
            "incoterm": row.incoterm,
            "effective_start": row.effective_start.isoformat(),
            "effective_end": row.effective_end.isoformat() if row.effective_end else None,
            "status": row.status.value,
            "approval_note": row.approval_note,
            "version": row.version,
        }
        for row in rows
    ]


@router.get("/pricing/fx")
async def list_fx_rates(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.pricing_read,
        detail="Pricing access is required",
    )
    rows = (
        (
            await db.execute(
                select(FxRateVersion)
                .where(FxRateVersion.workspace_id == workspace.id)
                .order_by(FxRateVersion.effective_start.desc())
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": str(row.id),
            "base_currency": row.base_currency,
            "quote_currency": row.quote_currency,
            "rate": str(row.rate),
            "effective_start": row.effective_start.isoformat(),
            "active": row.active,
            "version": row.version,
        }
        for row in rows
    ]


@router.post("/pricing/fx", status_code=status.HTTP_201_CREATED)
async def create_fx_rate(
    payload: FxRateCreateIn,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=current_user,
        capability=CommercialCapability.pricing_read,
        detail="Pricing access is required",
    )

    async def handler() -> dict[str, object]:
        row = FxRateVersion(
            workspace_id=workspace.id, created_by_id=current_user.id, **payload.model_dump()
        )
        db.add(row)
        await db.flush()
        record_event(
            db,
            action="commercial.fx_rate_created",
            resource_type="fx_rate_version",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=current_user.id,
            data={"rate": str(row.rate)},
        )
        return {
            "id": str(row.id),
            "base_currency": row.base_currency,
            "quote_currency": row.quote_currency,
            "rate": str(row.rate),
            "effective_start": row.effective_start.isoformat(),
            "active": row.active,
            "version": row.version,
        }

    result, _ = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=current_user.id,
        command_name="commercial.fx.create",
        idempotency_key=idempotency_key,
        request_payload=payload.model_dump(mode="json"),
        handler=handler,
    )
    return result


@router.post("/pricing/versions/{price_id}/reject")
async def reject_price_version(
    price_id: uuid.UUID,
    payload: PriceDecisionIn,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    return await _price_status_decision(
        price_id=price_id,
        expected_version=payload.expected_version,
        target=PriceStatus.rejected,
        note=payload.note,
        action="rejected",
        idempotency_key=idempotency_key,
        workspace=workspace,
        actor=current_user,
        db=db,
    )


@router.post("/pricing/versions/{price_id}/oral-decision")
async def oral_price_decision(
    price_id: uuid.UUID,
    payload: OralPriceDecisionIn,
    idempotency_key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    target = PriceStatus.approved if payload.decision == "confirm" else PriceStatus.rejected
    return await _price_status_decision(
        price_id=price_id,
        expected_version=payload.expected_version,
        target=target,
        note=payload.note,
        action=f"oral_{payload.decision}",
        idempotency_key=idempotency_key,
        workspace=workspace,
        actor=current_user,
        db=db,
    )


async def _price_status_decision(
    *,
    price_id: uuid.UUID,
    expected_version: int,
    target: PriceStatus,
    note: str,
    action: str,
    idempotency_key: str,
    workspace: Workspace,
    actor: User,
    db: AsyncSession,
) -> dict[str, object]:
    await require_workspace_action(
        db, workspace_id=workspace.id, user_id=actor.id, action=Action.manage
    )
    await _require_commercial_capability(
        db,
        workspace=workspace,
        current_user=actor,
        capability=CommercialCapability.pricing_read,
        detail="Pricing access is required",
    )

    async def handler() -> dict[str, object]:
        row = await db.scalar(
            select(ProductPriceVersion)
            .where(
                ProductPriceVersion.id == price_id, ProductPriceVersion.workspace_id == workspace.id
            )
            .with_for_update()
        )
        if row is None:
            raise HTTPException(404, "Price version not found")
        if row.version != expected_version:
            raise version_conflict(
                expected_version=expected_version,
                current_version=row.version,
                changed_fields=["status", "approval_note"],
            )
        row.status, row.approval_note, row.approved_by_id = target, note, actor.id
        row.approved_at, row.version = dt.datetime.now(dt.UTC), row.version + 1
        record_event(
            db,
            action=f"commercial.price_{action}",
            resource_type="product_price_version",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=actor.id,
            data={"status": row.status.value, "version": row.version},
        )
        return {
            "id": str(row.id),
            "status": row.status.value,
            "version": row.version,
            "approval_note": row.approval_note,
        }

    result, _ = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=actor.id,
        command_name=f"commercial.price.{action}:{price_id}",
        idempotency_key=idempotency_key,
        request_payload={"expected_version": expected_version, "note": note},
        handler=handler,
    )
    return result
