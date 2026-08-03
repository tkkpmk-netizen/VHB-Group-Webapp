from decimal import ROUND_HALF_UP, Decimal

MONEY_QUANTUM = Decimal("0.0001")


def cost_plus_margin(
    *,
    input_cost: Decimal,
    fx_rate: Decimal,
    logistics_cost: Decimal,
    tax_cost: Decimal,
    margin_percent: Decimal,
) -> Decimal:
    """Approved T4 strategy; binary floats and arbitrary formulas are excluded."""
    if input_cost <= 0 or fx_rate <= 0 or min(logistics_cost, tax_cost, margin_percent) < 0:
        raise ValueError("Pricing inputs must be positive costs/rates and non-negative components")
    cost = input_cost * fx_rate + logistics_cost + tax_cost
    return (cost * (Decimal("1") + margin_percent / Decimal("100"))).quantize(
        MONEY_QUANTUM, rounding=ROUND_HALF_UP
    )
