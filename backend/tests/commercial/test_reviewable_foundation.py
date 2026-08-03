"""End-to-end API coverage for the UI Reviewable Foundation actions."""

import httpx
import pytest


async def _signup(client: httpx.AsyncClient, email: str) -> tuple[str, str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "Foundation Owner"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    workspace_id = (
        await client.get("/workspaces", headers={"Authorization": f"Bearer {token}"})
    ).json()[0]["id"]
    return token, workspace_id


def _headers(token: str, workspace_id: str, key: str | None = None) -> dict[str, str]:
    result = {"Authorization": f"Bearer {token}", "X-Workspace-ID": workspace_id}
    if key:
        result["Idempotency-Key"] = key
    return result


@pytest.mark.asyncio
async def test_quality_detail_remap_and_reconciliation(client: httpx.AsyncClient) -> None:
    token, workspace_id = await _signup(client, "reviewable-quality@example.com")
    headers = _headers(token, workspace_id, "stage-reviewable")
    staged = await client.post(
        "/commercial/quality/batches",
        headers=headers,
        json={
            "source_key": "ui-review",
            "source_label": "UI review batch",
            "priority_cohort": True,
            "rows": [
                {
                    "source_locator": "UI!1",
                    "raw_values": {"Product": "Coffee old name"},
                    "record_type": "product",
                    "normalized_values": {"name": "Coffee"},
                    "mapping_confidence": 70,
                }
            ],
        },
    )
    assert staged.status_code == 201, staged.text
    candidate = (
        await client.get("/commercial/quality/summary", headers=_headers(token, workspace_id))
    ).json()["exceptions"][0]
    detail = await client.get(
        f"/commercial/quality/candidates/{candidate['id']}",
        headers=_headers(token, workspace_id),
    )
    assert detail.status_code == 200
    assert detail.json()["raw_values"]["Product"] == "Coffee old name"

    remapped = await client.post(
        f"/commercial/quality/candidates/{candidate['id']}/remap",
        headers=_headers(token, workspace_id, "remap-reviewable"),
        json={
            "expected_version": candidate["version"],
            "normalized_values": {"name": "Coffee corrected"},
            "mapping_confidence": 96,
            "review_notes": "Corrected in review UI",
        },
    )
    assert remapped.status_code == 200, remapped.text
    assert remapped.json()["normalized_values"]["name"] == "Coffee corrected"
    reconciliation = await client.get(
        "/commercial/quality/reconciliation", headers=_headers(token, workspace_id)
    )
    assert reconciliation.status_code == 200
    assert reconciliation.json()[0]["states"]["pending"] == 1


@pytest.mark.asyncio
async def test_master_profiles_and_pricing_decisions(client: httpx.AsyncClient) -> None:
    token, workspace_id = await _signup(client, "reviewable-master@example.com")
    product = await client.post(
        "/commercial/products",
        headers=_headers(token, workspace_id, "create-product"),
        json={
            "sku": "VHB-COF-01",
            "name": "Vietnam Coffee",
            "base_unit": "CTN",
            "origin_country": "VN",
        },
    )
    assert product.status_code == 201, product.text
    product_id = product.json()["id"]
    supplier = await client.post(
        "/commercial/suppliers",
        headers=_headers(token, workspace_id, "create-supplier"),
        json={"name": "Vietnam Coffee Supplier", "supplier_code": "SUP-01", "country": "VN"},
    )
    assert supplier.status_code == 201, supplier.text

    customer = await client.post(
        "/commercial/customers",
        headers=_headers(token, workspace_id, "create-customer"),
        json={"name": "Ava Trading"},
    )
    assert customer.status_code == 201, customer.text
    customer_id = customer.json()["id"]
    party = await client.post(
        f"/commercial/customers/{customer_id}/legal-parties",
        headers=_headers(token, workspace_id),
        json={"legal_name": "Ava Trading LLC", "tax_identifier": "AVA-001", "country": "US"},
    )
    assert party.status_code == 201, party.text
    contact = await client.post(
        f"/commercial/customers/{customer_id}/contacts",
        headers=_headers(token, workspace_id),
        json={"full_name": "Ava Buyer", "email": "buyer@ava.test", "consent": True},
    )
    assert contact.status_code == 201, contact.text
    address = await client.post(
        f"/commercial/customers/{customer_id}/addresses",
        headers=_headers(token, workspace_id),
        json={
            "label": "Warehouse",
            "line_1": "100 Buyer Street",
            "country": "US",
            "is_default": True,
        },
    )
    assert address.status_code == 201, address.text
    profile = await client.get(
        f"/commercial/customers/{customer_id}/profile",
        headers=_headers(token, workspace_id),
    )
    assert profile.status_code == 200
    assert len(profile.json()["legal_parties"]) == 1
    assert len(profile.json()["contacts"]) == 1
    assert len(profile.json()["addresses"]) == 1

    fx = await client.post(
        "/commercial/pricing/fx",
        headers=_headers(token, workspace_id, "create-fx"),
        json={
            "base_currency": "USD",
            "quote_currency": "VND",
            "rate": "25000",
            "effective_start": "2026-08-03T00:00:00Z",
        },
    )
    assert fx.status_code == 201, fx.text
    price = await client.post(
        "/commercial/pricing/versions",
        headers=_headers(token, workspace_id, "create-price"),
        json={
            "product_id": product_id,
            "currency": "USD",
            "input_cost": "10",
            "fx_rate": "1",
            "logistics_cost": "1",
            "tax_cost": "0",
            "margin_percent": "15",
            "effective_start": "2026-08-03T00:00:00Z",
            "incoterm": "FOB",
        },
    )
    assert price.status_code == 201, price.text
    approved = await client.post(
        f"/commercial/pricing/versions/{price.json()['id']}/approve",
        headers=_headers(token, workspace_id, "approve-oral"),
        json={
            "expected_version": price.json()["version"],
            "approved_price": price.json()["proposed_price"],
            "approval_note": "Approved orally",
            "oral_pending": True,
        },
    )
    assert approved.status_code == 200, approved.text
    confirmed = await client.post(
        f"/commercial/pricing/versions/{price.json()['id']}/oral-decision",
        headers=_headers(token, workspace_id, "confirm-oral"),
        json={
            "expected_version": approved.json()["version"],
            "decision": "confirm",
            "note": "Reconfirmed with management",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "approved"


@pytest.mark.asyncio
async def test_catalog_mini_apps_provision_dynamic_databases_idempotently(
    client: httpx.AsyncClient,
) -> None:
    token, workspace_id = await _signup(client, "catalog-database@example.com")
    request_headers = _headers(token, workspace_id)

    created_ids: set[str] = set()
    expected_fields = {
        "products": {
            "ID",
            "Name",
            "SKU",
            "Base unit",
            "Origin country",
            "Barcode",
            "CBM",
            "Lifecycle",
        },
        "customers": {
            "ID",
            "Name",
            "Email",
            "Phone",
            "Country",
            "Website",
            "Sales PIC",
            "Lifecycle",
        },
        "suppliers": {
            "ID",
            "Name",
            "Supplier code",
            "Country",
            "Email",
            "Phone",
            "Website",
            "Lifecycle",
        },
    }
    for kind, field_names in expected_fields.items():
        created = await client.post(f"/commercial/catalogs/{kind}/ensure", headers=request_headers)
        assert created.status_code == 200, created.text
        assert created.json()["created"] is True
        database_id = created.json()["database_id"]
        created_ids.add(database_id)

        replay = await client.post(f"/commercial/catalogs/{kind}/ensure", headers=request_headers)
        assert replay.status_code == 200
        assert replay.json()["created"] is False
        assert replay.json()["database_id"] == database_id

        fields = await client.get(f"/databases/{database_id}/fields", headers=request_headers)
        assert fields.status_code == 200, fields.text
        assert {item["name"] for item in fields.json()} == field_names
        lifecycle = next(item for item in fields.json() if item["name"] == "Lifecycle")
        assert [choice["id"] for choice in lifecycle["options"]["choices"]] == [
            "not_started",
            "active",
            "on_hold",
            "retired",
        ]

        layouts = await client.get(f"/databases/{database_id}/layouts", headers=request_headers)
        assert layouts.status_code == 200, layouts.text
        assert layouts.json()[0]["type"] == "table"

        sources = await client.get(
            f"/databases/{database_id}/data-sources", headers=request_headers
        )
        assert sources.status_code == 200, sources.text
        assert sources.json()[0]["is_primary"] is True

    assert len(created_ids) == 3
