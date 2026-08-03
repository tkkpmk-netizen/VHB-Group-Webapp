"""Public contracts for the Commercial Data foundation."""

import datetime as dt
import enum
import uuid
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.commercial import (
    CommercialCatalogKind,
    CommercialSubjectType,
    MigrationBatchStatus,
    MigrationCandidateStatus,
    MigrationConflictStatus,
    MigrationTrustTier,
)


class CommercialCatalogOut(BaseModel):
    kind: CommercialCatalogKind
    database_id: uuid.UUID
    name: str
    created: bool


class CommercialCapability(enum.StrEnum):
    quality_read = "commercial.quality.read"
    products_read = "commercial.products.read"
    customers_read = "commercial.customers.read"
    pricing_read = "commercial.pricing.read"
    render_read = "commercial.render.read"


class CommercialNavigationItem(BaseModel):
    """One server-authorized destination rendered by the generic app shell."""

    id: Literal["quality", "products", "customers", "pricing", "render"]
    href: str
    label_key: str
    icon: Literal["shield-alt", "database", "users", "calculator", "file-excel"]
    order: int = Field(ge=0)
    capability: str
    badge_source_id: str | None = None
    badge_count: int | None = Field(default=None, ge=0)
    fallback_eligible: bool = False


class CommercialBootstrapOut(BaseModel):
    """Bounded workspace bootstrap; never includes record samples."""

    enabled: bool
    module_id: Literal["commercial-data"] = "commercial-data"
    workspace_id: uuid.UUID
    capability_version: str
    cohort: Literal["foundation"] = "foundation"
    as_of: dt.datetime
    destinations: list[CommercialNavigationItem]


class CommercialCapabilityAssignmentUpdate(BaseModel):
    subject_type: CommercialSubjectType
    subject_id: str = Field(min_length=1, max_length=200)
    allowed: bool
    expected_version: int = Field(ge=0)


class CommercialCapabilityAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    capability: CommercialCapability
    subject_type: CommercialSubjectType
    subject_id: str
    allowed: bool
    version: int
    policy_version: int


class CommercialCohortUpdate(BaseModel):
    enabled: bool
    cohort: Literal["foundation"] = "foundation"
    expected_version: int = Field(ge=0)


class CommercialCohortOut(BaseModel):
    workspace_id: uuid.UUID
    enabled: bool
    cohort: Literal["foundation"]
    version: int


class MigrationRawRowIn(BaseModel):
    source_locator: str = Field(min_length=1, max_length=500)
    raw_values: dict[str, object]
    source_url: str | None = Field(default=None, max_length=2048)
    record_type: Literal["product", "customer", "inquiry", "order"]
    normalized_values: dict[str, object]
    mapping_confidence: int = Field(ge=0, le=100)


class MigrationBatchCreate(BaseModel):
    source_key: str = Field(min_length=1, max_length=200)
    source_label: str = Field(min_length=1, max_length=255)
    source_url: str | None = Field(default=None, max_length=2048)
    asset_id: uuid.UUID | None = None
    priority_cohort: bool = False
    rows: list[MigrationRawRowIn] = Field(min_length=1, max_length=1000)


class MigrationConflictIn(BaseModel):
    kind: str = Field(min_length=1, max_length=100)
    detail: str = Field(min_length=1, max_length=4000)
    field_paths: list[str] = Field(default_factory=list, max_length=30)
    assigned_to_id: uuid.UUID | None = None
    due_at: dt.datetime | None = None


class MigrationReviewIn(BaseModel):
    expected_version: int = Field(ge=1)
    status: Literal["verified", "rejected", "needs_review"]
    trust_tier: MigrationTrustTier
    review_notes: str | None = Field(default=None, max_length=4000)
    conflicts: list[MigrationConflictIn] = Field(default_factory=list, max_length=30)


class MigrationConflictResolveIn(BaseModel):
    resolution: str = Field(min_length=1, max_length=4000)


class MigrationRemapIn(BaseModel):
    expected_version: int = Field(ge=1)
    normalized_values: dict[str, object]
    mapping_confidence: int = Field(ge=0, le=100)
    review_notes: str | None = Field(default=None, max_length=4000)


class MigrationBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    source_key: str
    source_label: str
    source_url: str | None
    source_checksum: str
    mapping_version: int
    status: MigrationBatchStatus
    priority_cohort: bool
    total_rows: int
    version: int
    created_at: dt.datetime


class MigrationCandidateOut(BaseModel):
    id: uuid.UUID
    batch_id: uuid.UUID
    source_locator: str
    record_type: str
    normalized_values: dict[str, object]
    mapping_confidence: int
    status: MigrationCandidateStatus
    trust_tier: MigrationTrustTier
    review_notes: str | None
    version: int
    open_conflicts: int
    assigned_to_id: uuid.UUID | None
    updated_at: dt.datetime


class MigrationConflictOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    candidate_id: uuid.UUID
    kind: str
    detail: str
    field_paths: list[str]
    status: MigrationConflictStatus
    assigned_to_id: uuid.UUID | None
    due_at: dt.datetime | None
    resolution: str | None


class MigrationQualitySummaryOut(BaseModel):
    batches: list[MigrationBatchOut]
    exceptions: list[MigrationCandidateOut]
    open_conflicts: int
    verified_candidates: int
    as_of: dt.datetime


class ProductCreateIn(BaseModel):
    sku: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=300)
    base_unit: str = Field(min_length=1, max_length=30)
    origin_country: str | None = Field(default=None, min_length=2, max_length=2)


class CustomerCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    sales_pic_id: uuid.UUID | None = None


class ProductUpdateIn(BaseModel):
    expected_version: int = Field(ge=1)
    sku: str | None = Field(default=None, min_length=1, max_length=100)
    name: str | None = Field(default=None, min_length=1, max_length=300)
    base_unit: str | None = Field(default=None, min_length=1, max_length=30)
    origin_country: str | None = Field(default=None, min_length=2, max_length=2)


class CustomerUpdateIn(BaseModel):
    expected_version: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=300)
    sales_pic_id: uuid.UUID | None = None


class MasterLifecycleIn(BaseModel):
    expected_version: int = Field(ge=1)
    action: Literal["retire", "merge"]
    merge_into_id: uuid.UUID | None = None


class SupplierCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    country: str | None = Field(default=None, min_length=2, max_length=2)
    supplier_code: str | None = Field(default=None, max_length=100)


class LegalPartyCreateIn(BaseModel):
    legal_name: str = Field(min_length=1, max_length=300)
    tax_identifier: str | None = Field(default=None, max_length=100)
    country: str = Field(min_length=2, max_length=2)


class ContactCreateIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=50)
    consent: bool = False


class AddressCreateIn(BaseModel):
    label: str = Field(default="Primary", min_length=1, max_length=100)
    line_1: str = Field(min_length=1, max_length=300)
    line_2: str | None = Field(default=None, max_length=300)
    city: str | None = Field(default=None, max_length=120)
    region: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=30)
    country: str = Field(min_length=2, max_length=2)
    is_default: bool = False


class FxRateCreateIn(BaseModel):
    base_currency: str = Field(min_length=3, max_length=3)
    quote_currency: str = Field(min_length=3, max_length=3)
    rate: Decimal = Field(gt=0, max_digits=20, decimal_places=8)
    effective_start: dt.datetime


class PriceDecisionIn(BaseModel):
    expected_version: int = Field(ge=1)
    note: str = Field(min_length=1, max_length=4000)


class OralPriceDecisionIn(BaseModel):
    expected_version: int = Field(ge=1)
    decision: Literal["confirm", "dispute"]
    note: str = Field(min_length=1, max_length=4000)


class PriceVersionCreateIn(BaseModel):
    product_id: uuid.UUID
    currency: str = Field(min_length=3, max_length=3)
    input_cost: Decimal = Field(gt=0, max_digits=20, decimal_places=4)
    fx_rate: Decimal = Field(default=Decimal("1"), gt=0, max_digits=20, decimal_places=8)
    logistics_cost: Decimal = Field(default=Decimal("0"), ge=0, max_digits=20, decimal_places=4)
    tax_cost: Decimal = Field(default=Decimal("0"), ge=0, max_digits=20, decimal_places=4)
    margin_percent: Decimal = Field(ge=0, le=1000, max_digits=9, decimal_places=4)
    effective_start: dt.datetime
    effective_end: dt.datetime | None = None
    incoterm: str | None = Field(default=None, max_length=20)


class PriceApprovalIn(BaseModel):
    expected_version: int = Field(ge=1)
    approved_price: Decimal = Field(gt=0, max_digits=20, decimal_places=4)
    approval_note: str | None = Field(default=None, max_length=4000)
    oral_pending: bool = False
