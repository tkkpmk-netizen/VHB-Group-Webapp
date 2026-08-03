from decimal import Decimal

import pytest

from app.modules.commercial.pricing.service import cost_plus_margin


def test_cost_plus_margin_uses_decimal_and_named_rounding() -> None:
    assert cost_plus_margin(
        input_cost=Decimal("10.1234"),
        fx_rate=Decimal("1.2"),
        logistics_cost=Decimal("0.10"),
        tax_cost=Decimal("0"),
        margin_percent=Decimal("12.5"),
    ) == Decimal("13.7791")


def test_cost_plus_margin_rejects_invalid_inputs() -> None:
    with pytest.raises(ValueError):
        cost_plus_margin(
            input_cost=Decimal("0"),
            fx_rate=Decimal("1"),
            logistics_cost=Decimal("0"),
            tax_cost=Decimal("0"),
            margin_percent=Decimal("0"),
        )
