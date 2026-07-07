"""Site/Page/DataBinding and public runtime schemas."""

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.site import SiteDeploymentStatus, SiteEnvironment
from app.schemas.engine import RowPage, RowQuery
from app.schemas.job import JobOut
from app.services.site_design import default_grapesjs_content


class SiteCreate(BaseModel):
    name: str = Field(default="Untitled site", min_length=1, max_length=200)
    slug: str = Field(min_length=3, max_length=120, pattern=r"^[a-z0-9][a-z0-9-]*$")
    description: str | None = Field(default=None, max_length=500)
    folder_id: uuid.UUID | None = None


class SiteUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(
        default=None, min_length=3, max_length=120, pattern=r"^[a-z0-9][a-z0-9-]*$"
    )
    description: str | None = Field(default=None, max_length=500)
    folder_id: uuid.UUID | None = None
    homepage_path: str | None = Field(default=None, min_length=1, max_length=255)
    published: bool | None = None


class SiteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    folder_id: uuid.UUID | None
    name: str
    slug: str
    description: str | None
    homepage_path: str
    published: bool


class SitePageCreate(BaseModel):
    title: str = Field(default="Untitled page", min_length=1, max_length=200)
    path: str = Field(default="/", min_length=1, max_length=255)
    content: dict[str, Any] = Field(default_factory=default_grapesjs_content)
    is_published: bool = True


class SitePageUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    path: str | None = Field(default=None, min_length=1, max_length=255)
    content: dict[str, Any] | None = None
    is_published: bool | None = None
    order: int | None = Field(default=None, ge=0)


class SiteDesignImport(BaseModel):
    source_type: Literal[
        "html",
        "figma-html",
        "penpot-html",
        "grapesjs-project",
    ] = "html"
    source_name: str | None = Field(default=None, max_length=255)
    html: str | None = Field(default=None, max_length=2_000_000)
    css: str | None = Field(default=None, max_length=1_000_000)
    project: dict[str, Any] | None = None


class SitePageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    title: str
    path: str
    content: dict[str, Any]
    is_published: bool
    order: int


class SiteDataBindingCreate(BaseModel):
    database_id: uuid.UUID
    key: str = Field(min_length=2, max_length=80, pattern=r"^[a-zA-Z][a-zA-Z0-9_]*$")
    name: str = Field(min_length=1, max_length=200)
    page_id: uuid.UUID | None = None
    query: RowQuery = Field(default_factory=RowQuery)
    field_ids: list[str] = Field(min_length=1, max_length=50)
    expose_public: bool = True


class SiteDataBindingUpdate(BaseModel):
    key: str | None = Field(
        default=None, min_length=2, max_length=80, pattern=r"^[a-zA-Z][a-zA-Z0-9_]*$"
    )
    name: str | None = Field(default=None, min_length=1, max_length=200)
    page_id: uuid.UUID | None = None
    query: RowQuery | None = None
    field_ids: list[str] | None = Field(default=None, min_length=1, max_length=50)
    expose_public: bool | None = None
    order: int | None = Field(default=None, ge=0)


class SiteDataBindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    page_id: uuid.UUID | None
    database_id: uuid.UUID
    key: str
    name: str
    query: dict[str, Any]
    field_ids: list[str]
    expose_public: bool
    order: int


class SiteDeploymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    workspace_id: uuid.UUID
    created_by_id: uuid.UUID
    job_id: uuid.UUID | None
    asset_id: uuid.UUID | None
    version: int
    environment: SiteEnvironment
    active: bool
    status: SiteDeploymentStatus
    entry_path: str
    manifest: dict[str, Any]
    error: str | None


class SiteDeploymentCreate(BaseModel):
    environment: SiteEnvironment = SiteEnvironment.production


class SiteBuildOut(BaseModel):
    deployment: SiteDeploymentOut
    job: JobOut


class SiteDomainCreate(BaseModel):
    hostname: str = Field(min_length=3, max_length=255)
    environment: SiteEnvironment = SiteEnvironment.production
    verified: bool = False
    primary: bool = False


class SiteDomainUpdate(BaseModel):
    hostname: str | None = Field(default=None, min_length=3, max_length=255)
    environment: SiteEnvironment | None = None
    verified: bool | None = None
    primary: bool | None = None


class SiteDomainOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    workspace_id: uuid.UUID
    hostname: str
    environment: SiteEnvironment
    verified: bool
    primary: bool


class PublicPageSummary(BaseModel):
    id: uuid.UUID
    title: str
    path: str


class PublicSiteOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    homepage_path: str
    pages: list[PublicPageSummary]


class PublicBindingSummary(BaseModel):
    key: str
    name: str
    field_ids: list[str]


class PublicPageOut(BaseModel):
    site: PublicSiteOut
    page: SitePageOut
    bindings: list[PublicBindingSummary]


class PublicBindingDataOut(BaseModel):
    key: str
    name: str
    field_ids: list[str]
    data: RowPage
