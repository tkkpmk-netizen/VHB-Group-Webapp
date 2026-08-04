"""API contracts for T5/T6 Order Management."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class InquiryProductRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["catalog", "manual"] = "catalog"
    product_entity_id: uuid.UUID | None = None
    manual_description: str | None = Field(default=None, max_length=500)
    quantity: Decimal = Field(gt=0)
    unit: str = Field(min_length=1, max_length=50)
    target_price: Decimal | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_source(self) -> "InquiryProductRequest":
        if self.mode == "catalog" and self.product_entity_id is None:
            raise ValueError("Catalog product requests require product_entity_id")
        if self.mode == "manual" and not (self.manual_description or "").strip():
            raise ValueError("Manual product requests require manual_description")
        if self.mode == "manual":
            self.product_entity_id = None
        return self


class InquiryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    number: str = Field(min_length=1, max_length=60)
    title: str = Field(min_length=1, max_length=300)
    customer_entity_id: uuid.UUID
    supplier_entity_ids: list[uuid.UUID] = Field(default_factory=list)
    product_requests: list[InquiryProductRequest] = Field(min_length=1, max_length=2000)
    source: str | None = Field(default=None, max_length=100)
    requested_at: datetime
    due_at: datetime | None = None
    notes: str | None = None


class InquiryUpdate(BaseModel):
    expected_version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=300)
    status: Literal["draft", "open", "sourcing", "quoted", "closed"] | None = None
    due_at: datetime | None = None
    notes: str | None = None


class QuotationLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_entity_id: uuid.UUID
    supplier_entity_id: uuid.UUID | None = None
    specification: str | None = None
    packing: str | None = None
    quantity: Decimal = Field(gt=0)
    unit: str = Field(min_length=1, max_length=50)
    unit_price: Decimal = Field(ge=0)
    price_version_id: uuid.UUID | None = None

class QuotationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    inquiry_id: uuid.UUID
    number: str = Field(min_length=1, max_length=60)
    currency: str = Field(min_length=3, max_length=3)
    issue_date: date
    valid_until: date | None = None
    legal_profile: Literal["VIHABA", "DP"]
    lines: list[QuotationLine] = Field(min_length=1, max_length=2000)
    terms: dict[str, Any] = Field(default_factory=dict)
    source_intake: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None

    @field_validator("currency")
    @classmethod
    def currency_upper(cls, value: str) -> str:
        return value.upper()


class QuotationVersionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    currency: str = Field(min_length=3, max_length=3)
    issue_date: date
    valid_until: date | None = None
    legal_profile: Literal["VIHABA", "DP"]
    lines: list[QuotationLine] = Field(min_length=1, max_length=2000)
    terms: dict[str, Any] = Field(default_factory=dict)
    source_intake: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None


class QuotationTransition(BaseModel):
    status: Literal["internally_approved", "sent", "accepted", "rejected"]


class EvidenceCreate(BaseModel):
    record_type: Literal["inquiry", "quotation_version", "sales_order", "payment_receipt"]
    record_id: uuid.UUID
    evidence_type: str = Field(min_length=1, max_length=60)
    source_key: str = Field(min_length=1, max_length=300)
    subject: str | None = Field(default=None, max_length=500)
    sender: str | None = Field(default=None, max_length=320)
    recipient: str | None = Field(default=None, max_length=1000)
    occurred_at: datetime
    asset_id: uuid.UUID | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RequirementProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    legal_profile: Literal["VIHABA", "DP"]
    transaction_type: str = Field(min_length=1, max_length=80)
    required_evidence_types: list[str] = Field(min_length=1)


class PaymentMilestone(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)
    percentage: Decimal = Field(gt=0, le=100)
    due_rule: str = Field(min_length=1, max_length=200)
    release_gate: bool = False


class PaymentTermsCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    payment_method: str = Field(min_length=1, max_length=80)
    currency: str = Field(min_length=3, max_length=3)
    milestones: list[PaymentMilestone] = Field(min_length=1)
    allow_partial: bool = True

    @field_validator("milestones")
    @classmethod
    def percentages_total(cls, value: list[PaymentMilestone]) -> list[PaymentMilestone]:
        if sum((item.percentage for item in value), Decimal("0")) != Decimal("100"):
            raise ValueError("Payment milestone percentages must total 100")
        if not any(item.release_gate for item in value):
            raise ValueError("At least one payment milestone must release procurement")
        return value


class SalesOrderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    number: str = Field(min_length=1, max_length=60)
    quotation_version_id: uuid.UUID
    requirement_profile_id: uuid.UUID
    payment_terms_id: uuid.UUID
    supplier_entity_ids: list[uuid.UUID] = Field(min_length=1)


class SalesOrderRelease(BaseModel):
    expected_version: int = Field(ge=1)


class ReceiptCreate(BaseModel):
    bank_reference: str = Field(min_length=1, max_length=200)
    amount: Decimal = Field(gt=0)
    currency: str = Field(min_length=3, max_length=3)
    value_date: date
    receiving_account: str = Field(min_length=1, max_length=200)
    evidence_id: uuid.UUID | None = None


class ReceiptConfirm(BaseModel):
    expected_version: int = Field(ge=1)


class AllocationCreate(BaseModel):
    receipt_id: uuid.UUID
    sales_order_id: uuid.UUID
    milestone_id: str = Field(min_length=1, max_length=100)
    amount: Decimal = Field(gt=0)


class AllocationReverse(BaseModel):
    reason: str = Field(min_length=1)
