"""Commercial Foundation policy and command models."""

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class CommercialSubjectType(enum.StrEnum):
    role = "role"
    user = "user"


class CommercialWorkspacePolicy(Base, TimestampMixin):
    """One server-authoritative Commercial rollout generation per workspace."""

    __tablename__ = "commercial_workspace_policies"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    cohort: Mapped[str] = mapped_column(String(50), default="foundation")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_by_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )


class CommercialCapabilityAssignment(Base, TimestampMixin):
    """A role or user override for one named Commercial capability."""

    __tablename__ = "commercial_capability_assignments"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "capability",
            "subject_type",
            "subject_id",
            name="uq_commercial_capability_subject",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    capability: Mapped[str] = mapped_column(String(100), index=True)
    subject_type: Mapped[CommercialSubjectType] = mapped_column(
        Enum(
            CommercialSubjectType,
            native_enum=False,
            length=16,
            create_constraint=False,
        )
    )
    subject_id: Mapped[str] = mapped_column(String(200))
    allowed: Mapped[bool] = mapped_column(Boolean)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_by_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )


class CommercialCommandReceipt(Base):
    """Durable response for an atomically committed Commercial command."""

    __tablename__ = "commercial_command_receipts"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "actor_id",
            "command_name",
            "idempotency_key",
            name="uq_commercial_command_receipt",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    command_name: Mapped[str] = mapped_column(String(150), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(200))
    request_hash: Mapped[str] = mapped_column(String(64))
    response_status: Mapped[int] = mapped_column(Integer)
    response_payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class CommercialCatalogKind(enum.StrEnum):
    products = "products"
    customers = "customers"
    suppliers = "suppliers"


class CommercialCatalogBinding(Base, TimestampMixin):
    """Stable mini-app identity backed by the shared dynamic Database engine."""

    __tablename__ = "commercial_catalog_bindings"
    __table_args__ = (
        UniqueConstraint("workspace_id", "kind", name="uq_commercial_catalog_kind"),
        UniqueConstraint("database_id", name="uq_commercial_catalog_database"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[CommercialCatalogKind] = mapped_column(
        Enum(CommercialCatalogKind, native_enum=False, length=24, create_constraint=False),
        index=True,
    )
    database_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("databases.id", ondelete="RESTRICT"), unique=True, index=True
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )


class MigrationBatchStatus(enum.StrEnum):
    staged = "staged"
    reviewing = "reviewing"
    ready = "ready"
    partial = "partial"
    completed = "completed"


class MigrationTrustTier(enum.StrEnum):
    verified = "verified"
    partially_verified = "partially_verified"
    reference_only = "reference_only"
    rejected_duplicate = "rejected_duplicate"


class MigrationCandidateStatus(enum.StrEnum):
    pending = "pending"
    needs_review = "needs_review"
    verified = "verified"
    promoted = "promoted"
    rejected = "rejected"


class MigrationConflictStatus(enum.StrEnum):
    open = "open"
    resolved = "resolved"


class MigrationBatch(Base, TimestampMixin):
    """A workspace-scoped immutable intake of one historical source."""

    __tablename__ = "migration_batches"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "source_key", "source_checksum", name="uq_migration_batch_source"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("assets.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    source_key: Mapped[str] = mapped_column(String(200))
    source_label: Mapped[str] = mapped_column(String(255))
    source_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    source_checksum: Mapped[str] = mapped_column(String(64))
    mapping_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[MigrationBatchStatus] = mapped_column(
        Enum(MigrationBatchStatus, native_enum=False, length=20, create_constraint=False),
        default=MigrationBatchStatus.staged,
        index=True,
    )
    priority_cohort: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)


class MigrationSourceRow(Base, TimestampMixin):
    """Raw source values are append-only evidence and are never remapped in place."""

    __tablename__ = "migration_source_rows"
    __table_args__ = (
        UniqueConstraint("batch_id", "source_locator", name="uq_migration_source_row_locator"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("migration_batches.id", ondelete="CASCADE"), index=True
    )
    source_locator: Mapped[str] = mapped_column(String(500))
    source_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    raw_values: Mapped[dict[str, Any]] = mapped_column(JSONB)
    raw_checksum: Mapped[str] = mapped_column(String(64))


class MigrationCandidate(Base, TimestampMixin):
    __tablename__ = "migration_candidates"
    __table_args__ = (
        UniqueConstraint("source_row_id", "mapping_version", name="uq_migration_candidate_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("migration_batches.id", ondelete="CASCADE"), index=True
    )
    source_row_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("migration_source_rows.id", ondelete="CASCADE"), index=True
    )
    mapping_version: Mapped[int] = mapped_column(Integer)
    record_type: Mapped[str] = mapped_column(String(50), index=True)
    normalized_values: Mapped[dict[str, Any]] = mapped_column(JSONB)
    mapping_confidence: Mapped[int] = mapped_column(Integer)
    status: Mapped[MigrationCandidateStatus] = mapped_column(
        Enum(MigrationCandidateStatus, native_enum=False, length=20, create_constraint=False),
        default=MigrationCandidateStatus.pending,
        index=True,
    )
    trust_tier: Mapped[MigrationTrustTier] = mapped_column(
        Enum(MigrationTrustTier, native_enum=False, length=24, create_constraint=False),
        default=MigrationTrustTier.reference_only,
        index=True,
    )
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class MigrationConflict(Base, TimestampMixin):
    __tablename__ = "migration_conflicts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("migration_candidates.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(100), index=True)
    field_paths: Mapped[list[str]] = mapped_column(JSONB, default=list)
    detail: Mapped[str] = mapped_column(Text)
    status: Mapped[MigrationConflictStatus] = mapped_column(
        Enum(MigrationConflictStatus, native_enum=False, length=16, create_constraint=False),
        default=MigrationConflictStatus.open,
        index=True,
    )
    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MigrationPromotionReceipt(Base):
    """Durable evidence that a reviewed candidate passed the T3 verification gate."""

    __tablename__ = "migration_promotion_receipts"
    __table_args__ = (UniqueConstraint("candidate_id", name="uq_migration_promotion_candidate"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("migration_candidates.id", ondelete="RESTRICT"), index=True
    )
    reviewer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    trust_tier: Mapped[MigrationTrustTier] = mapped_column(
        Enum(MigrationTrustTier, native_enum=False, length=24, create_constraint=False)
    )
    resulting_record_type: Mapped[str] = mapped_column(String(50))
    resulting_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class MasterLifecycle(enum.StrEnum):
    active = "active"
    discontinued = "discontinued"
    merged = "merged"


class PriceStatus(enum.StrEnum):
    draft = "draft"
    approved = "approved"
    oral_pending = "oral_pending"
    rejected = "rejected"


class ProductMaster(Base, TimestampMixin):
    __tablename__ = "product_masters"
    __table_args__ = (UniqueConstraint("workspace_id", "sku", name="uq_product_master_sku"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    sku: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(300), index=True)
    base_unit: Mapped[str] = mapped_column(String(30))
    origin_country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(100), nullable=True)
    attributes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    lifecycle: Mapped[MasterLifecycle] = mapped_column(
        Enum(MasterLifecycle, native_enum=False, length=20, create_constraint=False),
        default=MasterLifecycle.active,
        index=True,
    )
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("product_masters.id", ondelete="RESTRICT"), nullable=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )


class SupplierMaster(Base, TimestampMixin):
    __tablename__ = "supplier_masters"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_supplier_master_name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(300), index=True)
    country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    supplier_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    lifecycle: Mapped[MasterLifecycle] = mapped_column(
        Enum(MasterLifecycle, native_enum=False, length=20, create_constraint=False),
        default=MasterLifecycle.active,
        index=True,
    )
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("supplier_masters.id", ondelete="RESTRICT"), nullable=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class CustomerAccount(Base, TimestampMixin):
    __tablename__ = "customer_accounts"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_customer_account_name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(300), index=True)
    sales_pic_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    lifecycle: Mapped[MasterLifecycle] = mapped_column(
        Enum(MasterLifecycle, native_enum=False, length=20, create_constraint=False),
        default=MasterLifecycle.active,
        index=True,
    )
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("customer_accounts.id", ondelete="RESTRICT"), nullable=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class LegalParty(Base, TimestampMixin):
    __tablename__ = "legal_parties"
    __table_args__ = (
        UniqueConstraint("workspace_id", "tax_identifier", name="uq_legal_party_tax_identifier"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    customer_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customer_accounts.id", ondelete="RESTRICT"), index=True
    )
    legal_name: Mapped[str] = mapped_column(String(300))
    tax_identifier: Mapped[str | None] = mapped_column(String(100), nullable=True)
    country: Mapped[str] = mapped_column(String(2))
    evidence: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)


class CustomerContact(Base, TimestampMixin):
    __tablename__ = "customer_contacts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    customer_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customer_accounts.id", ondelete="CASCADE"), index=True
    )
    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    consent: Mapped[bool] = mapped_column(Boolean, default=False)


class CustomerAddress(Base, TimestampMixin):
    __tablename__ = "customer_addresses"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    customer_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("customer_accounts.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(100), default="Primary")
    line_1: Mapped[str] = mapped_column(String(300))
    line_2: Mapped[str | None] = mapped_column(String(300), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    region: Mapped[str | None] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    country: Mapped[str] = mapped_column(String(2))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class FxRateVersion(Base, TimestampMixin):
    __tablename__ = "fx_rate_versions"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "base_currency",
            "quote_currency",
            "effective_start",
            name="uq_fx_rate_effective_start",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    base_currency: Mapped[str] = mapped_column(String(3))
    quote_currency: Mapped[str] = mapped_column(String(3))
    rate: Mapped[Decimal] = mapped_column(Numeric(20, 8))
    effective_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    effective_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class ProductPriceVersion(Base, TimestampMixin):
    __tablename__ = "product_price_versions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("product_masters.id", ondelete="RESTRICT"), index=True
    )
    currency: Mapped[str] = mapped_column(String(3))
    input_cost: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("1"))
    logistics_cost: Mapped[Decimal] = mapped_column(Numeric(20, 4), default=Decimal("0"))
    tax_cost: Mapped[Decimal] = mapped_column(Numeric(20, 4), default=Decimal("0"))
    margin_percent: Mapped[Decimal] = mapped_column(Numeric(9, 4))
    proposed_price: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    approved_price: Mapped[Decimal | None] = mapped_column(Numeric(20, 4), nullable=True)
    method: Mapped[str] = mapped_column(String(50), default="cost_plus_margin")
    incoterm: Mapped[str | None] = mapped_column(String(20), nullable=True)
    effective_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    effective_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[PriceStatus] = mapped_column(
        Enum(PriceStatus, native_enum=False, length=20, create_constraint=False),
        default=PriceStatus.draft,
        index=True,
    )
    approval_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
