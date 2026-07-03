"""Modular-monolith composition invariants."""

from app.modules import MODULES, all_routers


def test_module_names_and_routers_are_unique() -> None:
    names = [module.name for module in MODULES]
    routers = list(all_routers())
    assert len(names) == len(set(names))
    assert len(routers) == len({id(router) for router in routers})


def test_module_resource_ownership_is_unique() -> None:
    resources = [resource for module in MODULES for resource in module.owns]
    assert len(resources) == len(set(resources))
