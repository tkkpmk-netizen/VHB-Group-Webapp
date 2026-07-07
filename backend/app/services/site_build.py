"""DP5 site build helpers.

The build step turns editor source into deployable artifacts. It deliberately
does not mutate `SitePage.content`; source and published output remain separate.
"""

# ruff: noqa: E501

from __future__ import annotations

import html
import json
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset, AssetStatus
from app.models.site import (
    Site,
    SiteDataBinding,
    SiteDeployment,
    SiteDeploymentStatus,
    SitePage,
)
from app.services.storage import ObjectStorage


def _escape_attr(value: object) -> str:
    return html.escape(str(value), quote=True)


def _escape_text(value: object) -> str:
    return html.escape(str(value), quote=False)


def _style_dict_to_css(style: object) -> str:
    if not isinstance(style, dict):
        return ""
    parts = []
    for key, value in style.items():
        if isinstance(key, str) and isinstance(value, (str, int, float)):
            parts.append(f"{key}:{value}")
    return ";".join(parts)


def _component_to_html(component: object) -> str:
    """Best-effort static serialization for GrapesJS component trees."""
    if isinstance(component, str):
        return _escape_text(component)
    if not isinstance(component, dict):
        return ""
    tag = str(component.get("tagName") or component.get("type") or "div")
    if tag in {"text", "textnode"}:
        return _escape_text(component.get("content") or "")
    if not tag.replace("-", "").isalnum():
        tag = "div"

    attrs = dict(component.get("attributes") or {})
    classes = component.get("classes")
    if classes and "class" not in attrs:
        if isinstance(classes, list):
            class_names = []
            for item in classes:
                if isinstance(item, str):
                    class_names.append(item)
                elif isinstance(item, dict) and item.get("name"):
                    class_names.append(str(item["name"]))
            if class_names:
                attrs["class"] = " ".join(class_names)
        elif isinstance(classes, str):
            attrs["class"] = classes
    inline_style = _style_dict_to_css(component.get("style"))
    if inline_style:
        attrs["style"] = inline_style
    clean_attrs = " ".join(
        f'{key}="{_escape_attr(value)}"'
        for key, value in attrs.items()
        if isinstance(key, str) and not key.lower().startswith("on")
    )
    open_tag = f"<{tag}{(' ' + clean_attrs) if clean_attrs else ''}>"
    children = component.get("components")
    if isinstance(children, list):
        body = "".join(_component_to_html(child) for child in children)
    else:
        body = _escape_text(component.get("content") or "")
    if tag.lower() in {"area", "br", "col", "embed", "hr", "img", "input", "source"}:
        return open_tag
    return f"{open_tag}{body}</{tag}>"


def _project_to_html(project: dict[str, Any], page_index: int = 0) -> str:
    pages = project.get("pages")
    if not isinstance(pages, list) or not pages:
        return ""
    selected = pages[min(page_index, len(pages) - 1)]
    if not isinstance(selected, dict):
        return ""
    frames = selected.get("frames")
    if not isinstance(frames, list) or not frames:
        return ""
    frame = frames[0]
    if not isinstance(frame, dict):
        return ""
    return _component_to_html(frame.get("component"))


def _page_html(page: SitePage) -> str:
    content = page.content or {}
    html_source = content.get("html")
    if isinstance(html_source, str) and html_source.strip():
        return html_source
    project = content.get("project")
    if isinstance(project, dict):
        html_from_project = _project_to_html(project)
        if html_from_project.strip():
            return html_from_project
    return (
        '<main class="vhb-page">'
        f"<section><h1>{_escape_text(page.title)}</h1>"
        "<p>This page has no buildable source yet.</p></section>"
        "</main>"
    )


def _page_css(page: SitePage) -> str:
    content = page.content or {}
    css = content.get("css")
    return css if isinstance(css, str) else ""


def _json_for_script(value: object) -> str:
    return json.dumps(value, ensure_ascii=False).replace("</", "<\\/")


def render_site_artifact(
    *,
    site: Site,
    pages: list[SitePage],
    bindings: list[SiteDataBinding],
    deployment_id: uuid.UUID,
) -> bytes:
    page_payload = [
        {
            "title": page.title,
            "path": page.path,
            "html": _page_html(page),
            "css": _page_css(page),
        }
        for page in pages
        if page.is_published
    ]
    binding_payload = [
        {
            "key": binding.key,
            "name": binding.name,
            "page_id": str(binding.page_id) if binding.page_id else None,
        }
        for binding in bindings
        if binding.expose_public
    ]
    initial_css = "\n".join(page["css"] for page in page_payload if page["css"])
    html_doc = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{_escape_text(site.name)}</title>
  <style>
    :root {{ font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #292d34; }}
    body {{ margin: 0; background: #f7f8fa; }}
    a {{ color: inherit; }}
    .vhb-runtime-missing {{ margin: 48px auto; max-width: 720px; border-radius: 18px; background: #fff; padding: 32px; box-shadow: 0 16px 48px rgba(31,90,166,.12); }}
    .vhb-runtime-card {{ border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; padding: 14px; }}
    .vhb-runtime-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }}
    {initial_css}
  </style>
</head>
<body>
  <div id="vhb-site-root"></div>
  <script type="application/json" id="vhb-site-pages">{_json_for_script(page_payload)}</script>
  <script type="application/json" id="vhb-site-bindings">{_json_for_script(binding_payload)}</script>
  <script>
    (() => {{
      const siteSlug = {_json_for_script(site.slug)};
      const homepagePath = {_json_for_script(site.homepage_path)};
      const deploymentId = {_json_for_script(str(deployment_id))};
      const pages = JSON.parse(document.getElementById("vhb-site-pages").textContent || "[]");
      const normalize = (value) => {{
        const path = "/" + String(value || "").replace(/^\\/+|\\/+$/g, "");
        return path === "/" ? "/" : path;
      }};
      const current = normalize(location.pathname.replace(new RegExp("^/public/sites/" + siteSlug + "/render"), "") || homepagePath);
      const page = pages.find((item) => normalize(item.path) === current) || pages.find((item) => normalize(item.path) === normalize(homepagePath)) || pages[0];
      const root = document.getElementById("vhb-site-root");
      if (!page) {{
        root.innerHTML = '<main class="vhb-runtime-missing"><h1>No published page</h1><p>This site has no buildable published pages.</p></main>';
        return;
      }}
      document.title = page.title;
      root.innerHTML = page.html;
      const style = document.createElement("style");
      style.textContent = page.css || "";
      document.head.appendChild(style);
      document.querySelectorAll("[data-vhb-binding]").forEach(async (node) => {{
        const key = node.getAttribute("data-vhb-binding");
        if (!key) return;
        node.setAttribute("data-vhb-deployment", deploymentId);
        try {{
          const response = await fetch(`/public/sites/${{siteSlug}}/bindings/${{key}}`);
          if (!response.ok) throw new Error(`Binding ${{key}} failed`);
          const payload = await response.json();
          const rows = payload?.data?.items || [];
          node.innerHTML = '<div class="vhb-runtime-grid">' + rows.map((row) => {{
            const data = row.data || {{}};
            const fields = Object.entries(data).map(([fieldId, value]) => `<div><small>${{fieldId}}</small><strong>${{value ?? ""}}</strong></div>`).join("");
            return `<article class="vhb-runtime-card">${{fields || "<em>No public fields</em>"}}</article>`;
          }}).join("") + '</div>';
        }} catch (error) {{
          node.innerHTML = '<div class="vhb-runtime-card"><strong>Data unavailable</strong></div>';
        }}
      }});
    }})();
  </script>
</body>
</html>
"""
    return html_doc.encode("utf-8")


async def build_site_deployment(
    db: AsyncSession,
    *,
    deployment: SiteDeployment,
    storage: ObjectStorage,
) -> dict[str, Any]:
    site = await db.get(Site, deployment.site_id)
    if site is None or site.workspace_id != deployment.workspace_id:
        raise ValueError("Site not found")
    deployment.status = SiteDeploymentStatus.building
    deployment.error = None
    await db.commit()

    pages = list(
        (
            await db.execute(
                select(SitePage)
                .where(SitePage.site_id == site.id, SitePage.is_published.is_(True))
                .order_by(SitePage.order, SitePage.created_at)
            )
        ).scalars()
    )
    if not pages:
        raise ValueError("Site has no published pages to build")
    bindings = list(
        (
            await db.execute(
                select(SiteDataBinding)
                .where(SiteDataBinding.site_id == site.id, SiteDataBinding.expose_public.is_(True))
                .order_by(SiteDataBinding.order, SiteDataBinding.created_at)
            )
        ).scalars()
    )
    artifact = render_site_artifact(
        site=site,
        pages=pages,
        bindings=bindings,
        deployment_id=deployment.id,
    )
    filename = f"{site.slug}-v{deployment.version}.html"
    object_key = f"workspaces/{deployment.workspace_id}/sites/{site.id}/deployments/{deployment.id}/{filename}"
    await storage.put_bytes(object_key, artifact, content_type="text/html; charset=utf-8")
    asset = Asset(
        workspace_id=deployment.workspace_id,
        created_by_id=deployment.created_by_id,
        object_key=object_key,
        filename=filename,
        content_type="text/html; charset=utf-8",
        size_bytes=len(artifact),
        status=AssetStatus.ready,
    )
    db.add(asset)
    await db.flush()
    deployment.asset_id = asset.id
    deployment.status = SiteDeploymentStatus.ready
    existing_active = list(
        (
            await db.execute(
                select(SiteDeployment).where(
                    SiteDeployment.site_id == site.id,
                    SiteDeployment.environment == deployment.environment,
                    SiteDeployment.active.is_(True),
                )
            )
        ).scalars()
    )
    for existing in existing_active:
        existing.active = False
    deployment.active = True
    deployment.entry_path = site.homepage_path
    deployment.manifest = {
        "site_id": str(site.id),
        "slug": site.slug,
        "environment": deployment.environment.value,
        "pages": [{"id": str(page.id), "title": page.title, "path": page.path} for page in pages],
        "bindings": [binding.key for binding in bindings],
        "asset_id": str(asset.id),
        "object_key": object_key,
    }
    await db.commit()
    return {
        "deployment_id": str(deployment.id),
        "asset_id": str(asset.id),
        "pages_built": len(pages),
        "bindings": [binding.key for binding in bindings],
    }


async def next_site_deployment_version(db: AsyncSession, site_id: uuid.UUID) -> int:
    current = await db.scalar(
        select(func.coalesce(func.max(SiteDeployment.version), 0)).where(
            SiteDeployment.site_id == site_id
        )
    )
    return int(current or 0) + 1
