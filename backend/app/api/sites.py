"""Site/Page/DataBinding admin APIs and public runtime APIs."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.engine import query_rows
from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.database import Database
from app.models.field import Field
from app.models.permission import ResourceType
from app.models.resource import Folder, Space
from app.models.site import Site, SiteDataBinding, SitePage
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.engine import RowPage, RowQuery
from app.schemas.site import (
    PublicBindingDataOut,
    PublicBindingSummary,
    PublicPageOut,
    PublicPageSummary,
    PublicSiteOut,
    SiteCreate,
    SiteDataBindingCreate,
    SiteDataBindingOut,
    SiteDataBindingUpdate,
    SiteDesignImport,
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
from app.services.site_design import default_grapesjs_content, imported_grapesjs_content

router = APIRouter(tags=["sites"])


def _normalize_slug(slug: str) -> str:
    return slug.strip().lower()


def _normalize_path(path: str) -> str:
    clean = "/" + path.strip().strip("/")
    return "/" if clean == "/" else clean


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
