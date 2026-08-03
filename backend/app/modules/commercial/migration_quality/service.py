"""Command/query helpers for the bounded T3 quality control center."""

import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.problems import ProblemDetailsError
from app.models.commercial import (
    MigrationBatch,
    MigrationBatchStatus,
    MigrationCandidate,
    MigrationCandidateStatus,
    MigrationConflict,
    MigrationConflictStatus,
    MigrationPromotionReceipt,
    MigrationSourceRow,
    MigrationTrustTier,
)
from app.models.user import User
from app.modules.commercial.commands import version_conflict
from app.modules.commercial.schemas import (
    MigrationBatchCreate,
    MigrationConflictResolveIn,
    MigrationRemapIn,
    MigrationReviewIn,
)
from app.services.events import record_event


def _checksum(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


async def create_batch(
    db: AsyncSession, *, workspace_id: uuid.UUID, actor: User, payload: MigrationBatchCreate
) -> dict[str, Any]:
    raw_envelope = [row.model_dump(mode="json") for row in payload.rows]
    checksum = _checksum(raw_envelope)
    existing = await db.scalar(
        select(MigrationBatch).where(
            MigrationBatch.workspace_id == workspace_id,
            MigrationBatch.source_key == payload.source_key,
            MigrationBatch.source_checksum == checksum,
        )
    )
    if existing is not None:
        return batch_out(existing)
    batch = MigrationBatch(
        workspace_id=workspace_id,
        asset_id=payload.asset_id,
        created_by_id=actor.id,
        source_key=payload.source_key,
        source_label=payload.source_label,
        source_url=payload.source_url,
        source_checksum=checksum,
        priority_cohort=payload.priority_cohort,
        total_rows=len(payload.rows),
        status=MigrationBatchStatus.reviewing,
    )
    db.add(batch)
    await db.flush()
    for row in payload.rows:
        raw = row.raw_values
        source = MigrationSourceRow(
            batch_id=batch.id,
            source_locator=row.source_locator,
            source_url=row.source_url or payload.source_url,
            raw_values=raw,
            raw_checksum=_checksum(raw),
        )
        db.add(source)
        await db.flush()
        db.add(
            MigrationCandidate(
                workspace_id=workspace_id,
                batch_id=batch.id,
                source_row_id=source.id,
                mapping_version=batch.mapping_version,
                record_type=row.record_type,
                normalized_values=row.normalized_values,
                mapping_confidence=row.mapping_confidence,
                status=MigrationCandidateStatus.pending
                if row.mapping_confidence >= 90
                else MigrationCandidateStatus.needs_review,
                trust_tier=MigrationTrustTier.reference_only,
            )
        )
    record_event(
        db,
        action="commercial.migration_batch_staged",
        resource_type="migration_batch",
        resource_id=str(batch.id),
        workspace_id=workspace_id,
        actor_id=actor.id,
        data={
            "source_key": batch.source_key,
            "source_checksum": checksum,
            "rows": batch.total_rows,
            "priority_cohort": batch.priority_cohort,
        },
    )
    await db.flush()
    return batch_out(batch)


def batch_out(batch: MigrationBatch) -> dict[str, Any]:
    return {
        "id": str(batch.id),
        "source_key": batch.source_key,
        "source_label": batch.source_label,
        "source_url": batch.source_url,
        "source_checksum": batch.source_checksum,
        "mapping_version": batch.mapping_version,
        "status": batch.status.value,
        "priority_cohort": batch.priority_cohort,
        "total_rows": batch.total_rows,
        "version": batch.version,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
    }


async def candidate_out(db: AsyncSession, candidate: MigrationCandidate) -> dict[str, Any]:
    row = await db.get(MigrationSourceRow, candidate.source_row_id)
    open_conflicts = (
        await db.scalar(
            select(func.count(MigrationConflict.id)).where(
                MigrationConflict.candidate_id == candidate.id,
                MigrationConflict.status == MigrationConflictStatus.open,
            )
        )
        or 0
    )
    conflict_owner = await db.scalar(
        select(MigrationConflict.assigned_to_id)
        .where(
            MigrationConflict.candidate_id == candidate.id,
            MigrationConflict.status == MigrationConflictStatus.open,
        )
        .limit(1)
    )
    return {
        "id": str(candidate.id),
        "batch_id": str(candidate.batch_id),
        "source_locator": row.source_locator if row else "unknown",
        "record_type": candidate.record_type,
        "normalized_values": candidate.normalized_values,
        "mapping_confidence": candidate.mapping_confidence,
        "status": candidate.status.value,
        "trust_tier": candidate.trust_tier.value,
        "review_notes": candidate.review_notes,
        "version": candidate.version,
        "open_conflicts": open_conflicts,
        "assigned_to_id": str(conflict_owner) if conflict_owner else None,
        "updated_at": candidate.updated_at.isoformat() if candidate.updated_at else None,
    }


async def review_candidate(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    actor: User,
    candidate_id: uuid.UUID,
    payload: MigrationReviewIn,
) -> dict[str, Any]:
    candidate = await db.scalar(
        select(MigrationCandidate)
        .where(
            MigrationCandidate.id == candidate_id, MigrationCandidate.workspace_id == workspace_id
        )
        .with_for_update()
    )
    if candidate is None:
        raise LookupError("Candidate not found")
    if candidate.version != payload.expected_version:
        raise version_conflict(
            expected_version=payload.expected_version,
            current_version=candidate.version,
            changed_fields=["status", "trust_tier", "review_notes", "conflicts"],
        )
    if payload.status == "verified" and payload.conflicts:
        raise ValueError("A verified candidate cannot retain open conflicts")
    await db.execute(
        select(MigrationConflict)
        .where(MigrationConflict.candidate_id == candidate.id)
        .with_for_update()
    )
    for conflict in payload.conflicts:
        db.add(
            MigrationConflict(
                workspace_id=workspace_id,
                candidate_id=candidate.id,
                kind=conflict.kind,
                detail=conflict.detail,
                field_paths=conflict.field_paths,
                assigned_to_id=conflict.assigned_to_id,
                due_at=conflict.due_at,
            )
        )
    candidate.status = MigrationCandidateStatus(payload.status)
    candidate.trust_tier = payload.trust_tier
    candidate.review_notes = payload.review_notes
    candidate.reviewed_by_id = actor.id
    candidate.reviewed_at = datetime.now(UTC)
    candidate.version += 1
    record_event(
        db,
        action="commercial.migration_candidate_reviewed",
        resource_type="migration_candidate",
        resource_id=str(candidate.id),
        workspace_id=workspace_id,
        actor_id=actor.id,
        data={
            "status": candidate.status.value,
            "trust_tier": candidate.trust_tier.value,
            "version": candidate.version,
        },
    )
    await db.flush()
    await db.refresh(candidate)
    return await candidate_out(db, candidate)


async def remap_candidate(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    actor: User,
    candidate_id: uuid.UUID,
    payload: MigrationRemapIn,
) -> dict[str, Any]:
    """Append a new mapping candidate while preserving source evidence and history."""
    candidate = await db.scalar(
        select(MigrationCandidate)
        .where(
            MigrationCandidate.id == candidate_id,
            MigrationCandidate.workspace_id == workspace_id,
        )
        .with_for_update()
    )
    if candidate is None:
        raise LookupError("Candidate not found")
    if candidate.version != payload.expected_version:
        raise version_conflict(
            expected_version=payload.expected_version,
            current_version=candidate.version,
            changed_fields=["normalized_values", "mapping_confidence"],
        )
    latest_mapping = (
        await db.scalar(
            select(func.max(MigrationCandidate.mapping_version)).where(
                MigrationCandidate.source_row_id == candidate.source_row_id
            )
        )
        or candidate.mapping_version
    )
    candidate.status = MigrationCandidateStatus.rejected
    candidate.review_notes = "Superseded by remapping"
    candidate.reviewed_by_id = actor.id
    candidate.reviewed_at = datetime.now(UTC)
    candidate.version += 1
    replacement = MigrationCandidate(
        workspace_id=workspace_id,
        batch_id=candidate.batch_id,
        source_row_id=candidate.source_row_id,
        mapping_version=latest_mapping + 1,
        record_type=candidate.record_type,
        normalized_values=payload.normalized_values,
        mapping_confidence=payload.mapping_confidence,
        status=(
            MigrationCandidateStatus.pending
            if payload.mapping_confidence >= 90
            else MigrationCandidateStatus.needs_review
        ),
        trust_tier=MigrationTrustTier.reference_only,
        review_notes=payload.review_notes,
    )
    db.add(replacement)
    batch = await db.get(MigrationBatch, candidate.batch_id)
    if batch is not None:
        batch.mapping_version = max(batch.mapping_version, latest_mapping + 1)
        batch.version += 1
    record_event(
        db,
        action="commercial.migration_candidate_remapped",
        resource_type="migration_candidate",
        resource_id=str(replacement.id),
        workspace_id=workspace_id,
        actor_id=actor.id,
        data={"supersedes": str(candidate.id), "mapping_version": latest_mapping + 1},
    )
    await db.flush()
    await db.refresh(replacement)
    return await candidate_out(db, replacement)


async def resolve_conflict(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    actor: User,
    conflict_id: uuid.UUID,
    payload: MigrationConflictResolveIn,
) -> dict[str, Any]:
    conflict = await db.scalar(
        select(MigrationConflict)
        .where(MigrationConflict.id == conflict_id, MigrationConflict.workspace_id == workspace_id)
        .with_for_update()
    )
    if conflict is None:
        raise LookupError("Conflict not found")
    conflict.status = MigrationConflictStatus.resolved
    conflict.resolution = payload.resolution
    conflict.resolved_by_id = actor.id
    conflict.resolved_at = datetime.now(UTC)
    record_event(
        db,
        action="commercial.migration_conflict_resolved",
        resource_type="migration_conflict",
        resource_id=str(conflict.id),
        workspace_id=workspace_id,
        actor_id=actor.id,
        data={"candidate_id": str(conflict.candidate_id), "kind": conflict.kind},
    )
    return {
        "id": str(conflict.id),
        "candidate_id": str(conflict.candidate_id),
        "kind": conflict.kind,
        "detail": conflict.detail,
        "field_paths": conflict.field_paths,
        "status": conflict.status.value,
        "assigned_to_id": str(conflict.assigned_to_id) if conflict.assigned_to_id else None,
        "due_at": conflict.due_at.isoformat() if conflict.due_at else None,
        "resolution": conflict.resolution,
    }


async def promote_candidate(
    db: AsyncSession, *, workspace_id: uuid.UUID, actor: User, candidate_id: uuid.UUID
) -> dict[str, Any]:
    candidate = await db.scalar(
        select(MigrationCandidate)
        .where(
            MigrationCandidate.id == candidate_id, MigrationCandidate.workspace_id == workspace_id
        )
        .with_for_update()
    )
    if candidate is None:
        raise LookupError("Candidate not found")
    receipt = await db.scalar(
        select(MigrationPromotionReceipt).where(
            MigrationPromotionReceipt.candidate_id == candidate.id
        )
    )
    if receipt is not None:
        return promotion_out(receipt)
    unresolved = (
        await db.scalar(
            select(func.count(MigrationConflict.id)).where(
                MigrationConflict.candidate_id == candidate.id,
                MigrationConflict.status == MigrationConflictStatus.open,
            )
        )
        or 0
    )
    if (
        candidate.status != MigrationCandidateStatus.verified
        or candidate.trust_tier != MigrationTrustTier.verified
        or unresolved
    ):
        raise ProblemDetailsError(
            status=422,
            code="MIGRATION_PROMOTION_BLOCKED",
            title="Candidate is not ready for promotion",
            detail="Resolve conflicts and complete verified review before promotion.",
            problem_type="https://vhb.local/problems/migration-promotion-blocked",
            extra={"open_conflicts": unresolved},
        )
    receipt = MigrationPromotionReceipt(
        workspace_id=workspace_id,
        candidate_id=candidate.id,
        reviewer_id=actor.id,
        trust_tier=candidate.trust_tier,
        resulting_record_type=candidate.record_type,
        resulting_snapshot=candidate.normalized_values,
    )
    db.add(receipt)
    candidate.status = MigrationCandidateStatus.promoted
    candidate.version += 1
    record_event(
        db,
        action="commercial.migration_candidate_promoted",
        resource_type="migration_promotion_receipt",
        resource_id=str(receipt.id),
        workspace_id=workspace_id,
        actor_id=actor.id,
        data={
            "candidate_id": str(candidate.id),
            "record_type": candidate.record_type,
            "trust_tier": candidate.trust_tier.value,
        },
    )
    await db.flush()
    return promotion_out(receipt)


def promotion_out(receipt: MigrationPromotionReceipt) -> dict[str, Any]:
    return {
        "id": str(receipt.id),
        "candidate_id": str(receipt.candidate_id),
        "trust_tier": receipt.trust_tier.value,
        "resulting_record_type": receipt.resulting_record_type,
        "resulting_snapshot": receipt.resulting_snapshot,
        "created_at": receipt.created_at.isoformat() if receipt.created_at else None,
    }
