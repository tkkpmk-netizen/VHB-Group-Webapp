"""DP1-DP4 site domain, designer import, and public runtime tests."""

import httpx
import pytest


async def _register(client: httpx.AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "DP"},
    )
    token = response.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    workspace = (await client.get("/workspaces", headers=auth)).json()[0]
    return {**auth, "X-Workspace-ID": workspace["id"]}


@pytest.mark.asyncio
async def test_public_runtime_serves_only_published_site_and_selected_fields(
    client: httpx.AsyncClient,
) -> None:
    headers = await _register(client, "dp-public@example.com")
    database = await client.post("/databases", json={"name": "Products"}, headers=headers)
    database_id = database.json()["id"]
    public_field = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Product", "type": "text", "options": {}},
        headers=headers,
    )
    hidden_field = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Margin", "type": "number", "options": {}},
        headers=headers,
    )
    await client.post(
        f"/databases/{database_id}/rows",
        json={
            "data": {
                public_field.json()["id"]: "Coconut water",
                hidden_field.json()["id"]: 42,
            }
        },
        headers=headers,
    )

    site = await client.post(
        "/sites",
        json={"name": "Catalog", "slug": "vhb-catalog"},
        headers=headers,
    )
    assert site.status_code == 201, site.text
    site_id = site.json()["id"]
    page = (await client.get(f"/sites/{site_id}/pages", headers=headers)).json()[0]
    assert page["content"]["type"] == "grapesjs"
    binding = await client.post(
        f"/sites/{site_id}/bindings",
        json={
            "database_id": database_id,
            "page_id": page["id"],
            "key": "products",
            "name": "Products",
            "field_ids": [public_field.json()["id"]],
            "query": {"page": 1, "page_size": 10},
        },
        headers=headers,
    )
    assert binding.status_code == 201, binding.text

    assert (await client.get("/public/sites/vhb-catalog")).status_code == 404
    published = await client.patch(
        f"/sites/{site_id}",
        json={"published": True},
        headers=headers,
    )
    assert published.status_code == 200, published.text

    manifest = await client.get("/public/sites/vhb-catalog")
    assert manifest.status_code == 200, manifest.text
    assert manifest.json()["pages"][0]["path"] == "/"

    page_payload = await client.get("/public/sites/vhb-catalog/pages")
    assert page_payload.status_code == 200, page_payload.text
    assert page_payload.json()["bindings"][0]["key"] == "products"

    data = await client.get("/public/sites/vhb-catalog/bindings/products")
    assert data.status_code == 200, data.text
    row_data = data.json()["data"]["items"][0]["data"]
    assert row_data == {public_field.json()["id"]: "Coconut water"}
    assert hidden_field.json()["id"] not in row_data


@pytest.mark.asyncio
async def test_site_reuses_generic_resource_grants(client: httpx.AsyncClient) -> None:
    owner_headers = await _register(client, "dp-owner@example.com")
    viewer_headers = await _register(client, "dp-viewer@example.com")
    workspace_id = owner_headers["X-Workspace-ID"]
    member = await client.post(
        "/workspaces/me/members",
        json={"email": "dp-viewer@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    site = await client.post(
        "/sites",
        json={"name": "Partner portal", "slug": "partner-portal"},
        headers=owner_headers,
    )
    site_id = site.json()["id"]

    denied = await client.patch(
        f"/sites/{site_id}",
        json={"description": "Denied"},
        headers={
            "Authorization": viewer_headers["Authorization"],
            "X-Workspace-ID": workspace_id,
        },
    )
    assert denied.status_code == 403

    grant = await client.put(
        f"/resource-grants/site/{site_id}",
        json={"user_id": member.json()["id"], "role": "editor"},
        headers=owner_headers,
    )
    assert grant.status_code == 200, grant.text

    allowed = await client.patch(
        f"/sites/{site_id}",
        json={"description": "Viewer can edit"},
        headers={
            "Authorization": viewer_headers["Authorization"],
            "X-Workspace-ID": workspace_id,
        },
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["description"] == "Viewer can edit"


@pytest.mark.asyncio
async def test_site_page_design_import_normalizes_artifact(
    client: httpx.AsyncClient,
) -> None:
    headers = await _register(client, "dp-import@example.com")
    site = await client.post(
        "/sites",
        json={"name": "Import target", "slug": "import-target"},
        headers=headers,
    )
    site_id = site.json()["id"]
    page = (await client.get(f"/sites/{site_id}/pages", headers=headers)).json()[0]

    imported = await client.post(
        f"/site-pages/{page['id']}/import-design",
        json={
            "source_type": "figma-html",
            "source_name": "landing-export.html",
            "html": (
                '<main onclick="alert(1)">'
                "<script>alert(1)</script>"
                '<a href="javascript:alert(1)">CTA</a>'
                "<h1>Imported landing</h1>"
                "</main>"
            ),
            "css": ".card{color:red} @import url('https://bad.example/style.css')",
        },
        headers=headers,
    )

    assert imported.status_code == 200, imported.text
    content = imported.json()["content"]
    assert content["type"] == "grapesjs"
    assert content["version"] == "dp4-import"
    assert content["meta"]["import_source"] == "figma-html"
    assert content["meta"]["source_name"] == "landing-export.html"
    assert "Imported landing" in content["html"]
    assert "script" not in content["html"].lower()
    assert "onclick" not in content["html"].lower()
    assert "javascript:" not in content["html"].lower()
    assert "@import" not in content["css"].lower()


@pytest.mark.asyncio
async def test_site_page_design_import_accepts_grapesjs_project(
    client: httpx.AsyncClient,
) -> None:
    headers = await _register(client, "dp-project-import@example.com")
    site = await client.post(
        "/sites",
        json={"name": "Project import", "slug": "project-import"},
        headers=headers,
    )
    site_id = site.json()["id"]
    page = (await client.get(f"/sites/{site_id}/pages", headers=headers)).json()[0]

    imported = await client.post(
        f"/site-pages/{page['id']}/import-design",
        json={
            "source_type": "grapesjs-project",
            "source_name": "designer-project.json",
            "project": {"assets": [], "styles": [], "pages": [{"id": "home"}]},
        },
        headers=headers,
    )

    assert imported.status_code == 200, imported.text
    content = imported.json()["content"]
    assert content["type"] == "grapesjs"
    assert content["version"] == "dp4-import"
    assert content["project"]["pages"] == [{"id": "home"}]
