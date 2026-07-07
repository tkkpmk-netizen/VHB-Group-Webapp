"""Site designer source helpers."""

import re
from datetime import UTC, datetime
from typing import Any

_DANGEROUS_TAG_RE = re.compile(
    r"<\s*(script|iframe|object|embed|link|meta)\b[^>]*>.*?<\s*/\s*\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
_SELF_CLOSING_DANGEROUS_TAG_RE = re.compile(
    r"<\s*(script|iframe|object|embed|link|meta)\b[^>]*\/?\s*>",
    re.IGNORECASE,
)
_EVENT_HANDLER_ATTR_RE = re.compile(
    r"\s+on[a-zA-Z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)",
    re.IGNORECASE,
)
_JAVASCRIPT_URL_RE = re.compile(r"javascript\s*:", re.IGNORECASE)
_CSS_DANGEROUS_RE = re.compile(
    r"(@import\b|expression\s*\(|javascript\s*:)",
    re.IGNORECASE,
)


def default_grapesjs_content(title: str = "Home") -> dict[str, Any]:
    """Create a GrapesJS-compatible project envelope for a site page.

    DP3 treats SitePage.content as editor source, not generated HTML. The first
    save from GrapesJS replaces `project` with `editor.getProjectData()`.
    """
    return {
        "type": "grapesjs",
        "version": "dp3-mvp",
        "project": {"assets": [], "styles": [], "pages": []},
        "html": (
            '<main class="vhb-page">'
            '<section class="hero">'
            f"<h1>{title}</h1>"
            "<p>Design this page with the VHB Web Designer.</p>"
            '<a class="button" href="#">Call to action</a>'
            "</section>"
            "</main>"
        ),
        "css": (
            "body{margin:0;font-family:Inter,Arial,sans-serif;color:#292d34;}"
            ".vhb-page{min-height:100vh;background:#f7f8fa;padding:48px;}"
            ".hero{max-width:960px;margin:0 auto;border-radius:24px;"
            "background:#fff;padding:64px;box-shadow:0 20px 60px rgba(31,90,166,.12);}"
            ".hero h1{font-size:56px;line-height:1;margin:0 0 16px;}"
            ".hero p{font-size:18px;color:#6b7078;margin:0 0 24px;}"
            ".button{display:inline-block;border-radius:10px;background:#0b8ff3;"
            "color:#fff;text-decoration:none;padding:12px 18px;font-weight:700;}"
        ),
    }


def sanitize_imported_html(html: str) -> str:
    """Remove browser-executable constructs from imported design HTML.

    DP4 accepts exported/pasted local artifacts from tools such as Penpot,
    Figma plugins, or static HTML generators. This sanitizer is intentionally
    conservative for the source-import boundary: imported pages are design
    source, not trusted application code.
    """
    clean = _DANGEROUS_TAG_RE.sub("", html)
    clean = _SELF_CLOSING_DANGEROUS_TAG_RE.sub("", clean)
    clean = _EVENT_HANDLER_ATTR_RE.sub("", clean)
    clean = _JAVASCRIPT_URL_RE.sub("#", clean)
    return clean.strip()


def sanitize_imported_css(css: str | None) -> str:
    if not css:
        return ""
    return _CSS_DANGEROUS_RE.sub("", css).strip()


def imported_grapesjs_content(
    *,
    source_type: str,
    page_title: str,
    html: str | None = None,
    css: str | None = None,
    project: dict[str, Any] | None = None,
    source_name: str | None = None,
) -> dict[str, Any]:
    """Normalize a DP4 design import into the SitePage.content envelope."""
    imported_at = datetime.now(UTC).isoformat()
    meta = {
        "imported_at": imported_at,
        "import_source": source_type,
        "source_name": source_name,
    }
    if project is not None:
        return {
            "type": "grapesjs",
            "version": "dp4-import",
            "project": project,
            "meta": meta,
        }

    safe_html = sanitize_imported_html(html or "")
    if not safe_html:
        raise ValueError("Imported design must include HTML or a GrapesJS project")
    return {
        "type": "grapesjs",
        "version": "dp4-import",
        "project": {"assets": [], "styles": [], "pages": []},
        "html": safe_html,
        "css": sanitize_imported_css(css),
        "meta": {
            **meta,
            "fallback_title": page_title,
        },
    }
