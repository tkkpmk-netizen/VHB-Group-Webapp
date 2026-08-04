"""T5/T6 inquiry-to-release and payment allocation acceptance coverage."""

import httpx
import pytest


async def _signup(client: httpx.AsyncClient) -> tuple[str, str]:
    response = await client.post(
        "/auth/signup",
        json={
            "email": "order-management@example.com",
            "password": "supersecret1",
            "full_name": "Order Manager",
        },
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


async def _master_entity(
    client: httpx.AsyncClient,
    token: str,
    workspace_id: str,
    kind: str,
    name: str,
) -> dict[str, object]:
    headers = _headers(token, workspace_id)
    catalog = await client.post(f"/commercial/catalogs/{kind}/ensure", headers=headers)
    assert catalog.status_code == 200, catalog.text
    entity = await client.post(
        f"/databases/{catalog.json()['database_id']}/entities",
        headers=headers,
        json={"name": name, "data": {}},
    )
    assert entity.status_code == 201, entity.text
    return entity.json()


async def _accepted_quote(
    client: httpx.AsyncClient,
    token: str,
    workspace_id: str,
    suffix: str,
) -> dict[str, object]:
    customer = await _master_entity(
        client, token, workspace_id, "customers", f"Customer {suffix}"
    )
    product = await _master_entity(
        client, token, workspace_id, "products", f"Vietnam Coffee {suffix}"
    )
    supplier = await _master_entity(
        client, token, workspace_id, "suppliers", f"Supplier {suffix}"
    )
    inquiry = await client.post(
        "/commercial/order-management/inquiries",
        headers=_headers(token, workspace_id, f"inquiry-{suffix}"),
        json={
            "number": f"INQ-{suffix}",
            "title": f"Customer request {suffix}",
            "customer_entity_id": customer["id"],
            "supplier_entity_ids": [supplier["id"]],
            "product_requests": [
                {
                    "mode": "catalog",
                    "product_entity_id": product["id"],
                    "quantity": "10",
                    "unit": "CTN",
                },
                {
                    "mode": "manual",
                    "manual_description": f"Provisional item {suffix}",
                    "quantity": "1",
                    "unit": "CTN",
                },
            ],
            "source": "Alibaba",
            "requested_at": "2026-08-04T01:00:00Z",
        },
    )
    assert inquiry.status_code == 201, inquiry.text
    if suffix == "A":
        manual_quote = await client.post(
            "/commercial/order-management/quotations",
            headers=_headers(token, workspace_id, "quote-manual-blocked"),
            json={
                "inquiry_id": inquiry.json()["id"],
                "number": "QT-MANUAL-BLOCKED",
                "currency": "USD",
                "issue_date": "2026-08-04",
                "legal_profile": "VIHABA",
                "lines": [
                    {
                        "product_entity_id": product["id"],
                        "sku": "FREE-TEXT",
                        "product_name": "Manual product is not allowed",
                        "quantity": "1",
                        "unit": "CTN",
                        "unit_price": "10",
                    }
                ],
            },
        )
        assert manual_quote.status_code == 422, manual_quote.text
        wrong_catalog = await client.post(
            "/commercial/order-management/quotations",
            headers=_headers(token, workspace_id, "quote-wrong-catalog"),
            json={
                "inquiry_id": inquiry.json()["id"],
                "number": "QT-WRONG-CATALOG",
                "currency": "USD",
                "issue_date": "2026-08-04",
                "legal_profile": "VIHABA",
                "lines": [
                    {
                        "product_entity_id": customer["id"],
                        "quantity": "1",
                        "unit": "CTN",
                        "unit_price": "10",
                    }
                ],
            },
        )
        assert wrong_catalog.status_code == 422, wrong_catalog.text
    quote = await client.post(
        "/commercial/order-management/quotations",
        headers=_headers(token, workspace_id, f"quote-{suffix}"),
        json={
            "inquiry_id": inquiry.json()["id"],
            "number": f"QT-{suffix}",
            "currency": "USD",
            "issue_date": "2026-08-04",
            "legal_profile": "VIHABA",
            "lines": [
                {
                    "product_entity_id": product["id"],
                    "supplier_entity_id": supplier["id"],
                    "quantity": "10",
                    "unit": "CTN",
                    "unit_price": "10",
                }
            ],
        },
    )
    assert quote.status_code == 201, quote.text
    version = quote.json()["latest"]
    for index, state in enumerate(("internally_approved", "sent", "accepted")):
        transitioned = await client.post(
            f"/commercial/order-management/quotation-versions/{version['id']}/transition",
            headers=_headers(token, workspace_id, f"transition-{suffix}-{index}"),
            json={"status": state},
        )
        assert transitioned.status_code == 200, transitioned.text
        version = transitioned.json()
    version["test_supplier_id"] = supplier["id"]
    return version


@pytest.mark.asyncio
async def test_t5_t6_acceptance_evidence_multi_order_allocation_and_reversal(
    client: httpx.AsyncClient,
) -> None:
    token, workspace_id = await _signup(client)
    quote_a = await _accepted_quote(client, token, workspace_id, "A")
    quote_b = await _accepted_quote(client, token, workspace_id, "B")

    for suffix, quote in (("A", quote_a), ("B", quote_b)):
        evidence = await client.post(
            "/commercial/order-management/evidence",
            headers=_headers(token, workspace_id, f"evidence-{suffix}"),
            json={
                "record_type": "quotation_version",
                "record_id": quote["id"],
                "evidence_type": "customer_po",
                "source_key": f"email-message-{suffix}",
                "subject": f"Accepted order {suffix}",
                "sender": "buyer@example.com",
                "recipient": "sale@vhb.com",
                "occurred_at": "2026-08-04T02:00:00Z",
            },
        )
        assert evidence.status_code == 201, evidence.text

    profile = await client.post(
        "/commercial/order-management/requirement-profiles",
        headers=_headers(token, workspace_id, "profile"),
        json={
            "name": "Vihaba export PO",
            "legal_profile": "VIHABA",
            "transaction_type": "export",
            "required_evidence_types": ["customer_po"],
        },
    )
    assert profile.status_code == 201, profile.text
    terms = await client.post(
        "/commercial/order-management/payment-terms",
        headers=_headers(token, workspace_id, "terms"),
        json={
            "name": "50 percent deposit",
            "payment_method": "bank_transfer",
            "currency": "USD",
            "milestones": [
                {
                    "id": "deposit",
                    "label": "Deposit",
                    "percentage": "50",
                    "due_rule": "on_acceptance",
                    "release_gate": True,
                },
                {
                    "id": "balance",
                    "label": "Balance",
                    "percentage": "50",
                    "due_rule": "before_documents",
                    "release_gate": False,
                },
            ],
        },
    )
    assert terms.status_code == 201, terms.text

    orders = []
    for suffix, quote in (("A", quote_a), ("B", quote_b)):
        order = await client.post(
            "/commercial/order-management/orders",
            headers=_headers(token, workspace_id, f"order-{suffix}"),
            json={
                "number": f"SO-{suffix}",
                "quotation_version_id": quote["id"],
                "requirement_profile_id": profile.json()["id"],
                "payment_terms_id": terms.json()["id"],
                "supplier_entity_ids": [quote["test_supplier_id"]],
            },
        )
        assert order.status_code == 201, order.text
        orders.append(order.json())

    receipt = await client.post(
        "/commercial/order-management/receipts",
        headers=_headers(token, workspace_id, "receipt"),
        json={
            "bank_reference": "BANK-001",
            "amount": "100",
            "currency": "USD",
            "value_date": "2026-08-04",
            "receiving_account": "Vihaba USD",
        },
    )
    assert receipt.status_code == 201, receipt.text
    confirmed = await client.post(
        f"/commercial/order-management/receipts/{receipt.json()['id']}/confirm",
        headers=_headers(token, workspace_id, "confirm-receipt"),
        json={"expected_version": receipt.json()["version"]},
    )
    assert confirmed.status_code == 200, confirmed.text

    allocations = []
    for index, order in enumerate(orders):
        allocation = await client.post(
            "/commercial/order-management/allocations",
            headers=_headers(token, workspace_id, f"allocation-{index}"),
            json={
                "receipt_id": receipt.json()["id"],
                "sales_order_id": order["id"],
                "milestone_id": "deposit",
                "amount": "50",
            },
        )
        assert allocation.status_code == 201, allocation.text
        allocations.append(allocation.json())

    released = await client.post(
        f"/commercial/order-management/orders/{orders[0]['id']}/release",
        headers=_headers(token, workspace_id, "release-a"),
        json={"expected_version": orders[0]["version"]},
    )
    assert released.status_code == 200, released.text
    assert released.json()["status"] == "released_to_procurement"

    reversed_allocation = await client.post(
        f"/commercial/order-management/allocations/{allocations[1]['id']}/reverse",
        headers=_headers(token, workspace_id, "reverse-b"),
        json={"reason": "Applied to the wrong order"},
    )
    assert reversed_allocation.status_code == 201, reversed_allocation.text
    assert reversed_allocation.json()["amount"] == "-50.0000"
    history = await client.get(
        "/commercial/order-management/allocations",
        headers=_headers(token, workspace_id),
    )
    assert history.status_code == 200, history.text
    assert len(history.json()) == 3
    assert next(item for item in history.json() if item["id"] == allocations[1]["id"])[
        "reversed"
    ] is True

    blocked = await client.post(
        f"/commercial/order-management/orders/{orders[1]['id']}/release",
        headers=_headers(token, workspace_id, "release-b"),
        json={"expected_version": orders[1]["version"]},
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["code"] == "COMMERCIAL_RELEASE_PAYMENT_MISSING"
