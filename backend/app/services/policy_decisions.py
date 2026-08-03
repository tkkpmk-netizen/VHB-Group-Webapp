"""Stable attribute-policy contract and bounded T1 security adapters."""

import enum
import uuid
from dataclasses import dataclass
from typing import Any, Protocol


class PolicyOperation(enum.StrEnum):
    read = "read"
    write = "write"
    export = "export"
    search = "search"
    filter = "filter"
    sort = "sort"
    group = "group"
    aggregate = "aggregate"
    formula = "formula"
    rollup = "rollup"
    relation = "relation"
    dashboard = "dashboard"
    notification = "notification"
    public_binding = "public_binding"
    report = "report"
    projection = "projection"
    file_preview = "file_preview"
    file_download = "file_download"


class AttributeKind(enum.StrEnum):
    dynamic = "dynamic"
    typed = "typed"


class Sensitivity(enum.IntEnum):
    public = 0
    internal = 1
    confidential = 2
    restricted = 3


class PolicyObligation(enum.StrEnum):
    omit = "omit"
    no_inference = "no_inference"
    audit = "audit"


@dataclass(frozen=True)
class PolicySubject:
    user_id: uuid.UUID
    workspace_id: uuid.UUID
    role: str
    capabilities: frozenset[str] = frozenset()


@dataclass(frozen=True)
class AttributeTarget:
    workspace_id: uuid.UUID
    kind: AttributeKind
    resource_type: str
    resource_id: uuid.UUID
    attribute_key: str
    sensitivity: Sensitivity = Sensitivity.public

    @property
    def policy_key(self) -> tuple[str, str]:
        return self.resource_type, self.attribute_key


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    reason_code: str
    obligations: frozenset[PolicyObligation] = frozenset()
    policy_version: int = 1


@dataclass(frozen=True)
class TypedAttributeRule:
    resource_type: str
    attribute_key: str
    sensitivity: Sensitivity
    operations_by_role: dict[str, frozenset[PolicyOperation]]
    required_capabilities: frozenset[str] = frozenset()


class PolicyDecisionService(Protocol):
    async def decide(
        self,
        *,
        subject: PolicySubject,
        target: AttributeTarget,
        operation: PolicyOperation,
    ) -> PolicyDecision: ...


class PolicyDeniedError(Exception):
    def __init__(self, operation: PolicyOperation, reason_code: str) -> None:
        super().__init__(f"Policy denied {operation.value}")
        self.operation = operation
        self.reason_code = reason_code


def _denied(reason: str) -> PolicyDecision:
    return PolicyDecision(
        allowed=False,
        reason_code=reason,
        obligations=frozenset(
            {
                PolicyObligation.omit,
                PolicyObligation.no_inference,
                PolicyObligation.audit,
            }
        ),
    )


class TypedPolicyDecisionService:
    """Selected production adapter: explicit rules for typed sensitive data.

    Dynamic attributes remain resource-authorized and public within that
    resource. Marking a dynamic field protected is denied rather than claiming
    that every generic query and derived path is safely attribute-aware.
    """

    def __init__(self, rules: list[TypedAttributeRule] | None = None) -> None:
        self._rules = {
            (rule.resource_type, rule.attribute_key): rule for rule in (rules or [])
        }

    async def decide(
        self,
        *,
        subject: PolicySubject,
        target: AttributeTarget,
        operation: PolicyOperation,
    ) -> PolicyDecision:
        if target.workspace_id != subject.workspace_id:
            return _denied("POLICY_CROSS_WORKSPACE")
        if target.kind is AttributeKind.dynamic:
            if target.sensitivity is not Sensitivity.public:
                return _denied("DYNAMIC_SENSITIVE_ATTRIBUTE_UNSUPPORTED")
            return PolicyDecision(allowed=True, reason_code="RESOURCE_POLICY_REQUIRED")
        rule = self._rules.get(target.policy_key)
        if rule is None:
            if target.sensitivity is Sensitivity.public:
                return PolicyDecision(allowed=True, reason_code="PUBLIC_TYPED_ATTRIBUTE")
            return _denied("PROTECTED_ATTRIBUTE_DENY_BY_DEFAULT")
        allowed_operations = rule.operations_by_role.get(subject.role, frozenset())
        if not rule.required_capabilities.issubset(subject.capabilities):
            return _denied("POLICY_CAPABILITY_REQUIRED")
        if operation not in allowed_operations:
            return _denied("POLICY_OPERATION_DENIED")
        obligations = (
            frozenset({PolicyObligation.audit})
            if rule.sensitivity >= Sensitivity.confidential
            else frozenset()
        )
        return PolicyDecision(
            allowed=True,
            reason_code="TYPED_RULE_ALLOWED",
            obligations=obligations,
        )


@dataclass(frozen=True)
class UnifiedPrototypeRule:
    kind: AttributeKind
    resource_type: str
    attribute_key: str
    allowed_roles: frozenset[str]
    allowed_operations: frozenset[PolicyOperation]


class UnifiedPolicyPrototype:
    """Spike-only adapter used to test the unified target model.

    It is deliberately not wired as the production factory because doing so
    would require every generic query and serialization path to become policy
    aware before any protected dynamic Field could be accepted.
    """

    def __init__(self, rules: list[UnifiedPrototypeRule]) -> None:
        self._rules = {
            (rule.kind, rule.resource_type, rule.attribute_key): rule for rule in rules
        }

    async def decide(
        self,
        *,
        subject: PolicySubject,
        target: AttributeTarget,
        operation: PolicyOperation,
    ) -> PolicyDecision:
        if target.workspace_id != subject.workspace_id:
            return _denied("POLICY_CROSS_WORKSPACE")
        rule = self._rules.get((target.kind, target.resource_type, target.attribute_key))
        if rule is None:
            return _denied("UNIFIED_RULE_DENY_BY_DEFAULT")
        if subject.role not in rule.allowed_roles or operation not in rule.allowed_operations:
            return _denied("UNIFIED_RULE_DENIED")
        return PolicyDecision(
            allowed=True,
            reason_code="UNIFIED_RULE_ALLOWED",
            obligations=frozenset({PolicyObligation.audit}),
        )


async def require_policy(
    service: PolicyDecisionService,
    *,
    subject: PolicySubject,
    target: AttributeTarget,
    operation: PolicyOperation,
) -> PolicyDecision:
    decision = await service.decide(
        subject=subject,
        target=target,
        operation=operation,
    )
    if not decision.allowed:
        raise PolicyDeniedError(operation, decision.reason_code)
    return decision


async def authorize_query_references(
    service: PolicyDecisionService,
    *,
    subject: PolicySubject,
    references: dict[PolicyOperation, list[AttributeTarget]],
) -> None:
    """Authorize filters/search/sort/group/aggregate before building SQL."""
    for operation, targets in references.items():
        if operation not in {
            PolicyOperation.search,
            PolicyOperation.filter,
            PolicyOperation.sort,
            PolicyOperation.group,
            PolicyOperation.aggregate,
        }:
            raise ValueError("Unsupported query-reference operation")
        for target in targets:
            await require_policy(
                service,
                subject=subject,
                target=target,
                operation=operation,
            )


async def project_authorized_attributes(
    service: PolicyDecisionService,
    *,
    subject: PolicySubject,
    operation: PolicyOperation,
    values: dict[str, Any],
    targets: dict[str, AttributeTarget],
) -> dict[str, Any]:
    if operation not in {
        PolicyOperation.read,
        PolicyOperation.export,
        PolicyOperation.report,
        PolicyOperation.projection,
    }:
        raise ValueError("Unsupported projection operation")
    projected: dict[str, Any] = {}
    for key, value in values.items():
        target = targets.get(key)
        if target is None:
            continue
        decision = await service.decide(
            subject=subject,
            target=target,
            operation=operation,
        )
        if decision.allowed:
            projected[key] = value
    return projected


async def authorize_derived_attribute(
    service: PolicyDecisionService,
    *,
    subject: PolicySubject,
    output: AttributeTarget,
    dependencies: list[AttributeTarget],
    operation: PolicyOperation,
) -> AttributeTarget:
    if operation not in {
        PolicyOperation.formula,
        PolicyOperation.rollup,
        PolicyOperation.aggregate,
        PolicyOperation.dashboard,
        PolicyOperation.notification,
        PolicyOperation.public_binding,
    }:
        raise ValueError("Unsupported derived operation")
    inherited = max(
        [output.sensitivity, *(item.sensitivity for item in dependencies)],
        default=output.sensitivity,
    )
    inherited_output = AttributeTarget(
        workspace_id=output.workspace_id,
        kind=output.kind,
        resource_type=output.resource_type,
        resource_id=output.resource_id,
        attribute_key=output.attribute_key,
        sensitivity=Sensitivity(inherited),
    )
    for dependency in dependencies:
        await require_policy(
            service,
            subject=subject,
            target=dependency,
            operation=operation,
        )
    await require_policy(
        service,
        subject=subject,
        target=inherited_output,
        operation=operation,
    )
    return inherited_output


async def authorize_relation_search(
    service: PolicyDecisionService,
    *,
    subject: PolicySubject,
    relation_attribute: AttributeTarget,
    display_attribute: AttributeTarget,
) -> None:
    await require_policy(
        service,
        subject=subject,
        target=relation_attribute,
        operation=PolicyOperation.relation,
    )
    await require_policy(
        service,
        subject=subject,
        target=display_attribute,
        operation=PolicyOperation.search,
    )
    await require_policy(
        service,
        subject=subject,
        target=display_attribute,
        operation=PolicyOperation.read,
    )


async def authorize_file_access(
    service: PolicyDecisionService,
    *,
    subject: PolicySubject,
    file_attribute: AttributeTarget,
    download: bool,
) -> PolicyDecision:
    return await require_policy(
        service,
        subject=subject,
        target=file_attribute,
        operation=(
            PolicyOperation.file_download if download else PolicyOperation.file_preview
        ),
    )


SELECTED_POLICY_ARCHITECTURE = "typed-commercial-explicit-datasets"


def get_policy_decision_service(
    rules: list[TypedAttributeRule] | None = None,
) -> PolicyDecisionService:
    return TypedPolicyDecisionService(rules)
