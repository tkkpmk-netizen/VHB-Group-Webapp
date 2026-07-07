"""Generic resource grant API schemas."""

import uuid

from pydantic import BaseModel, ConfigDict

from app.models.permission import ResourceRole, ResourceType


class ResourceGrantUpsert(BaseModel):
    user_id: uuid.UUID
    role: ResourceRole


class ResourceGrantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    resource_type: ResourceType
    resource_id: uuid.UUID
    user_id: uuid.UUID
    role: ResourceRole
