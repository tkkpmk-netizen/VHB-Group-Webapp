"""Workspace-scoped T5/T6 Order Management command and query API."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.problems import ProblemDetailsError
from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.asset import Asset
from app.models.commercial import (
    CommercialCatalogBinding,
    CommercialCatalogKind,
)
from app.models.field import Entity
from app.models.order_management import (
    CommercialEvidence,
    CommercialInquiry,
    CommercialMasterReference,
    CommercialQuotation,
    CommercialQuotationVersion,
    CommercialSalesOrder,
    DocumentRequirementProfile,
    InquiryStatus,
    PaymentAllocation,
    PaymentReceipt,
    PaymentReceiptStatus,
    PaymentTermsVersion,
    QuotationStatus,
    SalesOrderStatus,
)
from app.models.user import User
from app.models.workspace import Workspace
from app.modules.commercial.commands import execute_commercial_command, version_conflict
from app.modules.commercial.order_management.schemas import (
    AllocationCreate,
    AllocationReverse,
    EvidenceCreate,
    InquiryCreate,
    InquiryUpdate,
    PaymentTermsCreate,
    QuotationCreate,
    QuotationTransition,
    QuotationVersionCreate,
    ReceiptConfirm,
    ReceiptCreate,
    RequirementProfileCreate,
    SalesOrderCreate,
    SalesOrderRelease,
)
from app.services.authorization import Action, require_workspace_action
from app.services.events import record_event

router = APIRouter(prefix="/commercial/order-management", tags=["order-management"])
IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=200)]


def _problem(code: str, detail: str, status_code: int = 409) -> ProblemDetailsError:
    return ProblemDetailsError(
        status=status_code,
        code=code,
        title=code.replace("_", " ").title(),
        detail=detail,
        problem_type=f"https://vhb.local/problems/{code.lower().replace('_', '-')}",
    )


def _money(value: Decimal) -> str:
    return format(value, "f")


def _inquiry_out(row: CommercialInquiry) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "number": row.number,
        "title": row.title,
        "customer_name": row.customer_name,
        "customer_entity_id": str(row.customer_entity_id) if row.customer_entity_id else None,
        "supplier_entity_ids": row.supplier_entity_ids,
        "product_requests": row.product_requests,
        "source": row.source,
        "status": row.status.value,
        "requested_at": row.requested_at.isoformat(),
        "due_at": row.due_at.isoformat() if row.due_at else None,
        "notes": row.notes,
        "version": row.version,
    }


def _version_out(row: CommercialQuotationVersion) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "quotation_id": str(row.quotation_id),
        "version_no": row.version_no,
        "status": row.status.value,
        "currency": row.currency,
        "issue_date": row.issue_date.isoformat(),
        "valid_until": row.valid_until.isoformat() if row.valid_until else None,
        "legal_profile": row.legal_profile,
        "customer_snapshot": row.customer_snapshot,
        "lines": row.lines,
        "subtotal": _money(row.subtotal),
        "total": _money(row.total),
        "terms": row.terms,
        "source_intake": row.source_intake,
        "notes": row.notes,
        "created_at": row.created_at.isoformat(),
    }


def _order_out(row: CommercialSalesOrder) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "number": row.number,
        "quotation_version_id": str(row.quotation_version_id),
        "status": row.status.value,
        "customer_snapshot": row.customer_snapshot,
        "lines": row.lines,
        "requirements_snapshot": row.requirements_snapshot,
        "supplier_entity_ids": row.requirements_snapshot.get("supplier_entity_ids", []),
        "supplier_snapshots": row.requirements_snapshot.get("supplier_snapshots", []),
        "payment_terms_snapshot": row.payment_terms_snapshot,
        "currency": row.currency,
        "total": _money(row.total),
        "version": row.version,
        "released_at": row.released_at.isoformat() if row.released_at else None,
        "created_at": row.created_at.isoformat(),
    }


def _receipt_out(row: PaymentReceipt, allocated: Decimal = Decimal("0")) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "bank_reference": row.bank_reference,
        "amount": _money(row.amount),
        "allocated_amount": _money(allocated),
        "unallocated_amount": _money(row.amount - allocated),
        "currency": row.currency,
        "value_date": row.value_date.isoformat(),
        "receiving_account": row.receiving_account,
        "status": row.status.value,
        "version": row.version,
        "confirmed_at": row.confirmed_at.isoformat() if row.confirmed_at else None,
    }


def _line_payload(lines: list[Any]) -> tuple[list[dict[str, Any]], Decimal]:
    payload: list[dict[str, Any]] = []
    total = Decimal("0")
    for item in lines:
        line = item.model_dump(mode="json")
        quantity = Decimal(str(line["quantity"]))
        unit_price = Decimal(str(line["unit_price"]))
        line["line_total"] = _money(quantity * unit_price)
        total += quantity * unit_price
        payload.append(line)
    return payload, total


def _master_snapshot(entity: Entity) -> dict[str, Any]:
    return {
        "entity_id": str(entity.id),
        "uid": entity.uid,
        "name": entity.name,
        "data": entity.data,
    }


async def _resolve_masters(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    kind: CommercialCatalogKind,
    entity_ids: list[uuid.UUID],
) -> list[Entity]:
    if not entity_ids:
        return []
    binding = await db.scalar(
        select(CommercialCatalogBinding).where(
            CommercialCatalogBinding.workspace_id == workspace_id,
            CommercialCatalogBinding.kind == kind,
        )
    )
    if binding is None:
        raise _problem(
            "MASTER_CATALOG_NOT_READY",
            f"The {kind.value} database has not been provisioned.",
            409,
        )
    unique_ids = list(dict.fromkeys(entity_ids))
    rows = (
        await db.scalars(
            select(Entity).where(
                Entity.database_id == binding.database_id,
                Entity.id.in_(unique_ids),
            )
        )
    ).all()
    by_id = {row.id: row for row in rows}
    missing = [str(entity_id) for entity_id in unique_ids if entity_id not in by_id]
    if missing:
        raise _problem(
            "MASTER_RECORD_INVALID",
            f"One or more selected {kind.value} records are missing or belong to another catalog.",
            422,
        )
    return [by_id[entity_id] for entity_id in entity_ids]


def _add_master_references(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    record_type: str,
    record_id: uuid.UUID,
    role: str,
    entities: list[Entity],
) -> None:
    db.add_all(
        CommercialMasterReference(
            workspace_id=workspace_id,
            record_type=record_type,
            record_id=record_id,
            role=role,
            line_index=index,
            entity_id=entity.id,
            snapshot=_master_snapshot(entity),
        )
        for index, entity in enumerate(entities)
    )


async def _quotation_lines(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    lines: list[Any],
) -> tuple[list[dict[str, Any]], Decimal, list[Entity], list[Entity]]:
    product_ids = [item.product_entity_id for item in lines]
    supplier_ids = [item.supplier_entity_id for item in lines if item.supplier_entity_id]
    products = await _resolve_masters(
        db, workspace_id=workspace_id, kind=CommercialCatalogKind.products, entity_ids=product_ids
    )
    suppliers = await _resolve_masters(
        db,
        workspace_id=workspace_id,
        kind=CommercialCatalogKind.suppliers,
        entity_ids=supplier_ids,
    )
    supplier_by_id = {row.id: row for row in suppliers}
    normalized: list[dict[str, Any]] = []
    total = Decimal("0")
    for item, product in zip(lines, products, strict=True):
        quantity = item.quantity
        line_total = quantity * item.unit_price
        supplier = supplier_by_id.get(item.supplier_entity_id)
        normalized.append(
            {
                **item.model_dump(
                    mode="json", exclude={"product_entity_id", "supplier_entity_id"}
                ),
                "product_entity_id": str(product.id),
                "sku": product.uid,
                "product_name": product.name,
                "product_snapshot": _master_snapshot(product),
                "supplier_entity_id": str(supplier.id) if supplier else None,
                "supplier_snapshot": _master_snapshot(supplier) if supplier else None,
                "line_total": _money(line_total),
            }
        )
        total += line_total
    return normalized, total, products, suppliers


async def _run(
    db: AsyncSession,
    workspace: Workspace,
    user: User,
    key: str,
    name: str,
    payload: dict[str, Any],
    handler: Any,
) -> dict[str, Any]:
    result, replayed = await execute_commercial_command(
        db,
        workspace_id=workspace.id,
        actor_id=user.id,
        command_name=name,
        idempotency_key=key,
        request_payload=payload,
        handler=handler,
    )
    return {**result, "idempotency_replayed": replayed}


@router.get("/summary")
async def summary(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    async def count(model: Any, predicate: Any | None = None) -> int:
        query = select(func.count()).select_from(model).where(model.workspace_id == workspace.id)
        if predicate is not None:
            query = query.where(predicate)
        return int(await db.scalar(query) or 0)

    return {
        "open_inquiries": await count(
            CommercialInquiry, CommercialInquiry.status != InquiryStatus.closed
        ),
        "active_quotations": await count(
            CommercialQuotationVersion,
            CommercialQuotationVersion.status.in_(
                [QuotationStatus.draft, QuotationStatus.internally_approved, QuotationStatus.sent]
            ),
        ),
        "orders_awaiting_release": await count(
            CommercialSalesOrder,
            CommercialSalesOrder.status == SalesOrderStatus.awaiting_commercial_release,
        ),
        "unconfirmed_receipts": await count(
            PaymentReceipt, PaymentReceipt.status == PaymentReceiptStatus.pending_confirmation
        ),
    }


@router.get("/master-options/{kind}")
async def list_master_options(
    kind: CommercialCatalogKind,
    search: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=100, ge=1, le=20_000),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    binding = await db.scalar(
        select(CommercialCatalogBinding).where(
            CommercialCatalogBinding.workspace_id == workspace.id,
            CommercialCatalogBinding.kind == kind,
        )
    )
    if binding is None:
        return []
    query = select(Entity).where(Entity.database_id == binding.database_id)
    if search and search.strip():
        needle = f"%{search.strip()}%"
        query = query.where(Entity.name.ilike(needle))
    rows = (await db.scalars(query.order_by(Entity.name.asc()).limit(limit))).all()
    return [
        {"id": str(row.id), "uid": row.uid, "name": row.name, "kind": kind.value}
        for row in rows
    ]


@router.get("/inquiries")
async def list_inquiries(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = (
        await db.scalars(
            select(CommercialInquiry)
            .where(CommercialInquiry.workspace_id == workspace.id)
            .order_by(CommercialInquiry.updated_at.desc())
        )
    ).all()
    return [_inquiry_out(row) for row in rows]


@router.post("/inquiries", status_code=status.HTTP_201_CREATED)
async def create_inquiry(
    payload: InquiryCreate,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    async def handler() -> dict[str, Any]:
        customer = (
            await _resolve_masters(
                db,
                workspace_id=workspace.id,
                kind=CommercialCatalogKind.customers,
                entity_ids=[payload.customer_entity_id],
            )
        )[0]
        suppliers = await _resolve_masters(
            db,
            workspace_id=workspace.id,
            kind=CommercialCatalogKind.suppliers,
            entity_ids=payload.supplier_entity_ids,
        )
        catalog_requests = [
            item for item in payload.product_requests if item.mode == "catalog"
        ]
        products = await _resolve_masters(
            db,
            workspace_id=workspace.id,
            kind=CommercialCatalogKind.products,
            entity_ids=[
                item.product_entity_id
                for item in catalog_requests
                if item.product_entity_id
            ],
        )
        product_by_id = {row.id: row for row in products}
        product_requests: list[dict[str, Any]] = []
        for item in payload.product_requests:
            values = item.model_dump(mode="json")
            product = (
                product_by_id.get(item.product_entity_id)
                if item.product_entity_id is not None
                else None
            )
            if product:
                values.update(
                    {
                        "product_entity_id": str(product.id),
                        "product_name": product.name,
                        "sku": product.uid,
                        "product_snapshot": _master_snapshot(product),
                    }
                )
            product_requests.append(values)
        row = CommercialInquiry(
            workspace_id=workspace.id,
            owner_id=user.id,
            created_by_id=user.id,
            number=payload.number,
            title=payload.title,
            customer_entity_id=customer.id,
            customer_name=customer.name,
            supplier_entity_ids=[str(row.id) for row in suppliers],
            product_requests=product_requests,
            source=payload.source,
            requested_at=payload.requested_at,
            due_at=payload.due_at,
            notes=payload.notes,
        )
        db.add(row)
        await db.flush()
        _add_master_references(
            db,
            workspace_id=workspace.id,
            record_type="inquiry",
            record_id=row.id,
            role="customer",
            entities=[customer],
        )
        _add_master_references(
            db,
            workspace_id=workspace.id,
            record_type="inquiry",
            record_id=row.id,
            role="product",
            entities=products,
        )
        _add_master_references(
            db,
            workspace_id=workspace.id,
            record_type="inquiry",
            record_id=row.id,
            role="supplier",
            entities=suppliers,
        )
        record_event(
            db,
            action="commercial.inquiry_created",
            resource_type="commercial_inquiry",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={"number": row.number},
        )
        return _inquiry_out(row)

    return await _run(
        db, workspace, user, key, "inquiry.create", payload.model_dump(mode="json"), handler
    )


@router.patch("/inquiries/{inquiry_id}")
async def update_inquiry(
    inquiry_id: uuid.UUID,
    payload: InquiryUpdate,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    async def handler() -> dict[str, Any]:
        row = await db.scalar(
            select(CommercialInquiry)
            .where(
                CommercialInquiry.id == inquiry_id, CommercialInquiry.workspace_id == workspace.id
            )
            .with_for_update()
        )
        if row is None:
            raise HTTPException(404, "Inquiry not found")
        if row.version != payload.expected_version:
            raise version_conflict(
                expected_version=payload.expected_version,
                current_version=row.version,
                changed_fields=["inquiry"],
            )
        for field, value in payload.model_dump(
            exclude={"expected_version"}, exclude_unset=True
        ).items():
            setattr(row, field, value)
        row.version += 1
        record_event(
            db,
            action="commercial.inquiry_updated",
            resource_type="commercial_inquiry",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={"status": row.status.value},
        )
        await db.flush()
        return _inquiry_out(row)

    return await _run(
        db,
        workspace,
        user,
        key,
        "inquiry.update",
        {"id": str(inquiry_id), **payload.model_dump(mode="json")},
        handler,
    )


@router.get("/quotations")
async def list_quotations(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    quotations = (
        await db.scalars(
            select(CommercialQuotation)
            .where(CommercialQuotation.workspace_id == workspace.id)
            .order_by(CommercialQuotation.updated_at.desc())
        )
    ).all()
    result = []
    for quotation in quotations:
        latest = await db.scalar(
            select(CommercialQuotationVersion)
            .where(CommercialQuotationVersion.quotation_id == quotation.id)
            .order_by(CommercialQuotationVersion.version_no.desc())
            .limit(1)
        )
        if latest:
            result.append(
                {
                    "id": str(quotation.id),
                    "number": quotation.number,
                    "inquiry_id": str(quotation.inquiry_id),
                    "latest": _version_out(latest),
                }
            )
    return result


@router.post("/quotations", status_code=status.HTTP_201_CREATED)
async def create_quotation(
    payload: QuotationCreate,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    async def handler() -> dict[str, Any]:
        inquiry = await db.scalar(
            select(CommercialInquiry)
            .where(
                CommercialInquiry.id == payload.inquiry_id,
                CommercialInquiry.workspace_id == workspace.id,
            )
            .with_for_update()
        )
        if inquiry is None:
            raise HTTPException(404, "Inquiry not found")
        if inquiry.customer_entity_id is None:
            raise _problem(
                "INQUIRY_MASTER_CUSTOMER_REQUIRED",
                "This legacy Inquiry must be linked to a Customers record before quotation.",
                409,
            )
        customer = (
            await _resolve_masters(
                db,
                workspace_id=workspace.id,
                kind=CommercialCatalogKind.customers,
                entity_ids=[inquiry.customer_entity_id],
            )
        )[0]
        lines, total, products, suppliers = await _quotation_lines(
            db, workspace_id=workspace.id, lines=payload.lines
        )
        quotation = CommercialQuotation(
            workspace_id=workspace.id,
            inquiry_id=inquiry.id,
            number=payload.number,
            owner_id=user.id,
            created_by_id=user.id,
        )
        db.add(quotation)
        await db.flush()
        version = CommercialQuotationVersion(
            workspace_id=workspace.id,
            quotation_id=quotation.id,
            version_no=1,
            status=QuotationStatus.draft,
            currency=payload.currency,
            issue_date=payload.issue_date,
            valid_until=payload.valid_until,
            legal_profile=payload.legal_profile,
            customer_snapshot=_master_snapshot(customer),
            lines=lines,
            subtotal=total,
            total=total,
            terms=payload.terms,
            source_intake=payload.source_intake,
            notes=payload.notes,
            created_by_id=user.id,
        )
        db.add(version)
        inquiry.status = InquiryStatus.quoted
        inquiry.version += 1
        await db.flush()
        for role, entities in (
            ("customer", [customer]),
            ("product", products),
            ("supplier", suppliers),
        ):
            _add_master_references(
                db,
                workspace_id=workspace.id,
                record_type="quotation_version",
                record_id=version.id,
                role=role,
                entities=entities,
            )
        record_event(
            db,
            action="commercial.quotation_created",
            resource_type="commercial_quotation",
            resource_id=str(quotation.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={"version_id": str(version.id), "line_count": len(lines)},
        )
        return {
            "id": str(quotation.id),
            "number": quotation.number,
            "latest": _version_out(version),
        }

    return await _run(
        db, workspace, user, key, "quotation.create", payload.model_dump(mode="json"), handler
    )


@router.post("/quotations/{quotation_id}/versions", status_code=status.HTTP_201_CREATED)
async def create_quotation_version(
    quotation_id: uuid.UUID,
    payload: QuotationVersionCreate,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    async def handler() -> dict[str, Any]:
        quotation = await db.scalar(
            select(CommercialQuotation)
            .where(
                CommercialQuotation.id == quotation_id,
                CommercialQuotation.workspace_id == workspace.id,
            )
            .with_for_update()
        )
        if quotation is None:
            raise HTTPException(404, "Quotation not found")
        latest = await db.scalar(
            select(CommercialQuotationVersion)
            .where(CommercialQuotationVersion.quotation_id == quotation.id)
            .order_by(CommercialQuotationVersion.version_no.desc())
            .limit(1)
            .with_for_update()
        )
        if latest is None:
            raise HTTPException(409, "Quotation has no version")
        if latest.status == QuotationStatus.accepted:
            raise _problem(
                "QUOTATION_ALREADY_ACCEPTED",
                "An accepted quotation cannot be superseded; create an order amendment later.",
            )
        if latest.status != QuotationStatus.draft:
            latest.status = QuotationStatus.superseded
        inquiry = await db.scalar(
            select(CommercialInquiry).where(
                CommercialInquiry.id == quotation.inquiry_id,
                CommercialInquiry.workspace_id == workspace.id,
            )
        )
        if inquiry is None or inquiry.customer_entity_id is None:
            raise _problem(
                "INQUIRY_MASTER_CUSTOMER_REQUIRED",
                "The source Inquiry must be linked to a Customers record.",
                409,
            )
        customer = (
            await _resolve_masters(
                db,
                workspace_id=workspace.id,
                kind=CommercialCatalogKind.customers,
                entity_ids=[inquiry.customer_entity_id],
            )
        )[0]
        lines, total, products, suppliers = await _quotation_lines(
            db, workspace_id=workspace.id, lines=payload.lines
        )
        version = CommercialQuotationVersion(
            workspace_id=workspace.id,
            quotation_id=quotation.id,
            version_no=latest.version_no + 1,
            status=QuotationStatus.draft,
            subtotal=total,
            total=total,
            created_by_id=user.id,
            lines=lines,
            customer_snapshot=_master_snapshot(customer),
            **payload.model_dump(exclude={"lines"}),
        )
        db.add(version)
        await db.flush()
        for role, entities in (
            ("customer", [customer]),
            ("product", products),
            ("supplier", suppliers),
        ):
            _add_master_references(
                db,
                workspace_id=workspace.id,
                record_type="quotation_version",
                record_id=version.id,
                role=role,
                entities=entities,
            )
        record_event(
            db,
            action="commercial.quotation_version_created",
            resource_type="commercial_quotation",
            resource_id=str(quotation.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={"version_no": version.version_no},
        )
        return _version_out(version)

    return await _run(
        db,
        workspace,
        user,
        key,
        "quotation.version.create",
        {"quotation_id": str(quotation_id), **payload.model_dump(mode="json")},
        handler,
    )


@router.post("/quotation-versions/{version_id}/transition")
async def transition_quotation(
    version_id: uuid.UUID,
    payload: QuotationTransition,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if payload.status == "internally_approved":
        await require_workspace_action(
            db,
            workspace_id=workspace.id,
            user_id=user.id,
            action=Action.manage,
        )
    allowed = {
        QuotationStatus.draft: {QuotationStatus.internally_approved},
        QuotationStatus.internally_approved: {QuotationStatus.sent},
        QuotationStatus.sent: {QuotationStatus.accepted, QuotationStatus.rejected},
    }

    async def handler() -> dict[str, Any]:
        row = await db.scalar(
            select(CommercialQuotationVersion)
            .where(
                CommercialQuotationVersion.id == version_id,
                CommercialQuotationVersion.workspace_id == workspace.id,
            )
            .with_for_update()
        )
        if row is None:
            raise HTTPException(404, "Quotation version not found")
        target = QuotationStatus(payload.status)
        if target not in allowed.get(row.status, set()):
            raise _problem(
                "STATE_TRANSITION_INVALID",
                f"Cannot move quotation from {row.status.value} to {target.value}.",
            )
        row.status = target
        now = datetime.now(UTC)
        if target == QuotationStatus.internally_approved:
            row.approved_by_id = user.id
            row.approved_at = now
        elif target == QuotationStatus.sent:
            row.sent_at = now
        elif target == QuotationStatus.accepted:
            row.accepted_at = now
        record_event(
            db,
            action=f"commercial.quotation_{target.value}",
            resource_type="commercial_quotation_version",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={"version_no": row.version_no},
        )
        await db.flush()
        return _version_out(row)

    return await _run(
        db,
        workspace,
        user,
        key,
        "quotation.transition",
        {"version_id": str(version_id), **payload.model_dump()},
        handler,
    )


@router.post("/evidence", status_code=status.HTTP_201_CREATED)
async def capture_evidence(
    payload: EvidenceCreate,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    async def handler() -> dict[str, Any]:
        if payload.record_type == "inquiry":
            target = await db.scalar(
                select(CommercialInquiry.id).where(
                    CommercialInquiry.id == payload.record_id,
                    CommercialInquiry.workspace_id == workspace.id,
                )
            )
        elif payload.record_type == "quotation_version":
            target = await db.scalar(
                select(CommercialQuotationVersion.id).where(
                    CommercialQuotationVersion.id == payload.record_id,
                    CommercialQuotationVersion.workspace_id == workspace.id,
                )
            )
        elif payload.record_type == "sales_order":
            target = await db.scalar(
                select(CommercialSalesOrder.id).where(
                    CommercialSalesOrder.id == payload.record_id,
                    CommercialSalesOrder.workspace_id == workspace.id,
                )
            )
        else:
            target = await db.scalar(
                select(PaymentReceipt.id).where(
                    PaymentReceipt.id == payload.record_id,
                    PaymentReceipt.workspace_id == workspace.id,
                )
            )
        if target is None:
            raise HTTPException(404, "Evidence target not found")
        if payload.asset_id is not None:
            asset = await db.scalar(
                select(Asset.id).where(
                    Asset.id == payload.asset_id,
                    Asset.workspace_id == workspace.id,
                )
            )
            if asset is None:
                raise HTTPException(404, "Evidence Asset not found")
        row = CommercialEvidence(
            workspace_id=workspace.id,
            captured_by_id=user.id,
            metadata_json=payload.metadata,
            **payload.model_dump(exclude={"metadata"}),
        )
        db.add(row)
        await db.flush()
        record_event(
            db,
            action="commercial.evidence_captured",
            resource_type=payload.record_type,
            resource_id=str(payload.record_id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={"evidence_id": str(row.id), "evidence_type": row.evidence_type},
        )
        return {
            "id": str(row.id),
            "evidence_type": row.evidence_type,
            "source_key": row.source_key,
            "occurred_at": row.occurred_at.isoformat(),
        }

    return await _run(
        db, workspace, user, key, "evidence.capture", payload.model_dump(mode="json"), handler
    )


@router.get("/requirement-profiles")
async def list_requirement_profiles(
    workspace: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    rows = (
        await db.scalars(
            select(DocumentRequirementProfile)
            .where(
                DocumentRequirementProfile.workspace_id == workspace.id,
                DocumentRequirementProfile.active.is_(True),
            )
            .order_by(DocumentRequirementProfile.name)
        )
    ).all()
    return [
        {
            "id": str(row.id),
            "name": row.name,
            "legal_profile": row.legal_profile,
            "transaction_type": row.transaction_type,
            "required_evidence_types": row.required_evidence_types,
            "version": row.version,
        }
        for row in rows
    ]


@router.post("/requirement-profiles", status_code=status.HTTP_201_CREATED)
async def create_requirement_profile(
    payload: RequirementProfileCreate,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await require_workspace_action(
        db,
        workspace_id=workspace.id,
        user_id=user.id,
        action=Action.manage,
    )

    async def handler() -> dict[str, Any]:
        latest = (
            await db.scalar(
                select(func.max(DocumentRequirementProfile.version)).where(
                    DocumentRequirementProfile.workspace_id == workspace.id,
                    DocumentRequirementProfile.legal_profile == payload.legal_profile,
                    DocumentRequirementProfile.transaction_type == payload.transaction_type,
                )
            )
            or 0
        )
        row = DocumentRequirementProfile(
            workspace_id=workspace.id,
            version=int(latest) + 1,
            created_by_id=user.id,
            **payload.model_dump(),
        )
        db.add(row)
        await db.flush()
        record_event(
            db,
            action="commercial.document_requirement_profile_created",
            resource_type="document_requirement_profile",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={"version": row.version},
        )
        return {
            "id": str(row.id),
            "name": row.name,
            "legal_profile": row.legal_profile,
            "required_evidence_types": row.required_evidence_types,
            "version": row.version,
        }

    return await _run(
        db,
        workspace,
        user,
        key,
        "document_requirement_profile.create",
        payload.model_dump(),
        handler,
    )


@router.get("/payment-terms")
async def list_payment_terms(
    workspace: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    rows = (
        await db.scalars(
            select(PaymentTermsVersion)
            .where(
                PaymentTermsVersion.workspace_id == workspace.id,
                PaymentTermsVersion.active.is_(True),
            )
            .order_by(PaymentTermsVersion.name)
        )
    ).all()
    return [
        {
            "id": str(row.id),
            "name": row.name,
            "version": row.version,
            "payment_method": row.payment_method,
            "currency": row.currency,
            "milestones": row.milestones,
            "allow_partial": row.allow_partial,
        }
        for row in rows
    ]


@router.post("/payment-terms", status_code=status.HTTP_201_CREATED)
async def create_payment_terms(
    payload: PaymentTermsCreate,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await require_workspace_action(
        db,
        workspace_id=workspace.id,
        user_id=user.id,
        action=Action.manage,
    )

    async def handler() -> dict[str, Any]:
        latest = (
            await db.scalar(
                select(func.max(PaymentTermsVersion.version)).where(
                    PaymentTermsVersion.workspace_id == workspace.id,
                    PaymentTermsVersion.name == payload.name,
                )
            )
            or 0
        )
        row = PaymentTermsVersion(
            workspace_id=workspace.id,
            version=int(latest) + 1,
            approved_by_id=user.id,
            approved_at=datetime.now(UTC),
            created_by_id=user.id,
            milestones=[item.model_dump(mode="json") for item in payload.milestones],
            **payload.model_dump(exclude={"milestones"}),
        )
        db.add(row)
        await db.flush()
        record_event(
            db,
            action="commercial.payment_terms_created",
            resource_type="payment_terms",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={"version": row.version},
        )
        return {
            "id": str(row.id),
            "name": row.name,
            "version": row.version,
            "currency": row.currency,
            "milestones": row.milestones,
        }

    return await _run(
        db, workspace, user, key, "payment_terms.create", payload.model_dump(mode="json"), handler
    )


@router.get("/orders")
async def list_orders(
    workspace: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    rows = (
        await db.scalars(
            select(CommercialSalesOrder)
            .where(CommercialSalesOrder.workspace_id == workspace.id)
            .order_by(CommercialSalesOrder.updated_at.desc())
        )
    ).all()
    return [_order_out(row) for row in rows]


@router.post("/orders", status_code=status.HTTP_201_CREATED)
async def create_order(
    payload: SalesOrderCreate,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    async def handler() -> dict[str, Any]:
        quote = await db.scalar(
            select(CommercialQuotationVersion).where(
                CommercialQuotationVersion.id == payload.quotation_version_id,
                CommercialQuotationVersion.workspace_id == workspace.id,
            )
        )
        profile = await db.scalar(
            select(DocumentRequirementProfile).where(
                DocumentRequirementProfile.id == payload.requirement_profile_id,
                DocumentRequirementProfile.workspace_id == workspace.id,
                DocumentRequirementProfile.active.is_(True),
            )
        )
        terms = await db.scalar(
            select(PaymentTermsVersion).where(
                PaymentTermsVersion.id == payload.payment_terms_id,
                PaymentTermsVersion.workspace_id == workspace.id,
                PaymentTermsVersion.active.is_(True),
            )
        )
        if quote is None or profile is None or terms is None:
            raise HTTPException(404, "Quotation, requirement profile, or payment terms not found")
        if quote.status != QuotationStatus.accepted:
            raise _problem(
                "QUOTATION_NOT_ACCEPTED",
                "Only an accepted quotation version can create a Sales Order.",
            )
        if quote.legal_profile != profile.legal_profile:
            raise _problem(
                "LEGAL_PROFILE_MISMATCH",
                "The requirement profile does not match the quotation legal profile.",
            )
        evidence = set(
            (
                await db.scalars(
                    select(CommercialEvidence.evidence_type).where(
                        CommercialEvidence.workspace_id == workspace.id,
                        CommercialEvidence.record_type == "quotation_version",
                        CommercialEvidence.record_id == quote.id,
                    )
                )
            ).all()
        )
        missing = sorted(set(profile.required_evidence_types) - evidence)
        if missing:
            raise _problem(
                "DOCUMENT_REQUIREMENTS_MISSING",
                f"Required acceptance evidence is missing: {', '.join(missing)}",
            )
        if terms.currency != quote.currency:
            raise _problem(
                "PAYMENT_TERMS_CURRENCY_MISMATCH",
                "Payment Terms currency must match the accepted quotation.",
            )
        customer_id = quote.customer_snapshot.get("entity_id")
        product_ids = [line.get("product_entity_id") for line in quote.lines]
        if not customer_id or any(not entity_id for entity_id in product_ids):
            raise _problem(
                "QUOTATION_MASTER_DATA_REQUIRED",
                "The accepted quotation must reference Customers and Products master records.",
                409,
            )
        customer = (
            await _resolve_masters(
                db,
                workspace_id=workspace.id,
                kind=CommercialCatalogKind.customers,
                entity_ids=[uuid.UUID(str(customer_id))],
            )
        )[0]
        products = await _resolve_masters(
            db,
            workspace_id=workspace.id,
            kind=CommercialCatalogKind.products,
            entity_ids=[uuid.UUID(str(entity_id)) for entity_id in product_ids],
        )
        suppliers = await _resolve_masters(
            db,
            workspace_id=workspace.id,
            kind=CommercialCatalogKind.suppliers,
            entity_ids=payload.supplier_entity_ids,
        )
        row = CommercialSalesOrder(
            workspace_id=workspace.id,
            number=payload.number,
            quotation_version_id=quote.id,
            requirement_profile_id=profile.id,
            payment_terms_id=terms.id,
            customer_snapshot=quote.customer_snapshot,
            lines=quote.lines,
            requirements_snapshot={
                "profile_id": str(profile.id),
                "profile_version": profile.version,
                "required_evidence_types": profile.required_evidence_types,
                "supplier_entity_ids": [str(entity.id) for entity in suppliers],
                "supplier_snapshots": [_master_snapshot(entity) for entity in suppliers],
            },
            payment_terms_snapshot={
                "terms_id": str(terms.id),
                "terms_version": terms.version,
                "payment_method": terms.payment_method,
                "milestones": terms.milestones,
                "allow_partial": terms.allow_partial,
            },
            currency=quote.currency,
            total=quote.total,
            created_by_id=user.id,
        )
        db.add(row)
        await db.flush()
        for role, entities in (
            ("customer", [customer]),
            ("product", products),
            ("supplier", suppliers),
        ):
            _add_master_references(
                db,
                workspace_id=workspace.id,
                record_type="sales_order",
                record_id=row.id,
                role=role,
                entities=entities,
            )
        record_event(
            db,
            action="commercial.sales_order_created",
            resource_type="commercial_sales_order",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={"quotation_version_id": str(quote.id), "status": row.status.value},
        )
        return _order_out(row)

    return await _run(
        db, workspace, user, key, "sales_order.create", payload.model_dump(mode="json"), handler
    )


@router.post("/orders/{order_id}/release")
async def release_order(
    order_id: uuid.UUID,
    payload: SalesOrderRelease,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await require_workspace_action(
        db,
        workspace_id=workspace.id,
        user_id=user.id,
        action=Action.manage,
    )

    async def handler() -> dict[str, Any]:
        order = await db.scalar(
            select(CommercialSalesOrder)
            .where(
                CommercialSalesOrder.id == order_id,
                CommercialSalesOrder.workspace_id == workspace.id,
            )
            .with_for_update()
        )
        if order is None:
            raise HTTPException(404, "Sales Order not found")
        if order.version != payload.expected_version:
            raise version_conflict(
                expected_version=payload.expected_version,
                current_version=order.version,
                changed_fields=["status", "payments"],
            )
        if order.status != SalesOrderStatus.awaiting_commercial_release:
            raise _problem(
                "STATE_TRANSITION_INVALID",
                "Only an order awaiting commercial release can be released.",
            )
        allocations = Decimal(
            str(
                await db.scalar(
                    select(func.coalesce(func.sum(PaymentAllocation.amount), 0)).where(
                        PaymentAllocation.workspace_id == workspace.id,
                        PaymentAllocation.sales_order_id == order.id,
                    )
                )
                or 0
            )
        )
        gates = [
            item
            for item in order.payment_terms_snapshot.get("milestones", [])
            if item.get("release_gate")
        ]
        required = sum(
            (order.total * Decimal(str(item["percentage"])) / Decimal("100") for item in gates),
            Decimal("0"),
        )
        if allocations < required:
            detail = (
                f"Confirmed allocations {_money(allocations)} are below the release "
                f"requirement {_money(required)} {order.currency}."
            )
            raise _problem(
                "COMMERCIAL_RELEASE_PAYMENT_MISSING",
                detail,
            )
        order.status = SalesOrderStatus.released_to_procurement
        order.released_at = datetime.now(UTC)
        order.released_by_id = user.id
        order.version += 1
        record_event(
            db,
            action="commercial.sales_order_released",
            resource_type="commercial_sales_order",
            resource_id=str(order.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={"confirmed_allocations": _money(allocations), "required": _money(required)},
        )
        await db.flush()
        return _order_out(order)

    return await _run(
        db,
        workspace,
        user,
        key,
        "sales_order.release",
        {"order_id": str(order_id), **payload.model_dump()},
        handler,
    )


@router.get("/receipts")
async def list_receipts(
    workspace: Workspace = Depends(get_current_workspace), db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    rows = (
        await db.scalars(
            select(PaymentReceipt)
            .where(PaymentReceipt.workspace_id == workspace.id)
            .order_by(PaymentReceipt.value_date.desc())
        )
    ).all()
    result = []
    for row in rows:
        allocated = Decimal(
            str(
                await db.scalar(
                    select(func.coalesce(func.sum(PaymentAllocation.amount), 0)).where(
                        PaymentAllocation.receipt_id == row.id
                    )
                )
                or 0
            )
        )
        result.append(_receipt_out(row, allocated))
    return result


@router.post("/receipts", status_code=status.HTTP_201_CREATED)
async def create_receipt(
    payload: ReceiptCreate,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    async def handler() -> dict[str, Any]:
        row = PaymentReceipt(
            workspace_id=workspace.id, created_by_id=user.id, **payload.model_dump()
        )
        db.add(row)
        await db.flush()
        record_event(
            db,
            action="commercial.payment_receipt_created",
            resource_type="payment_receipt",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={"bank_reference": row.bank_reference},
        )
        return _receipt_out(row)

    return await _run(
        db, workspace, user, key, "payment_receipt.create", payload.model_dump(mode="json"), handler
    )


@router.post("/receipts/{receipt_id}/confirm")
async def confirm_receipt(
    receipt_id: uuid.UUID,
    payload: ReceiptConfirm,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    async def handler() -> dict[str, Any]:
        row = await db.scalar(
            select(PaymentReceipt)
            .where(PaymentReceipt.id == receipt_id, PaymentReceipt.workspace_id == workspace.id)
            .with_for_update()
        )
        if row is None:
            raise HTTPException(404, "Payment Receipt not found")
        if row.version != payload.expected_version:
            raise version_conflict(
                expected_version=payload.expected_version,
                current_version=row.version,
                changed_fields=["status"],
            )
        if row.status != PaymentReceiptStatus.pending_confirmation:
            raise _problem("STATE_TRANSITION_INVALID", "Only a pending receipt can be confirmed.")
        row.status = PaymentReceiptStatus.confirmed
        row.confirmed_by_id = user.id
        row.confirmed_at = datetime.now(UTC)
        row.version += 1
        record_event(
            db,
            action="commercial.payment_receipt_confirmed",
            resource_type="payment_receipt",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={"amount": _money(row.amount), "currency": row.currency},
        )
        await db.flush()
        return _receipt_out(row)

    return await _run(
        db,
        workspace,
        user,
        key,
        "payment_receipt.confirm",
        {"receipt_id": str(receipt_id), **payload.model_dump()},
        handler,
    )


@router.post("/allocations", status_code=status.HTTP_201_CREATED)
async def allocate_receipt(
    payload: AllocationCreate,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    async def handler() -> dict[str, Any]:
        receipt = await db.scalar(
            select(PaymentReceipt)
            .where(
                PaymentReceipt.id == payload.receipt_id, PaymentReceipt.workspace_id == workspace.id
            )
            .with_for_update()
        )
        order = await db.scalar(
            select(CommercialSalesOrder).where(
                CommercialSalesOrder.id == payload.sales_order_id,
                CommercialSalesOrder.workspace_id == workspace.id,
            )
        )
        if receipt is None or order is None:
            raise HTTPException(404, "Receipt or Sales Order not found")
        if receipt.status not in {
            PaymentReceiptStatus.confirmed,
            PaymentReceiptStatus.partially_allocated,
            PaymentReceiptStatus.fully_allocated,
        }:
            raise _problem("PAYMENT_NOT_CONFIRMED", "Only confirmed funds may be allocated.")
        if receipt.currency != order.currency:
            raise _problem(
                "PAYMENT_CURRENCY_MISMATCH", "Receipt and Sales Order currencies do not match."
            )
        milestone_ids = {item["id"] for item in order.payment_terms_snapshot.get("milestones", [])}
        if payload.milestone_id not in milestone_ids:
            raise _problem(
                "PAYMENT_MILESTONE_INVALID",
                "The milestone is not part of this Sales Order's snapshotted Payment Terms.",
            )
        allocated = Decimal(
            str(
                await db.scalar(
                    select(func.coalesce(func.sum(PaymentAllocation.amount), 0)).where(
                        PaymentAllocation.receipt_id == receipt.id
                    )
                )
                or 0
            )
        )
        if allocated + payload.amount > receipt.amount:
            raise _problem(
                "PAYMENT_OVER_ALLOCATION", "Allocation would exceed the confirmed receipt amount."
            )
        row = PaymentAllocation(
            workspace_id=workspace.id, created_by_id=user.id, **payload.model_dump()
        )
        db.add(row)
        new_allocated = allocated + payload.amount
        receipt.status = (
            PaymentReceiptStatus.fully_allocated
            if new_allocated == receipt.amount
            else PaymentReceiptStatus.partially_allocated
        )
        receipt.version += 1
        await db.flush()
        record_event(
            db,
            action="commercial.payment_allocated",
            resource_type="payment_allocation",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={
                "receipt_id": str(receipt.id),
                "sales_order_id": str(order.id),
                "amount": _money(row.amount),
            },
        )
        return {
            "id": str(row.id),
            "receipt_id": str(receipt.id),
            "sales_order_id": str(order.id),
            "milestone_id": row.milestone_id,
            "amount": _money(row.amount),
            "receipt": _receipt_out(receipt, new_allocated),
        }

    return await _run(
        db, workspace, user, key, "payment.allocate", payload.model_dump(mode="json"), handler
    )


@router.get("/allocations")
async def list_allocations(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = (
        await db.scalars(
            select(PaymentAllocation)
            .where(PaymentAllocation.workspace_id == workspace.id)
            .order_by(PaymentAllocation.created_at.desc())
        )
    ).all()
    reversed_ids = {row.reversal_of_id for row in rows if row.reversal_of_id is not None}
    return [
        {
            "id": str(row.id),
            "receipt_id": str(row.receipt_id),
            "sales_order_id": str(row.sales_order_id),
            "milestone_id": row.milestone_id,
            "amount": _money(row.amount),
            "reversal_of_id": str(row.reversal_of_id) if row.reversal_of_id else None,
            "reversed": row.id in reversed_ids,
            "reason": row.reason,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


@router.post("/allocations/{allocation_id}/reverse", status_code=status.HTTP_201_CREATED)
async def reverse_allocation(
    allocation_id: uuid.UUID,
    payload: AllocationReverse,
    key: IdempotencyKey,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    async def handler() -> dict[str, Any]:
        original = await db.scalar(
            select(PaymentAllocation)
            .where(
                PaymentAllocation.id == allocation_id,
                PaymentAllocation.workspace_id == workspace.id,
            )
            .with_for_update()
        )
        if original is None:
            raise HTTPException(404, "Payment allocation not found")
        if original.reversal_of_id is not None or original.amount <= 0:
            raise _problem("PAYMENT_REVERSAL_INVALID", "A reversal cannot itself be reversed.")
        existing = await db.scalar(
            select(PaymentAllocation).where(PaymentAllocation.reversal_of_id == original.id)
        )
        if existing is not None:
            raise _problem("PAYMENT_ALREADY_REVERSED", "This allocation was already reversed.")
        receipt = await db.scalar(
            select(PaymentReceipt).where(PaymentReceipt.id == original.receipt_id).with_for_update()
        )
        if receipt is None:
            raise HTTPException(404, "Payment Receipt not found")
        row = PaymentAllocation(
            workspace_id=workspace.id,
            receipt_id=original.receipt_id,
            sales_order_id=original.sales_order_id,
            milestone_id=original.milestone_id,
            amount=-original.amount,
            reversal_of_id=original.id,
            reason=payload.reason,
            created_by_id=user.id,
        )
        db.add(row)
        net = (
            Decimal(
                str(
                    await db.scalar(
                        select(func.coalesce(func.sum(PaymentAllocation.amount), 0)).where(
                            PaymentAllocation.receipt_id == receipt.id
                        )
                    )
                    or 0
                )
            )
            - original.amount
        )
        receipt.status = (
            PaymentReceiptStatus.confirmed if net == 0 else PaymentReceiptStatus.partially_allocated
        )
        receipt.version += 1
        await db.flush()
        record_event(
            db,
            action="commercial.payment_allocation_reversed",
            resource_type="payment_allocation",
            resource_id=str(row.id),
            workspace_id=workspace.id,
            actor_id=user.id,
            data={
                "reversal_of_id": str(original.id),
                "amount": _money(original.amount),
                "reason": payload.reason,
            },
        )
        return {
            "id": str(row.id),
            "reversal_of_id": str(original.id),
            "amount": _money(row.amount),
            "receipt": _receipt_out(receipt, net),
        }

    return await _run(
        db,
        workspace,
        user,
        key,
        "payment.reverse_allocation",
        {"allocation_id": str(allocation_id), **payload.model_dump()},
        handler,
    )


@router.get("/evidence")
async def list_evidence(
    record_type: str,
    record_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict[str, Any]]:
    rows = (
        await db.scalars(
            select(CommercialEvidence)
            .where(
                CommercialEvidence.workspace_id == workspace.id,
                CommercialEvidence.record_type == record_type,
                CommercialEvidence.record_id == record_id,
            )
            .order_by(CommercialEvidence.occurred_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": str(row.id),
            "evidence_type": row.evidence_type,
            "source_key": row.source_key,
            "subject": row.subject,
            "sender": row.sender,
            "recipient": row.recipient,
            "occurred_at": row.occurred_at.isoformat(),
            "metadata": row.metadata_json,
        }
        for row in rows
    ]
