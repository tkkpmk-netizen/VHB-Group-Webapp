"""RFC 9457-style application Problem Details."""

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class ProblemDetailsError(Exception):
    """A safe, typed API error whose machine fields do not depend on prose."""

    def __init__(
        self,
        *,
        status: int,
        code: str,
        title: str,
        detail: str,
        problem_type: str,
        extra: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.title = title
        self.detail = detail
        self.problem_type = problem_type
        self.extra = extra or {}

    def payload(self, *, request_id: str) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "type": self.problem_type,
            "title": self.title,
            "status": self.status,
            "detail": self.detail,
            "code": self.code,
            "request_id": request_id,
        }
        payload.update(self.extra)
        conflict = payload.get("conflict")
        if isinstance(conflict, dict):
            conflict["request_id"] = request_id
        return payload


async def problem_details_handler(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    if not isinstance(exc, ProblemDetailsError):
        raise exc
    request_id = getattr(request.state, "request_id", None) or request.headers.get(
        "X-Request-ID", "unknown"
    )
    return JSONResponse(
        status_code=exc.status,
        content=exc.payload(request_id=request_id),
        media_type="application/problem+json",
        headers={"X-Request-ID": request_id},
    )
