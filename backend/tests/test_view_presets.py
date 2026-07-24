"""ViewPreset CRUD, layout apply-via-PATCH, and delete-fallback tests."""

import httpx
import pytest


async def _setup(client: httpx.AsyncClient, email: str = "vp@example.com") -> tuple[dict, str, str]:
    r = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "VP"},
    )
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/databases", json={"name": "Pipeline"}, headers=headers)
    db_id = r.json()["id"]
    layout = (await client.get(f"/databases/{db_id}/layouts", headers=headers)).json()[0]
    return headers, db_id, layout["id"]


@pytest.mark.asyncio
async def test_view_preset_crud(client: httpx.AsyncClient) -> None:
    headers, _, layout_id = await _setup(client)

    created = await client.post(
        f"/layouts/{layout_id}/view-presets",
        json={
            "name": "Urgent only",
            "filter": {"conj": "and", "rules": [{"field_id": "status", "value": "urgent"}]},
            "sorts": [{"field_id": "seq", "direction": "asc"}],
            "group_field_id": "status",
            "hide_empty": True,
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    preset = created.json()
    assert preset["name"] == "Urgent only"
    assert preset["hide_empty"] is True

    listed = await client.get(f"/layouts/{layout_id}/view-presets", headers=headers)
    assert len(listed.json()) == 1

    renamed = await client.patch(
        f"/view-presets/{preset['id']}", json={"name": "Urgent (renamed)"}, headers=headers
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Urgent (renamed)"

    deleted = await client.delete(f"/view-presets/{preset['id']}", headers=headers)
    assert deleted.status_code == 204
    listed_after = await client.get(f"/layouts/{layout_id}/view-presets", headers=headers)
    assert listed_after.json() == []


@pytest.mark.asyncio
async def test_apply_and_clear_active_preset_via_layout_patch(
    client: httpx.AsyncClient,
) -> None:
    headers, _, layout_id = await _setup(client)
    preset = await client.post(
        f"/layouts/{layout_id}/view-presets",
        json={"name": "Preset A"},
        headers=headers,
    )
    preset_id = preset.json()["id"]

    applied = await client.patch(
        f"/layouts/{layout_id}",
        json={"active_view_preset_id": preset_id},
        headers=headers,
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["active_view_preset_id"] == preset_id

    # Explicitly clearing to null must actually clear it (model_fields_set,
    # not "is not None" — omitting the key entirely must NOT clear it).
    untouched = await client.patch(f"/layouts/{layout_id}", json={"name": "Same"}, headers=headers)
    assert untouched.json()["active_view_preset_id"] == preset_id

    cleared = await client.patch(
        f"/layouts/{layout_id}",
        json={"active_view_preset_id": None},
        headers=headers,
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["active_view_preset_id"] is None


@pytest.mark.asyncio
async def test_apply_preset_from_another_layout_rejected(client: httpx.AsyncClient) -> None:
    headers, _, layout_id = await _setup(client)
    other_db = await client.post("/databases", json={"name": "Other"}, headers=headers)
    other_layout = (
        await client.get(f"/databases/{other_db.json()['id']}/layouts", headers=headers)
    ).json()[0]
    foreign_preset = await client.post(
        f"/layouts/{other_layout['id']}/view-presets",
        json={"name": "Foreign"},
        headers=headers,
    )

    r = await client.patch(
        f"/layouts/{layout_id}",
        json={"active_view_preset_id": foreign_preset.json()["id"]},
        headers=headers,
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_deleting_active_preset_falls_back_to_none(client: httpx.AsyncClient) -> None:
    headers, db_id, layout_id = await _setup(client)
    preset = await client.post(
        f"/layouts/{layout_id}/view-presets", json={"name": "Only preset"}, headers=headers
    )
    preset_id = preset.json()["id"]
    await client.patch(
        f"/layouts/{layout_id}", json={"active_view_preset_id": preset_id}, headers=headers
    )

    deleted = await client.delete(f"/view-presets/{preset_id}", headers=headers)
    assert deleted.status_code == 204

    refreshed = await client.get(f"/databases/{db_id}/layouts", headers=headers)
    assert refreshed.json()[0]["active_view_preset_id"] is None


@pytest.mark.asyncio
async def test_view_presets_isolated_per_workspace(client: httpx.AsyncClient) -> None:
    headers_a, _, layout_a = await _setup(client, "vpa@example.com")
    headers_b, _, _ = await _setup(client, "vpb@example.com")
    r = await client.get(f"/layouts/{layout_a}/view-presets", headers=headers_b)
    assert r.status_code == 404
