"""Server-authoritative Commercial capability resolution and mutations."""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.commercial import (
    CommercialCapabilityAssignment,
    CommercialSubjectType,
    CommercialWorkspacePolicy,
)
from app.models.user import User
from app.models.workspace import MemberRole, Workspace, WorkspaceMember
from app.modules.commercial.commands import version_conflict
from app.modules.commercial.schemas import (
    CommercialCapability,
    CommercialCapabilityAssignmentUpdate,
    CommercialCohortUpdate,
)
from app.services.events import record_event

DEFAULT_COHORT = "foundation"
DEFAULT_CAPABILITIES: frozenset[CommercialCapability] = frozenset(CommercialCapability)


async def _membership(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> WorkspaceMember | None:
    membership: WorkspaceMember | None = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    return membership


async def get_workspace_policy(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
) -> CommercialWorkspacePolicy | None:
    return await db.get(CommercialWorkspacePolicy, workspace_id)


async def resolve_capabilities(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> tuple[frozenset[CommercialCapability], CommercialWorkspacePolicy | None]:
    """Resolve user > role > built-in defaults without an allow-side cache."""
    membership = await _membership(db, workspace_id=workspace_id, user_id=user_id)
    if membership is None:
        return frozenset(), None
    policy = await get_workspace_policy(db, workspace_id=workspace_id)
    if policy is not None and not policy.enabled:
        return frozenset(), policy

    result = set(DEFAULT_CAPABILITIES)
    assignments = await db.execute(
        select(CommercialCapabilityAssignment).where(
            CommercialCapabilityAssignment.workspace_id == workspace_id,
            CommercialCapabilityAssignment.subject_type.in_(
                [CommercialSubjectType.role, CommercialSubjectType.user]
            ),
            CommercialCapabilityAssignment.subject_id.in_([membership.role.value, str(user_id)]),
        )
    )
    role_overrides: dict[str, bool] = {}
    user_overrides: dict[str, bool] = {}
    for assignment in assignments.scalars():
        target = (
            user_overrides
            if assignment.subject_type is CommercialSubjectType.user
            else role_overrides
        )
        target[assignment.capability] = assignment.allowed
    for capability in CommercialCapability:
        allowed = user_overrides.get(
            capability.value,
            role_overrides.get(capability.value, capability in DEFAULT_CAPABILITIES),
        )
        if allowed:
            result.add(capability)
        else:
            result.discard(capability)
    return frozenset(result), policy


async def _lock_workspace_and_policy(
    db: AsyncSession,
    *,
    workspace: Workspace,
    actor: User,
) -> CommercialWorkspacePolicy:
    await db.scalar(select(Workspace).where(Workspace.id == workspace.id).with_for_update())
    policy = await db.scalar(
        select(CommercialWorkspacePolicy)
        .where(CommercialWorkspacePolicy.workspace_id == workspace.id)
        .with_for_update()
    )
    if policy is None:
        policy = CommercialWorkspacePolicy(
            workspace_id=workspace.id,
            cohort=DEFAULT_COHORT,
            enabled=True,
            version=0,
            updated_by_id=actor.id,
        )
        db.add(policy)
        await db.flush()
    return policy


async def update_capability_assignment(
    db: AsyncSession,
    *,
    workspace: Workspace,
    actor: User,
    capability: CommercialCapability,
    payload: CommercialCapabilityAssignmentUpdate,
) -> dict[str, Any]:
    policy = await _lock_workspace_and_policy(db, workspace=workspace, actor=actor)
    subject_id = payload.subject_id
    if payload.subject_type is CommercialSubjectType.role:
        try:
            MemberRole(subject_id)
        except ValueError as exc:
            raise ValueError("Unknown workspace role") from exc
    else:
        try:
            subject_user_id = uuid.UUID(subject_id)
        except ValueError as exc:
            raise ValueError("User subject_id must be a UUID") from exc
        if (
            await _membership(
                db,
                workspace_id=workspace.id,
                user_id=subject_user_id,
            )
            is None
        ):
            raise ValueError("User subject must be a workspace member")

    assignment = await db.scalar(
        select(CommercialCapabilityAssignment)
        .where(
            CommercialCapabilityAssignment.workspace_id == workspace.id,
            CommercialCapabilityAssignment.capability == capability.value,
            CommercialCapabilityAssignment.subject_type == payload.subject_type,
            CommercialCapabilityAssignment.subject_id == subject_id,
        )
        .with_for_update()
    )
    current_version = assignment.version if assignment is not None else 0
    if payload.expected_version != current_version:
        raise version_conflict(
            expected_version=payload.expected_version,
            current_version=current_version,
            changed_fields=["allowed"],
        )
    previous = assignment.allowed if assignment is not None else None
    if assignment is None:
        assignment = CommercialCapabilityAssignment(
            workspace_id=workspace.id,
            capability=capability.value,
            subject_type=payload.subject_type,
            subject_id=subject_id,
            allowed=payload.allowed,
            version=1,
            updated_by_id=actor.id,
        )
        db.add(assignment)
    else:
        assignment.allowed = payload.allowed
        assignment.version += 1
        assignment.updated_by_id = actor.id
    policy.version += 1
    policy.updated_by_id = actor.id
    await db.flush()
    record_event(
        db,
        action="commercial.capability_changed",
        resource_type="commercial_capability_assignment",
        resource_id=str(assignment.id),
        workspace_id=workspace.id,
        actor_id=actor.id,
        data={
            "capability": capability.value,
            "subject_type": payload.subject_type.value,
            "subject_id": subject_id,
            "previous_allowed": previous,
            "allowed": payload.allowed,
            "assignment_version": assignment.version,
            "policy_version": policy.version,
        },
    )
    return {
        "id": str(assignment.id),
        "workspace_id": str(workspace.id),
        "capability": capability.value,
        "subject_type": payload.subject_type.value,
        "subject_id": subject_id,
        "allowed": assignment.allowed,
        "version": assignment.version,
        "policy_version": policy.version,
    }


async def update_cohort(
    db: AsyncSession,
    *,
    workspace: Workspace,
    actor: User,
    payload: CommercialCohortUpdate,
) -> dict[str, Any]:
    policy = await _lock_workspace_and_policy(db, workspace=workspace, actor=actor)
    if payload.expected_version != policy.version:
        raise version_conflict(
            expected_version=payload.expected_version,
            current_version=policy.version,
            changed_fields=["enabled", "cohort"],
        )
    previous = {"enabled": policy.enabled, "cohort": policy.cohort}
    policy.enabled = payload.enabled
    policy.cohort = payload.cohort
    policy.version += 1
    policy.updated_by_id = actor.id
    record_event(
        db,
        action="commercial.cohort_changed",
        resource_type="commercial_workspace_policy",
        resource_id=str(workspace.id),
        workspace_id=workspace.id,
        actor_id=actor.id,
        data={
            "previous": previous,
            "enabled": policy.enabled,
            "cohort": policy.cohort,
            "policy_version": policy.version,
        },
    )
    return {
        "workspace_id": str(workspace.id),
        "enabled": policy.enabled,
        "cohort": policy.cohort,
        "version": policy.version,
    }
