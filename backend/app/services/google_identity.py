"""Google Identity Services ID-token verification."""

import asyncio
from typing import Any

from google.auth.transport import requests
from google.oauth2 import id_token

from app.core.config import get_settings


class GoogleIdentityError(Exception):
    pass


async def verify_google_credential(credential: str) -> dict[str, Any]:
    client_id = get_settings().google_client_id
    if not client_id:
        raise GoogleIdentityError("Google sign-in is not configured")
    try:
        claims = await asyncio.to_thread(
            id_token.verify_oauth2_token,
            credential,
            requests.Request(),
            client_id,
        )
    except ValueError as exc:
        raise GoogleIdentityError("Invalid Google credential") from exc
    if not claims.get("sub") or not claims.get("email") or not claims.get("email_verified"):
        raise GoogleIdentityError("Verified Google email required")
    return dict(claims)
