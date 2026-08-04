"""Typed T5/T6 Order Management transaction models."""

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class InquiryStatus(enum.StrEnum):
    draft = "draft"
    open = "open"
    sourcing = "sourcing"
    quoted = "quoted"
    closed = "closed"


class QuotationStatus(enum.StrEnum):
    draft = "draft"
    internally_approved = "internally_approved"
    sent = "sent"
    superseded = "superseded"
    accepted = "accepted"
    rejected = "rejected"


class SalesOrderStatus(enum.StrEnum):
    awaiting_commercial_release = "awaiting_commercial_release"
    released_to_procurement = "released_to_procurement"
    in_execution = "in_execution"
    completed = "completed"
    cancelled = "cancelled"


class PaymentReceiptStatus(enum.StrEnum):
    pending_confirmation = "pending_confirmation"
    confirmed = "confirmed"
    partially_allocated = "partially_allocated"
    fully_allocated = "fully_allocated"
    reversed = "reversed"
    rejected = "rejected"


class CommercialInquiry(Base, TimestampMixin):
    __tablename__ = "commercial_inquiries"
    __table_args__ = (UniqueConstraint("workspace_id", "number", name="uq_inquiry_number"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[str] = mapped_column(String(60))
    title: Mapped[str] = mapped_column(String(300))
    customer_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("customer_accounts.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    customer_entity_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("entities.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    customer_name: Mapped[str] = mapped_column(String(300))
    source: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    status: Mapped[InquiryStatus] = mapped_column(
        Enum(InquiryStatus, native_enum=False, length=24, create_constraint=False),
        default=InquiryStatus.draft,
        index=True,
    )
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    supplier_entity_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    product_requests: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class CommercialMasterReference(Base, TimestampMixin):
    """Restrictive link from a commercial document snapshot to a dynamic master record."""

    __tablename__ = "commercial_master_references"
    __table_args__ = (
        UniqueConstraint(
            "record_type",
            "record_id",
            "role",
            "line_index",
            "entity_id",
            name="uq_commercial_master_reference",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    record_type: Mapped[str] = mapped_column(String(40), index=True)
    record_id: Mapped[uuid.UUID] = mapped_column(index=True)
    role: Mapped[str] = mapped_column(String(24), index=True)
    line_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("entities.id", ondelete="RESTRICT"), index=True
    )
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)


class CommercialQuotation(Base, TimestampMixin):
    __tablename__ = "commercial_quotations"
    __table_args__ = (UniqueConstraint("workspace_id", "number", name="uq_quotation_number"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    inquiry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("commercial_inquiries.id", ondelete="RESTRICT"), index=True
    )
    number: Mapped[str] = mapped_column(String(60))
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class CommercialQuotationVersion(Base, TimestampMixin):
    __tablename__ = "commercial_quotation_versions"
    __table_args__ = (UniqueConstraint("quotation_id", "version_no", name="uq_quotation_version"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    quotation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("commercial_quotations.id", ondelete="RESTRICT"), index=True
    )
    version_no: Mapped[int] = mapped_column(Integer)
    status: Mapped[QuotationStatus] = mapped_column(
        Enum(QuotationStatus, native_enum=False, length=24, create_constraint=False),
        default=QuotationStatus.draft,
        index=True,
    )
    currency: Mapped[str] = mapped_column(String(3))
    issue_date: Mapped[date] = mapped_column(Date)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    legal_profile: Mapped[str] = mapped_column(String(50))
    customer_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    lines: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    total: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    terms: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    source_intake: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class CommercialEvidence(Base, TimestampMixin):
    __tablename__ = "commercial_evidence"
    __table_args__ = (
        UniqueConstraint("workspace_id", "source_key", name="uq_commercial_evidence_source"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    record_type: Mapped[str] = mapped_column(String(40), index=True)
    record_id: Mapped[uuid.UUID] = mapped_column(index=True)
    evidence_type: Mapped[str] = mapped_column(String(60), index=True)
    source_key: Mapped[str] = mapped_column(String(300))
    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sender: Mapped[str | None] = mapped_column(String(320), nullable=True)
    recipient: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("assets.id", ondelete="RESTRICT"), nullable=True
    )
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    captured_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class DocumentRequirementProfile(Base, TimestampMixin):
    __tablename__ = "document_requirement_profiles"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "legal_profile",
            "transaction_type",
            "version",
            name="uq_document_requirement_profile_version",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    legal_profile: Mapped[str] = mapped_column(String(50), index=True)
    transaction_type: Mapped[str] = mapped_column(String(80), index=True)
    required_evidence_types: Mapped[list[str]] = mapped_column(JSONB)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class PaymentTermsVersion(Base, TimestampMixin):
    __tablename__ = "payment_terms_versions"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", "version", name="uq_payment_terms_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    version: Mapped[int] = mapped_column(Integer, default=1)
    payment_method: Mapped[str] = mapped_column(String(80))
    currency: Mapped[str] = mapped_column(String(3))
    milestones: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    allow_partial: Mapped[bool] = mapped_column(Boolean, default=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class CommercialSalesOrder(Base, TimestampMixin):
    __tablename__ = "commercial_sales_orders"
    __table_args__ = (
        UniqueConstraint("workspace_id", "number", name="uq_sales_order_number"),
        UniqueConstraint("quotation_version_id", name="uq_sales_order_quotation_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[str] = mapped_column(String(60))
    quotation_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("commercial_quotation_versions.id", ondelete="RESTRICT"), index=True
    )
    requirement_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("document_requirement_profiles.id", ondelete="RESTRICT")
    )
    payment_terms_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payment_terms_versions.id", ondelete="RESTRICT")
    )
    status: Mapped[SalesOrderStatus] = mapped_column(
        Enum(SalesOrderStatus, native_enum=False, length=40, create_constraint=False),
        default=SalesOrderStatus.awaiting_commercial_release,
        index=True,
    )
    customer_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    lines: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    requirements_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    payment_terms_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    currency: Mapped[str] = mapped_column(String(3))
    total: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    released_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class PaymentReceipt(Base, TimestampMixin):
    __tablename__ = "payment_receipts"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "bank_reference", name="uq_payment_receipt_bank_reference"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    bank_reference: Mapped[str] = mapped_column(String(200))
    amount: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    currency: Mapped[str] = mapped_column(String(3))
    value_date: Mapped[date] = mapped_column(Date)
    receiving_account: Mapped[str] = mapped_column(String(200))
    status: Mapped[PaymentReceiptStatus] = mapped_column(
        Enum(PaymentReceiptStatus, native_enum=False, length=30, create_constraint=False),
        default=PaymentReceiptStatus.pending_confirmation,
        index=True,
    )
    evidence_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("commercial_evidence.id", ondelete="RESTRICT"), nullable=True
    )
    confirmed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))


class PaymentAllocation(Base, TimestampMixin):
    __tablename__ = "payment_allocations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    receipt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payment_receipts.id", ondelete="RESTRICT"), index=True
    )
    sales_order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("commercial_sales_orders.id", ondelete="RESTRICT"), index=True
    )
    milestone_id: Mapped[str] = mapped_column(String(100))
    amount: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    reversal_of_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("payment_allocations.id", ondelete="RESTRICT"), nullable=True, unique=True
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
