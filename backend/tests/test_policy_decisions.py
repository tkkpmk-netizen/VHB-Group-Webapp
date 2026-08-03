"""T1 policy contract and inference-path security prototypes."""

from uuid import UUID, uuid4

import pytest

from app.services.policy_decisions import (
    SELECTED_POLICY_ARCHITECTURE,
    AttributeKind,
    AttributeTarget,
    PolicyDeniedError,
    PolicyOperation,
    PolicySubject,
    Sensitivity,
    TypedAttributeRule,
    TypedPolicyDecisionService,
    UnifiedPolicyPrototype,
    UnifiedPrototypeRule,
    authorize_derived_attribute,
    authorize_file_access,
    authorize_query_references,
    authorize_relation_search,
    project_authorized_attributes,
)


def _subject(workspace_id: UUID, role: str = "viewer") -> PolicySubject:
    return PolicySubject(
        user_id=uuid4(),
        workspace_id=workspace_id,
        role=role,
        capabilities=frozenset({"commercial.pricing.read"}),
    )


def _target(
    workspace_id: UUID,
    key: str,
    *,
    kind: AttributeKind = AttributeKind.typed,
    sensitivity: Sensitivity = Sensitivity.confidential,
    resource_type: str = "pricing_dataset",
) -> AttributeTarget:
    return AttributeTarget(
        workspace_id=workspace_id,
        kind=kind,
        resource_type=resource_type,
        resource_id=uuid4(),
        attribute_key=key,
        sensitivity=sensitivity,
    )


def _pricing_service() -> TypedPolicyDecisionService:
    return TypedPolicyDecisionService(
        [
            TypedAttributeRule(
                resource_type="pricing_dataset",
                attribute_key="supplier_cost",
                sensitivity=Sensitivity.confidential,
                operations_by_role={
                    "owner": frozenset(PolicyOperation),
                    "viewer": frozenset({PolicyOperation.read}),
                },
                required_capabilities=frozenset({"commercial.pricing.read"}),
            ),
            TypedAttributeRule(
                resource_type="customer_file",
                attribute_key="contract",
                sensitivity=Sensitivity.restricted,
                operations_by_role={
                    "owner": frozenset(
                        {
                            PolicyOperation.file_preview,
                            PolicyOperation.file_download,
                        }
                    ),
                    "viewer": frozenset({PolicyOperation.file_preview}),
                },
            ),
        ]
    )


@pytest.mark.asyncio
async def test_typed_contract_denies_protected_dynamic_attributes() -> None:
    workspace_id = uuid4()
    service = _pricing_service()
    subject = _subject(workspace_id)
    protected_dynamic = _target(
        workspace_id,
        str(uuid4()),
        kind=AttributeKind.dynamic,
        sensitivity=Sensitivity.confidential,
        resource_type="database",
    )
    decision = await service.decide(
        subject=subject,
        target=protected_dynamic,
        operation=PolicyOperation.read,
    )
    assert decision.allowed is False
    assert decision.reason_code == "DYNAMIC_SENSITIVE_ATTRIBUTE_UNSUPPORTED"
    assert {item.value for item in decision.obligations} == {
        "audit",
        "no_inference",
        "omit",
    }

    cross_workspace = await service.decide(
        subject=subject,
        target=_target(uuid4(), "supplier_cost"),
        operation=PolicyOperation.read,
    )
    assert cross_workspace.allowed is False
    assert cross_workspace.reason_code == "POLICY_CROSS_WORKSPACE"


@pytest.mark.asyncio
async def test_query_reference_denial_happens_before_query_construction() -> None:
    workspace_id = uuid4()
    target = _target(workspace_id, "supplier_cost")
    query_built = False
    with pytest.raises(PolicyDeniedError) as captured:
        await authorize_query_references(
            _pricing_service(),
            subject=_subject(workspace_id),
            references={
                PolicyOperation.search: [target],
                PolicyOperation.filter: [target],
                PolicyOperation.sort: [target],
            },
        )
        query_built = True
    assert query_built is False
    assert captured.value.reason_code == "POLICY_OPERATION_DENIED"


@pytest.mark.asyncio
async def test_export_projection_omits_denied_attributes() -> None:
    workspace_id = uuid4()
    cost = _target(workspace_id, "supplier_cost")
    name = _target(
        workspace_id,
        "product_name",
        sensitivity=Sensitivity.public,
    )
    projected = await project_authorized_attributes(
        _pricing_service(),
        subject=_subject(workspace_id),
        operation=PolicyOperation.export,
        values={"supplier_cost": "10.00", "product_name": "Coffee"},
        targets={"supplier_cost": cost, "product_name": name},
    )
    assert projected == {"product_name": "Coffee"}


@pytest.mark.asyncio
async def test_derived_output_inherits_most_restrictive_dependency() -> None:
    workspace_id = uuid4()
    output = _target(
        workspace_id,
        "margin_band",
        sensitivity=Sensitivity.public,
    )
    dependency = _target(workspace_id, "supplier_cost")
    with pytest.raises(PolicyDeniedError):
        await authorize_derived_attribute(
            _pricing_service(),
            subject=_subject(workspace_id, "owner"),
            output=output,
            dependencies=[dependency],
            operation=PolicyOperation.formula,
        )


@pytest.mark.asyncio
async def test_relation_search_cannot_leak_denied_display_attribute() -> None:
    workspace_id = uuid4()
    relation = _target(
        workspace_id,
        "supplier_relation",
        sensitivity=Sensitivity.public,
    )
    display = _target(workspace_id, "supplier_cost")
    with pytest.raises(PolicyDeniedError) as captured:
        await authorize_relation_search(
            _pricing_service(),
            subject=_subject(workspace_id),
            relation_attribute=relation,
            display_attribute=display,
        )
    assert captured.value.operation is PolicyOperation.search


@pytest.mark.asyncio
async def test_file_preview_and_download_are_distinct_operations() -> None:
    workspace_id = uuid4()
    target = _target(
        workspace_id,
        "contract",
        resource_type="customer_file",
        sensitivity=Sensitivity.restricted,
    )
    await authorize_file_access(
        _pricing_service(),
        subject=_subject(workspace_id),
        file_attribute=target,
        download=False,
    )
    with pytest.raises(PolicyDeniedError):
        await authorize_file_access(
            _pricing_service(),
            subject=_subject(workspace_id),
            file_attribute=target,
            download=True,
        )


@pytest.mark.asyncio
async def test_unified_spike_proves_target_model_but_is_not_selected() -> None:
    workspace_id = uuid4()
    target = _target(
        workspace_id,
        str(uuid4()),
        kind=AttributeKind.dynamic,
        resource_type="database",
    )
    service = UnifiedPolicyPrototype(
        [
            UnifiedPrototypeRule(
                kind=target.kind,
                resource_type=target.resource_type,
                attribute_key=target.attribute_key,
                allowed_roles=frozenset({"owner"}),
                allowed_operations=frozenset({PolicyOperation.read}),
            )
        ]
    )
    assert (
        await service.decide(
            subject=_subject(workspace_id, "owner"),
            target=target,
            operation=PolicyOperation.read,
        )
    ).allowed
    assert SELECTED_POLICY_ARCHITECTURE == "typed-commercial-explicit-datasets"
