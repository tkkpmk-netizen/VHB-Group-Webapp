"""DP1-DP4 site domain, designer import, and public runtime tests."""

from collections.abc import AsyncGenerator

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.main import app
from app.models.job import JobStatus
from app.services.jobs import claim_next_job, complete_job
from app.services.storage import get_object_storage
from app.worker import execute_job


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def presign_upload(self, key: str, content_type: str, expires_seconds: int) -> str:
        return f"https://storage.test/upload/{key}?type={content_type}"

    async def presign_download(self, key: str, filename: str, expires_seconds: int) -> str:
        return f"https://storage.test/download/{key}?filename={filename}"

    async def object_size(self, key: str) -> int:
        return len(self.objects[key])

    async def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    async def get_bytes(self, key: str) -> bytes:
        return self.objects[key]

    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = data


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


@pytest.mark.asyncio
async def test_site_build_domain_and_rollback_flow(
    client: httpx.AsyncClient,
) -> None:
    storage = FakeStorage()
    app.dependency_overrides[get_object_storage] = lambda: storage
    headers = await _register(client, "dp-build@example.com")
    site = await client.post(
        "/sites",
        json={"name": "Buildable", "slug": "buildable"},
        headers=headers,
    )
    site_id = site.json()["id"]
    page = (await client.get(f"/sites/{site_id}/pages", headers=headers)).json()[0]

    async def run_next_site_build(expected_job_id: str) -> None:
        override = app.dependency_overrides[get_db]
        generator: AsyncGenerator[AsyncSession] = override()
        session = await anext(generator)
        try:
            job = await claim_next_job(session, worker_id="site-build-test", lease_seconds=60)
            assert job is not None
            assert str(job.id) == expected_job_id
            assert job.type == "site.build"
            result = await execute_job(session, job, storage)
            await complete_job(session, job, result)
        finally:
            await generator.aclose()

    updated = await client.patch(
        f"/site-pages/{page['id']}",
        json={
            "content": {
                "type": "grapesjs",
                "version": "test",
                "project": {"assets": [], "styles": [], "pages": []},
                "html": (
                    '<main><h1>Built v1</h1><section data-vhb-binding="items"></section></main>'
                ),
                "css": "main{padding:24px}",
            }
        },
        headers=headers,
    )
    assert updated.status_code == 200, updated.text

    queued = await client.post(f"/sites/{site_id}/deployments", headers=headers)
    assert queued.status_code == 202, queued.text
    deployment_v1_id = queued.json()["deployment"]["id"]
    job_v1_id = queued.json()["job"]["id"]
    await run_next_site_build(job_v1_id)

    deployments = await client.get(f"/sites/{site_id}/deployments", headers=headers)
    assert deployments.status_code == 200, deployments.text
    deployment = deployments.json()[0]
    assert deployment["id"] == deployment_v1_id
    assert deployment["status"] == "ready"
    assert deployment["environment"] == "production"
    assert deployment["active"] is True
    assert deployment["asset_id"]
    assert len(storage.objects) == 1

    assert (await client.get("/public/sites/buildable/render")).status_code == 404
    await client.patch(f"/sites/{site_id}", json={"published": True}, headers=headers)
    rendered = await client.get("/public/sites/buildable/render")
    assert rendered.status_code == 200, rendered.text
    assert rendered.headers["x-vhb-deployment-id"] == deployment_v1_id
    assert "Built v1" in rendered.text
    completed = await client.get(f"/jobs/{job_v1_id}", headers=headers)
    assert completed.json()["status"] == JobStatus.succeeded

    domain = await client.post(
        f"/sites/{site_id}/domains",
        json={
            "hostname": "landing.example.com",
            "environment": "production",
            "verified": True,
            "primary": True,
        },
        headers=headers,
    )
    assert domain.status_code == 201, domain.text
    domain_rendered = await client.get("/public/domains/landing.example.com/render")
    assert domain_rendered.status_code == 200, domain_rendered.text
    assert domain_rendered.headers["x-vhb-domain"] == "landing.example.com"
    assert "Built v1" in domain_rendered.text

    await client.patch(
        f"/site-pages/{page['id']}",
        json={
            "content": {
                "type": "grapesjs",
                "version": "test",
                "project": {"assets": [], "styles": [], "pages": []},
                "html": "<main><h1>Built v2</h1></main>",
                "css": "main{padding:32px}",
            }
        },
        headers=headers,
    )
    queued_v2 = await client.post(f"/sites/{site_id}/deployments", headers=headers)
    assert queued_v2.status_code == 202, queued_v2.text
    deployment_v2_id = queued_v2.json()["deployment"]["id"]
    await run_next_site_build(queued_v2.json()["job"]["id"])
    rendered_v2 = await client.get("/public/sites/buildable/render")
    assert rendered_v2.headers["x-vhb-deployment-id"] == deployment_v2_id
    assert "Built v2" in rendered_v2.text

    rollback = await client.post(
        f"/site-deployments/{deployment_v1_id}/promote",
        headers=headers,
    )
    assert rollback.status_code == 200, rollback.text
    assert rollback.json()["active"] is True
    rendered_rollback = await client.get("/public/sites/buildable/render")
    assert rendered_rollback.headers["x-vhb-deployment-id"] == deployment_v1_id
    assert "Built v1" in rendered_rollback.text
