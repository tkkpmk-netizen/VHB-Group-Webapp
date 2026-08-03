"""Bounded Prometheus metrics for HTTP and durable job execution."""

from collections import Counter, defaultdict
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job, JobStatus

request_count: Counter[tuple[str, str, int]] = Counter()
request_duration_seconds: defaultdict[tuple[str, str], float] = defaultdict(float)
job_events: Counter[tuple[str, str]] = Counter()
job_failures: Counter[tuple[str, str]] = Counter()
job_duration_seconds: defaultdict[tuple[str, str], float] = defaultdict(float)
job_queue_age_seconds: defaultdict[str, float] = defaultdict(float)
job_progress_updates: Counter[str] = Counter()


def _label(value: object) -> str:
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def record_job_event(job_type: str, event: str) -> None:
    job_events[(job_type, event)] += 1


def record_job_failure(job_type: str, code: str) -> None:
    job_failures[(job_type, code)] += 1


def record_job_duration(job_type: str, status: JobStatus, duration: float) -> None:
    job_duration_seconds[(job_type, status.value)] += max(duration, 0.0)


def record_job_queue_age(job_type: str, age_seconds: float) -> None:
    job_queue_age_seconds[job_type] += max(age_seconds, 0.0)


def record_job_progress(job_type: str) -> None:
    job_progress_updates[job_type] += 1


async def job_queue_snapshot(db: AsyncSession) -> list[dict[str, Any]]:
    rows = await db.execute(
        select(
            Job.type,
            Job.status,
            func.count(Job.id),
            func.min(Job.created_at),
        )
        .where(Job.status.in_([JobStatus.queued, JobStatus.running]))
        .group_by(Job.type, Job.status)
    )
    now = datetime.now(UTC)
    return [
        {
            "type": job_type,
            "status": status.value,
            "count": int(count),
            "oldest_age_seconds": max((now - oldest).total_seconds(), 0.0),
        }
        for job_type, status, count, oldest in rows
    ]


def render_prometheus(job_snapshot: list[dict[str, Any]] | None = None) -> str:
    lines = [
        "# HELP vhb_http_requests_total Total HTTP requests.",
        "# TYPE vhb_http_requests_total counter",
    ]
    for (method, path, status), value in sorted(request_count.items()):
        lines.append(
            f'vhb_http_requests_total{{method="{method}",path="{path}",status="{status}"}} {value}'
        )
    lines.extend(
        [
            "# HELP vhb_http_request_duration_seconds_total Cumulative request duration.",
            "# TYPE vhb_http_request_duration_seconds_total counter",
        ]
    )
    for (method, path), duration_value in sorted(request_duration_seconds.items()):
        lines.append(
            "vhb_http_request_duration_seconds_total"
            f'{{method="{method}",path="{path}"}} {duration_value:.6f}'
        )
    lines.extend(
        [
            "# HELP vhb_jobs_total Durable job lifecycle events.",
            "# TYPE vhb_jobs_total counter",
        ]
    )
    for (job_type, event), event_count in sorted(job_events.items()):
        lines.append(
            f'vhb_jobs_total{{type="{_label(job_type)}",event="{_label(event)}"}} {event_count}'
        )
    lines.extend(
        [
            "# HELP vhb_job_failures_total Durable job failures by stable code.",
            "# TYPE vhb_job_failures_total counter",
        ]
    )
    for (job_type, code), failure_count in sorted(job_failures.items()):
        lines.append(
            "vhb_job_failures_total"
            f'{{type="{_label(job_type)}",code="{_label(code)}"}} {failure_count}'
        )
    lines.extend(
        [
            "# HELP vhb_job_duration_seconds_total Cumulative terminal job duration.",
            "# TYPE vhb_job_duration_seconds_total counter",
        ]
    )
    for (job_type, terminal_status), duration_total in sorted(job_duration_seconds.items()):
        lines.append(
            "vhb_job_duration_seconds_total"
            f'{{type="{_label(job_type)}",status="{_label(terminal_status)}"}} {duration_total:.6f}'
        )
    lines.extend(
        [
            "# HELP vhb_job_queue_age_seconds_total Cumulative queue age when claimed.",
            "# TYPE vhb_job_queue_age_seconds_total counter",
        ]
    )
    for job_type, queue_age_total in sorted(job_queue_age_seconds.items()):
        lines.append(
            f'vhb_job_queue_age_seconds_total{{type="{_label(job_type)}"}} {queue_age_total:.6f}'
        )
    lines.extend(
        [
            "# HELP vhb_job_progress_updates_total Durable progress updates.",
            "# TYPE vhb_job_progress_updates_total counter",
        ]
    )
    for job_type, progress_count in sorted(job_progress_updates.items()):
        lines.append(
            f'vhb_job_progress_updates_total{{type="{_label(job_type)}"}} {progress_count}'
        )
    lines.extend(
        [
            "# HELP vhb_job_backlog Current queued and running jobs.",
            "# TYPE vhb_job_backlog gauge",
            "# HELP vhb_job_oldest_age_seconds Age of the oldest queued or running job.",
            "# TYPE vhb_job_oldest_age_seconds gauge",
        ]
    )
    for item in job_snapshot or []:
        labels = (
            f'type="{_label(item["type"])}",status="{_label(item["status"])}"'
        )
        lines.append(f'vhb_job_backlog{{{labels}}} {item["count"]}')
        lines.append(
            f'vhb_job_oldest_age_seconds{{{labels}}} '
            f'{float(item["oldest_age_seconds"]):.6f}'
        )
    return "\n".join(lines) + "\n"
