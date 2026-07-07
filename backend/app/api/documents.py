"""Workspace-scoped block document APIs."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.document import Document
from app.models.permission import ResourceType
from app.models.resource import Folder, Space
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.document import (
    DocumentContentUpdate,
    DocumentCreate,
    DocumentOut,
    DocumentUpdate,
)
from app.services.authorization import (
    Action,
    delete_resource_grants,
    require_resource_action,
)
from app.services.events import record_event

router = APIRouter(prefix="/documents", tags=["documents"])


async def _scoped_document(
    document_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> Document:
    document = await db.get(Document, document_id)
    if document is None or document.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return document


async def _validate_folder(
    folder_id: uuid.UUID | None, workspace: Workspace, db: AsyncSession
) -> None:
    if folder_id is None:
        return
    folder = await db.scalar(
        select(Folder)
        .join(Space, Space.id == Folder.space_id)
        .where(Folder.id == folder_id, Space.workspace_id == workspace.id)
    )
    if folder is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Document]:
    result = await db.execute(
        select(Document)
        .where(Document.workspace_id == workspace.id)
        .order_by(Document.updated_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars())


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def create_document(
    payload: DocumentCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Document:
    await _validate_folder(payload.folder_id, workspace, db)
    document = Document(
        workspace_id=workspace.id,
        folder_id=payload.folder_id,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
        title=payload.title,
        icon=payload.icon,
        content=[{"type": "paragraph", "content": ""}],
    )
    db.add(document)
    await db.flush()
    record_event(
        db,
        action="document.created",
        resource_type="document",
        resource_id=str(document.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={"title": document.title},
    )
    await db.commit()
    await db.refresh(document)
    return document


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(
    document_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Document:
    return await _scoped_document(document_id, workspace, db)


@router.patch("/{document_id}", response_model=DocumentOut)
async def update_document(
    document_id: uuid.UUID,
    payload: DocumentUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Document:
    document = await _scoped_document(document_id, workspace, db)
    if "folder_id" in payload.model_fields_set:
        await _validate_folder(payload.folder_id, workspace, db)
    for key in payload.model_fields_set:
        setattr(document, key, getattr(payload, key))
    document.updated_by_id = current_user.id
    await db.commit()
    await db.refresh(document)
    return document


@router.put("/{document_id}/content", response_model=DocumentOut)
async def replace_document_content(
    document_id: uuid.UUID,
    payload: DocumentContentUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Document:
    document = await _scoped_document(document_id, workspace, db)
    if document.version != payload.expected_version:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Document changed; current version is {document.version}",
        )
    document.content = payload.content
    document.version += 1
    document.updated_by_id = current_user.id
    await db.commit()
    await db.refresh(document)
    return document


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    document = await _scoped_document(document_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.document,
        resource_id=document.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )
    record_event(
        db,
        action="document.deleted",
        resource_type="document",
        resource_id=str(document.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
    )
    await delete_resource_grants(
        db,
        workspace_id=workspace.id,
        resource_type=ResourceType.document,
        resource_id=document.id,
    )
    await db.delete(document)
    await db.commit()
