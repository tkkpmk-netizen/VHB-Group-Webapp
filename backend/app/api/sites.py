"""Site/Page/DataBinding admin APIs and public runtime APIs."""

import uuid
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import HTMLResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.engine import query_rows
from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.asset import Asset, AssetStatus
from app.models.database import Database
from app.models.field import Field
from app.models.permission import ResourceType
from app.models.resource import Folder, Space
from app.models.site import (
    Site,
    SiteDataBinding,
    SiteDeployment,
    SiteDeploymentStatus,
    SiteDomain,
    SiteEnvironment,
    SitePage,
)
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.engine import RowPage, RowQuery
from app.schemas.site import (
    PublicBindingDataOut,
    PublicBindingSummary,
    PublicPageOut,
    PublicPageSummary,
    PublicSiteOut,
    SiteBuildOut,
    SiteCreate,
    SiteDataBindingCreate,
    SiteDataBindingOut,
    SiteDataBindingUpdate,
    SiteDeploymentCreate,
    SiteDeploymentOut,
    SiteDesignImport,
    SiteDomainCreate,
    SiteDomainOut,
    SiteDomainUpdate,
    SiteOut,
    SitePageCreate,
    SitePageOut,
    SitePageUpdate,
    SiteUpdate,
)
from app.services.authorization import (
    Action,
    delete_resource_grants,
    require_database_action,
    require_resource_action,
    require_workspace_action,
)
from app.services.events import record_event
from app.services.jobs import enqueue_job
from app.services.site_build import next_site_deployment_version
from app.services.site_design import default_grapesjs_content, imported_grapesjs_content
from app.services.storage import ObjectStorage, StoredObjectNotFoundError, get_object_storage

router = APIRouter(tags=["sites"])


def _normalize_slug(slug: str) -> str:
    return slug.strip().lower()


def _normalize_path(path: str) -> str:
    clean = "/" + path.strip().strip("/")
    return "/" if clean == "/" else clean


def _normalize_hostname(hostname: str) -> str:
    clean = hostname.strip().lower()
    clean = clean.removeprefix("https://").removeprefix("http://")
    clean = clean.split("/", 1)[0].split(":", 1)[0].strip(".")
    if not clean or " " in clean or "." not in clean:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Invalid hostname")
    return clean


async def _scoped_site(site_id: uuid.UUID, workspace: Workspace, db: AsyncSession) -> Site:
    site = await db.get(Site, site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    return site


async def _scoped_page(
    page_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> tuple[SitePage, Site]:
    page = await db.get(SitePage, page_id)
    if page is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site page not found")
    site = await _scoped_site(page.site_id, workspace, db)
    return page, site


async def _scoped_binding(
    binding_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> tuple[SiteDataBinding, Site]:
    binding = await db.get(SiteDataBinding, binding_id)
    if binding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site data binding not found")
    site = await _scoped_site(binding.site_id, workspace, db)
    return binding, site


async def _scoped_domain(
    domain_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> tuple[SiteDomain, Site]:
    domain = await db.get(SiteDomain, domain_id)
    if domain is None or domain.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site domain not found")
    site = await _scoped_site(domain.site_id, workspace, db)
    return domain, site


async def _active_ready_deployment(
    site: Site,
    db: AsyncSession,
    *,
    environment: SiteEnvironment = SiteEnvironment.production,
) -> SiteDeployment | None:
    active = await db.scalar(
        select(SiteDeployment)
        .where(
            SiteDeployment.site_id == site.id,
            SiteDeployment.environment == environment,
            SiteDeployment.status == SiteDeploymentStatus.ready,
            SiteDeployment.asset_id.is_not(None),
            SiteDeployment.active.is_(True),
        )
        .order_by(SiteDeployment.version.desc(), SiteDeployment.created_at.desc())
        .limit(1)
    )
    if active is not None:
        return active
    return cast(
        SiteDeployment | None,
        await db.scalar(
            select(SiteDeployment)
            .where(
                SiteDeployment.site_id == site.id,
                SiteDeployment.environment == environment,
                SiteDeployment.status == SiteDeploymentStatus.ready,
                SiteDeployment.asset_id.is_not(None),
            )
            .order_by(SiteDeployment.version.desc(), SiteDeployment.created_at.desc())
            .limit(1)
        ),
    )


async def _validate_folder(
    folder_id: uuid.UUID | None, workspace: Workspace, db: AsyncSession
) -> None:
    if folder_id is None:
        return
    result = await db.execute(
        select(Folder)
        .join(Space, Space.id == Folder.space_id)
        .where(Folder.id == folder_id, Space.workspace_id == workspace.id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")


async def _validate_binding_source(
    *,
    site: Site,
    database_id: uuid.UUID,
    page_id: uuid.UUID | None,
    field_ids: list[str],
    workspace: Workspace,
    current_user: User,
    db: AsyncSession,
) -> None:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    await require_database_action(
        db,
        database_id=database.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    if page_id is not None:
        page = await db.get(SitePage, page_id)
        if page is None or page.site_id != site.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Site page not found")
    result = await db.execute(select(Field).where(Field.database_id == database.id))
    existing = {str(field.id) for field in result.scalars()}
    missing = [field_id for field_id in field_ids if field_id not in existing]
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Unknown public field ids: {', '.join(missing)}",
        )


async def _commit_or_conflict(db: AsyncSession, detail: str) -> None:
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail) from exc


@router.get("/sites", response_model=list[SiteOut])
async def list_sites(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Site]:
    result = await db.execute(
        select(Site).where(Site.workspace_id == workspace.id).order_by(Site.updated_at.desc())
    )
    return list(result.scalars())


@router.post("/sites", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
async def create_site(
    payload: SiteCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Site:
    await require_workspace_action(
        db,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    await _validate_folder(payload.folder_id, workspace, db)
    site = Site(
        workspace_id=workspace.id,
        folder_id=payload.folder_id,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
        name=payload.name,
        slug=_normalize_slug(payload.slug),
        description=payload.description,
    )
    db.add(site)
    await db.flush()
    db.add(
        SitePage(
            site_id=site.id,
            title="Home",
            path="/",
            content=default_grapesjs_content("Home"),
            is_published=True,
            order=0,
        )
    )
    record_event(
        db,
        action="site.created",
        resource_type="site",
        resource_id=str(site.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
    )
    await _commit_or_conflict(db, "Site slug already exists")
    await db.refresh(site)
    return site


@router.get("/sites/{site_id}", response_model=SiteOut)
async def get_site(
    site_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Site:
    site = await _scoped_site(site_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    return site


@router.patch("/sites/{site_id}", response_model=SiteOut)
async def update_site(
    site_id: uuid.UUID,
    payload: SiteUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Site:
    site = await _scoped_site(site_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    if "folder_id" in payload.model_fields_set:
        await _validate_folder(payload.folder_id, workspace, db)
        site.folder_id = payload.folder_id
    if payload.name is not None:
        site.name = payload.name
    if payload.slug is not None:
        site.slug = _normalize_slug(payload.slug)
    if payload.description is not None or "description" in payload.model_fields_set:
        site.description = payload.description
    if payload.homepage_path is not None:
        site.homepage_path = _normalize_path(payload.homepage_path)
    if payload.published is not None:
        site.published = payload.published
    site.updated_by_id = current_user.id
    await _commit_or_conflict(db, "Site slug already exists")
    await db.refresh(site)
    return site


@router.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site(
    site_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    site = await _scoped_site(site_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )
    await delete_resource_grants(
        db,
        workspace_id=workspace.id,
        resource_type=ResourceType.site,
        resource_id=site.id,
    )
    await db.delete(site)
    await db.commit()


@router.get("/sites/{site_id}/deployments", response_model=list[SiteDeploymentOut])
async def list_site_deployments(
    site_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SiteDeployment]:
    site = await _scoped_site(site_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    result = await db.execute(
        select(SiteDeployment)
        .where(SiteDeployment.site_id == site.id)
        .order_by(SiteDeployment.version.desc(), SiteDeployment.created_at.desc())
        .limit(20)
    )
    return list(result.scalars())


@router.post(
    "/sites/{site_id}/deployments",
    response_model=SiteBuildOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_site_deployment(
    site_id: uuid.UUID,
    payload: SiteDeploymentCreate | None = None,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteBuildOut:
    site = await _scoped_site(site_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    environment = payload.environment if payload is not None else SiteEnvironment.production
    version = await next_site_deployment_version(db, site.id)
    deployment = SiteDeployment(
        site_id=site.id,
        workspace_id=workspace.id,
        created_by_id=current_user.id,
        version=version,
        environment=environment,
        status=SiteDeploymentStatus.queued,
        entry_path=site.homepage_path,
        manifest={"site_id": str(site.id), "slug": site.slug, "environment": environment.value},
    )
    db.add(deployment)
    await db.commit()
    await db.refresh(deployment)
    job = await enqueue_job(
        db,
        workspace_id=workspace.id,
        created_by_id=current_user.id,
        job_type="site.build",
        payload={
            "site_id": str(site.id),
            "deployment_id": str(deployment.id),
            "environment": environment.value,
        },
        max_attempts=3,
        idempotency_key=f"site-build:{deployment.id}",
    )
    deployment.job_id = job.id
    site.updated_by_id = current_user.id
    record_event(
        db,
        action="site.deployment_queued",
        resource_type="site",
        resource_id=str(site.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={
            "deployment_id": str(deployment.id),
            "job_id": str(job.id),
            "version": version,
            "environment": environment.value,
        },
    )
    await db.commit()
    await db.refresh(deployment)
    await db.refresh(job)
    return SiteBuildOut(deployment=SiteDeploymentOut.model_validate(deployment), job=job)


@router.post("/site-deployments/{deployment_id}/promote", response_model=SiteDeploymentOut)
async def promote_site_deployment(
    deployment_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteDeployment:
    deployment = await db.get(SiteDeployment, deployment_id)
    if deployment is None or deployment.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site deployment not found")
    site = await _scoped_site(deployment.site_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    if deployment.status is not SiteDeploymentStatus.ready or deployment.asset_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only ready deployments can be promoted")
    result = await db.execute(
        select(SiteDeployment).where(
            SiteDeployment.site_id == site.id,
            SiteDeployment.environment == deployment.environment,
            SiteDeployment.active.is_(True),
        )
    )
    for active in result.scalars():
        active.active = False
    deployment.active = True
    site.updated_by_id = current_user.id
    record_event(
        db,
        action="site.deployment_promoted",
        resource_type="site",
        resource_id=str(site.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={
            "deployment_id": str(deployment.id),
            "version": deployment.version,
            "environment": deployment.environment.value,
        },
    )
    await db.commit()
    await db.refresh(deployment)
    return deployment


@router.get("/sites/{site_id}/domains", response_model=list[SiteDomainOut])
async def list_site_domains(
    site_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SiteDomain]:
    site = await _scoped_site(site_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    result = await db.execute(
        select(SiteDomain)
        .where(SiteDomain.site_id == site.id)
        .order_by(SiteDomain.primary.desc(), SiteDomain.hostname)
    )
    return list(result.scalars())


@router.post(
    "/sites/{site_id}/domains",
    response_model=SiteDomainOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_site_domain(
    site_id: uuid.UUID,
    payload: SiteDomainCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteDomain:
    site = await _scoped_site(site_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    if payload.primary:
        result = await db.execute(
            select(SiteDomain).where(
                SiteDomain.site_id == site.id,
                SiteDomain.environment == payload.environment,
                SiteDomain.primary.is_(True),
            )
        )
        for existing in result.scalars():
            existing.primary = False
    domain = SiteDomain(
        site_id=site.id,
        workspace_id=workspace.id,
        hostname=_normalize_hostname(payload.hostname),
        environment=payload.environment,
        verified=payload.verified,
        primary=payload.primary,
    )
    db.add(domain)
    site.updated_by_id = current_user.id
    record_event(
        db,
        action="site.domain_created",
        resource_type="site",
        resource_id=str(site.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={
            "hostname": domain.hostname,
            "environment": domain.environment.value,
            "verified": domain.verified,
        },
    )
    await _commit_or_conflict(db, "Domain hostname already exists")
    await db.refresh(domain)
    return domain


@router.patch("/site-domains/{domain_id}", response_model=SiteDomainOut)
async def update_site_domain(
    domain_id: uuid.UUID,
    payload: SiteDomainUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteDomain:
    domain, site = await _scoped_domain(domain_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    next_environment = payload.environment or domain.environment
    next_primary = payload.primary if payload.primary is not None else domain.primary
    if next_primary:
        result = await db.execute(
            select(SiteDomain).where(
                SiteDomain.site_id == site.id,
                SiteDomain.environment == next_environment,
                SiteDomain.id != domain.id,
                SiteDomain.primary.is_(True),
            )
        )
        for existing in result.scalars():
            existing.primary = False
    if payload.hostname is not None:
        domain.hostname = _normalize_hostname(payload.hostname)
    if payload.environment is not None:
        domain.environment = payload.environment
    if payload.verified is not None:
        domain.verified = payload.verified
    if payload.primary is not None:
        domain.primary = payload.primary
    site.updated_by_id = current_user.id
    await _commit_or_conflict(db, "Domain hostname already exists")
    await db.refresh(domain)
    return domain


@router.delete("/site-domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site_domain(
    domain_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    domain, site = await _scoped_domain(domain_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    await db.delete(domain)
    site.updated_by_id = current_user.id
    await db.commit()


@router.get("/sites/{site_id}/pages", response_model=list[SitePageOut])
async def list_site_pages(
    site_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SitePage]:
    site = await _scoped_site(site_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    result = await db.execute(
        select(SitePage)
        .where(SitePage.site_id == site.id)
        .order_by(SitePage.order, SitePage.created_at)
    )
    return list(result.scalars())


@router.post(
    "/sites/{site_id}/pages",
    response_model=SitePageOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_site_page(
    site_id: uuid.UUID,
    payload: SitePageCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SitePage:
    site = await _scoped_site(site_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    order = int(
        await db.scalar(
            select(func.coalesce(func.max(SitePage.order), -1)).where(SitePage.site_id == site.id)
        )
        or 0
    )
    page = SitePage(
        site_id=site.id,
        title=payload.title,
        path=_normalize_path(payload.path),
        content=payload.content,
        is_published=payload.is_published,
        order=order + 1,
    )
    site.updated_by_id = current_user.id
    db.add(page)
    await _commit_or_conflict(db, "Page path already exists in this site")
    await db.refresh(page)
    return page


@router.patch("/site-pages/{page_id}", response_model=SitePageOut)
async def update_site_page(
    page_id: uuid.UUID,
    payload: SitePageUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SitePage:
    page, site = await _scoped_page(page_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    if payload.title is not None:
        page.title = payload.title
    if payload.path is not None:
        page.path = _normalize_path(payload.path)
    if payload.content is not None:
        page.content = payload.content
    if payload.is_published is not None:
        page.is_published = payload.is_published
    if payload.order is not None:
        page.order = payload.order
    site.updated_by_id = current_user.id
    await _commit_or_conflict(db, "Page path already exists in this site")
    await db.refresh(page)
    return page


@router.post("/site-pages/{page_id}/import-design", response_model=SitePageOut)
async def import_site_page_design(
    page_id: uuid.UUID,
    payload: SiteDesignImport,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SitePage:
    page, site = await _scoped_page(page_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    try:
        page.content = imported_grapesjs_content(
            source_type=payload.source_type,
            source_name=payload.source_name,
            page_title=page.title,
            html=payload.html,
            css=payload.css,
            project=payload.project,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    site.updated_by_id = current_user.id
    record_event(
        db,
        action="site_page.design_imported",
        resource_type="site",
        resource_id=str(site.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={"page_id": str(page.id), "source_type": payload.source_type},
    )
    await db.commit()
    await db.refresh(page)
    return page


@router.delete("/site-pages/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site_page(
    page_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    page, site = await _scoped_page(page_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    await db.delete(page)
    site.updated_by_id = current_user.id
    await db.commit()


@router.get("/sites/{site_id}/bindings", response_model=list[SiteDataBindingOut])
async def list_site_bindings(
    site_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SiteDataBinding]:
    site = await _scoped_site(site_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    result = await db.execute(
        select(SiteDataBinding)
        .where(SiteDataBinding.site_id == site.id)
        .order_by(SiteDataBinding.order, SiteDataBinding.created_at)
    )
    return list(result.scalars())


@router.post(
    "/sites/{site_id}/bindings",
    response_model=SiteDataBindingOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_site_binding(
    site_id: uuid.UUID,
    payload: SiteDataBindingCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteDataBinding:
    site = await _scoped_site(site_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    await _validate_binding_source(
        site=site,
        database_id=payload.database_id,
        page_id=payload.page_id,
        field_ids=payload.field_ids,
        workspace=workspace,
        current_user=current_user,
        db=db,
    )
    order = int(
        await db.scalar(
            select(func.coalesce(func.max(SiteDataBinding.order), -1)).where(
                SiteDataBinding.site_id == site.id
            )
        )
        or 0
    )
    binding = SiteDataBinding(
        site_id=site.id,
        page_id=payload.page_id,
        database_id=payload.database_id,
        key=payload.key,
        name=payload.name,
        query=payload.query.model_dump(mode="json", exclude_none=True),
        field_ids=payload.field_ids,
        expose_public=payload.expose_public,
        order=order + 1,
    )
    site.updated_by_id = current_user.id
    db.add(binding)
    await _commit_or_conflict(db, "Binding key already exists in this site")
    await db.refresh(binding)
    return binding


@router.patch("/site-bindings/{binding_id}", response_model=SiteDataBindingOut)
async def update_site_binding(
    binding_id: uuid.UUID,
    payload: SiteDataBindingUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SiteDataBinding:
    binding, site = await _scoped_binding(binding_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    next_database_id = binding.database_id
    next_page_id = binding.page_id
    next_field_ids = binding.field_ids
    if payload.query is not None:
        binding.query = payload.query.model_dump(mode="json", exclude_none=True)
    if payload.field_ids is not None:
        next_field_ids = payload.field_ids
    if "page_id" in payload.model_fields_set:
        next_page_id = payload.page_id
    await _validate_binding_source(
        site=site,
        database_id=next_database_id,
        page_id=next_page_id,
        field_ids=next_field_ids,
        workspace=workspace,
        current_user=current_user,
        db=db,
    )
    if payload.key is not None:
        binding.key = payload.key
    if payload.name is not None:
        binding.name = payload.name
    if "page_id" in payload.model_fields_set:
        binding.page_id = payload.page_id
    if payload.field_ids is not None:
        binding.field_ids = payload.field_ids
    if payload.expose_public is not None:
        binding.expose_public = payload.expose_public
    if payload.order is not None:
        binding.order = payload.order
    site.updated_by_id = current_user.id
    await _commit_or_conflict(db, "Binding key already exists in this site")
    await db.refresh(binding)
    return binding


@router.delete("/site-bindings/{binding_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site_binding(
    binding_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    binding, site = await _scoped_binding(binding_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.site,
        resource_id=site.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    await db.delete(binding)
    site.updated_by_id = current_user.id
    await db.commit()


async def _public_site(slug: str, db: AsyncSession) -> Site:
    site = await db.scalar(select(Site).where(Site.slug == _normalize_slug(slug)))
    if site is None or not site.published:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Published site not found")
    return site


async def _public_site_out(site: Site, db: AsyncSession) -> PublicSiteOut:
    pages = await db.execute(
        select(SitePage)
        .where(SitePage.site_id == site.id, SitePage.is_published.is_(True))
        .order_by(SitePage.order, SitePage.created_at)
    )
    return PublicSiteOut(
        id=site.id,
        name=site.name,
        slug=site.slug,
        description=site.description,
        homepage_path=site.homepage_path,
        pages=[
            PublicPageSummary(id=page.id, title=page.title, path=page.path)
            for page in pages.scalars()
        ],
    )


def _prune_row_page(data: RowPage, field_ids: list[str]) -> RowPage:
    allowed = set(field_ids)
    for row in data.items:
        row.data = {field_id: value for field_id, value in row.data.items() if field_id in allowed}
    return data


@router.get("/public/sites/{slug}", response_model=PublicSiteOut)
async def get_public_site(slug: str, db: AsyncSession = Depends(get_db)) -> PublicSiteOut:
    return await _public_site_out(await _public_site(slug, db), db)


@router.get("/public/sites/{slug}/pages", response_model=PublicPageOut)
async def get_public_homepage(slug: str, db: AsyncSession = Depends(get_db)) -> PublicPageOut:
    site = await _public_site(slug, db)
    return await get_public_page(slug, site.homepage_path.strip("/"), db)


@router.get("/public/sites/{slug}/pages/{page_path:path}", response_model=PublicPageOut)
async def get_public_page(
    slug: str,
    page_path: str,
    db: AsyncSession = Depends(get_db),
) -> PublicPageOut:
    site = await _public_site(slug, db)
    path = _normalize_path(page_path or site.homepage_path)
    page = await db.scalar(
        select(SitePage).where(
            SitePage.site_id == site.id,
            SitePage.path == path,
            SitePage.is_published.is_(True),
        )
    )
    if page is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Published page not found")
    bindings = await db.execute(
        select(SiteDataBinding).where(
            SiteDataBinding.site_id == site.id,
            SiteDataBinding.expose_public.is_(True),
            (SiteDataBinding.page_id.is_(None)) | (SiteDataBinding.page_id == page.id),
        )
    )
    return PublicPageOut(
        site=await _public_site_out(site, db),
        page=page,
        bindings=[
            PublicBindingSummary(
                key=binding.key,
                name=binding.name,
                field_ids=binding.field_ids,
            )
            for binding in bindings.scalars()
        ],
    )


@router.get(
    "/public/sites/{slug}/bindings/{binding_key}",
    response_model=PublicBindingDataOut,
)
async def get_public_binding_data(
    slug: str,
    binding_key: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
) -> PublicBindingDataOut:
    site = await _public_site(slug, db)
    binding = await db.scalar(
        select(SiteDataBinding).where(
            SiteDataBinding.site_id == site.id,
            SiteDataBinding.key == binding_key,
            SiteDataBinding.expose_public.is_(True),
        )
    )
    if binding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Published binding not found")
    workspace = await db.get(Workspace, site.workspace_id)
    if workspace is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    query_payload: dict[str, Any] = {**binding.query, "page": page, "page_size": page_size}
    data = await query_rows(
        binding.database_id, RowQuery.model_validate(query_payload), workspace, db
    )
    return PublicBindingDataOut(
        key=binding.key,
        name=binding.name,
        field_ids=binding.field_ids,
        data=_prune_row_page(data, binding.field_ids),
    )


@router.get(
    "/public/sites/{slug}/deployment",
    response_model=SiteDeploymentOut,
)
async def get_public_latest_deployment(
    slug: str,
    environment: SiteEnvironment = Query(default=SiteEnvironment.production),
    db: AsyncSession = Depends(get_db),
) -> SiteDeployment:
    site = await _public_site(slug, db)
    deployment = await _active_ready_deployment(site, db, environment=environment)
    if deployment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Published deployment not found")
    return deployment


@router.get("/public/sites/{slug}/render", response_class=HTMLResponse)
@router.get("/public/sites/{slug}/render/{page_path:path}", response_class=HTMLResponse)
async def render_public_site(
    slug: str,
    page_path: str = "",
    environment: SiteEnvironment = Query(default=SiteEnvironment.production),
    db: AsyncSession = Depends(get_db),
    storage: ObjectStorage = Depends(get_object_storage),
) -> Response:
    site = await _public_site(slug, db)
    deployment = await _active_ready_deployment(site, db, environment=environment)
    if deployment is None or deployment.asset_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Published deployment not found")
    asset = await db.get(Asset, deployment.asset_id)
    if asset is None or asset.status is not AssetStatus.ready:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deployment artifact not found")
    try:
        data = await storage.get_bytes(asset.object_key)
    except StoredObjectNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deployment artifact missing") from exc
    return HTMLResponse(
        content=data.decode("utf-8"),
        headers={
            "Cache-Control": "public, max-age=60",
            "X-VHB-Deployment-ID": str(deployment.id),
            "X-VHB-Environment": deployment.environment.value,
            "X-VHB-Page-Path": "/" + page_path.strip("/") if page_path else site.homepage_path,
        },
    )


@router.get("/public/domains/{hostname}/deployment", response_model=SiteDeploymentOut)
async def get_public_domain_deployment(
    hostname: str,
    db: AsyncSession = Depends(get_db),
) -> SiteDeployment:
    domain = await db.scalar(
        select(SiteDomain).where(
            SiteDomain.hostname == _normalize_hostname(hostname),
            SiteDomain.verified.is_(True),
        )
    )
    if domain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Verified domain not found")
    site = await db.get(Site, domain.site_id)
    if site is None or not site.published:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Published site not found")
    deployment = await _active_ready_deployment(site, db, environment=domain.environment)
    if deployment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Published deployment not found")
    return deployment


@router.get("/public/domains/{hostname}/render", response_class=HTMLResponse)
@router.get("/public/domains/{hostname}/render/{page_path:path}", response_class=HTMLResponse)
async def render_public_domain(
    hostname: str,
    page_path: str = "",
    db: AsyncSession = Depends(get_db),
    storage: ObjectStorage = Depends(get_object_storage),
) -> Response:
    domain = await db.scalar(
        select(SiteDomain).where(
            SiteDomain.hostname == _normalize_hostname(hostname),
            SiteDomain.verified.is_(True),
        )
    )
    if domain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Verified domain not found")
    site = await db.get(Site, domain.site_id)
    if site is None or not site.published:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Published site not found")
    deployment = await _active_ready_deployment(site, db, environment=domain.environment)
    if deployment is None or deployment.asset_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Published deployment not found")
    asset = await db.get(Asset, deployment.asset_id)
    if asset is None or asset.status is not AssetStatus.ready:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deployment artifact not found")
    try:
        data = await storage.get_bytes(asset.object_key)
    except StoredObjectNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deployment artifact missing") from exc
    return HTMLResponse(
        content=data.decode("utf-8"),
        headers={
            "Cache-Control": "public, max-age=60",
            "X-VHB-Deployment-ID": str(deployment.id),
            "X-VHB-Domain": domain.hostname,
            "X-VHB-Environment": deployment.environment.value,
            "X-VHB-Page-Path": "/" + page_path.strip("/") if page_path else site.homepage_path,
        },
    )
