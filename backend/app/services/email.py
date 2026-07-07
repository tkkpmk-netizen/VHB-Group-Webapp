"""SMTP email delivery for durable notification jobs."""

import asyncio
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings


async def send_email(*, recipient: str, subject: str, body: str) -> None:
    settings = get_settings()
    host = settings.smtp_host
    if not host:
        raise RuntimeError("SMTP is not configured")

    def _send() -> None:
        message = EmailMessage()
        message["From"] = settings.smtp_from_email
        message["To"] = recipient
        message["Subject"] = subject
        message.set_content(body)
        with smtplib.SMTP(host, settings.smtp_port, timeout=20) as client:
            if settings.smtp_use_tls:
                client.starttls()
            if settings.smtp_username and settings.smtp_password:
                client.login(settings.smtp_username, settings.smtp_password)
            client.send_message(message)

    await asyncio.to_thread(_send)
