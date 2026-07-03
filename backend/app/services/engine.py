"""Per-field-type value validation/coercion + Notion-like formula evaluation."""

import math
import re
from datetime import date, datetime, timedelta
from typing import Any

from asteval import Interpreter  # type: ignore[import-untyped]

from app.models.field import Field, FieldType

# --- Notion-like formula function library -----------------------------------

_UNITS = {
    "days": "days",
    "weeks": "weeks",
    "months": "months",
    "years": "years",
    "hours": "hours",
    "minutes": "minutes",
}


def _to_dt(v: Any) -> datetime | None:
    if isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day)
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v)
        except ValueError:
            return None
    return None


def _date_add(d: Any, n: float, unit: str) -> str | None:
    dt = _to_dt(d)
    if dt is None:
        return None
    n = int(n)
    if unit == "weeks":
        dt += timedelta(weeks=n)
    elif unit == "days":
        dt += timedelta(days=n)
    elif unit == "hours":
        dt += timedelta(hours=n)
    elif unit == "minutes":
        dt += timedelta(minutes=n)
    elif unit == "months":
        m = dt.month - 1 + n
        dt = dt.replace(year=dt.year + m // 12, month=m % 12 + 1)
    elif unit == "years":
        dt = dt.replace(year=dt.year + n)
    return dt.isoformat()


def _date_between(a: Any, b: Any, unit: str) -> float | None:
    da, db = _to_dt(a), _to_dt(b)
    if da is None or db is None:
        return None
    delta = da - db
    secs = delta.total_seconds()
    return {
        "days": secs / 86400,
        "hours": secs / 3600,
        "minutes": secs / 60,
        "weeks": secs / 604800,
    }.get(unit, secs / 86400) // 1


def _date_part(d: Any, attr: str) -> int | None:
    dt = _to_dt(d)
    return getattr(dt, attr) if dt is not None else None


def _to_number(x: Any) -> float | None:
    if isinstance(x, bool):
        return 1 if x else 0
    if isinstance(x, int | float):
        return x
    try:
        return float(str(x))
    except (ValueError, TypeError):
        return None


def _flatten(args: tuple[Any, ...]) -> list[Any]:
    out: list[Any] = []
    for a in args:
        out.extend(a) if isinstance(a, list) else out.append(a)
    return out


FORMULA_FUNCS: dict[str, Any] = {
    # logic (if/and/or/not are reserved → exposed as _if/_and/_or/_not)
    "_if": lambda c, a, b: a if c else b,
    "_and": lambda *a: all(a),
    "_or": lambda *a: any(a),
    "_not": lambda x: not x,
    "empty": lambda x: x in (None, "", [], {}),
    # math
    "round": lambda x, n=0: round(x, int(n)) if x is not None else None,
    "abs": lambda x: abs(x) if x is not None else None,
    "ceil": lambda x: math.ceil(x) if x is not None else None,
    "floor": lambda x: math.floor(x) if x is not None else None,
    "sqrt": lambda x: math.sqrt(x) if x is not None and x >= 0 else None,
    "pow": lambda a, b: a**b,
    "mod": lambda a, b: a % b if b else None,
    "min": lambda *a: min([x for x in _flatten(a) if x is not None], default=None),
    "max": lambda *a: max([x for x in _flatten(a) if x is not None], default=None),
    "sum": lambda *a: sum(
        x for x in _flatten(a) if isinstance(x, int | float) and not isinstance(x, bool)
    ),
    "toNumber": _to_number,
    # string
    "concat": lambda *a: "".join(str(x) for x in a if x is not None),
    "join": lambda sep, *a: str(sep).join(str(x) for x in _flatten(a) if x is not None),
    "length": lambda x: len(x) if x is not None else 0,
    "substring": lambda s, a, b=None: (
        str(s)[int(a) : (int(b) if b is not None else None)] if s is not None else ""
    ),
    "replace": lambda s, o, n: str(s).replace(str(o), str(n)) if s is not None else "",
    "contains": lambda s, sub: (str(sub) in str(s)) if s is not None else False,
    "lower": lambda s: str(s).lower() if s is not None else "",
    "upper": lambda s: str(s).upper() if s is not None else "",
    "trim": lambda s: str(s).strip() if s is not None else "",
    "format": lambda x: "" if x is None else str(x),
    # date
    "now": lambda: datetime.now().isoformat(timespec="minutes"),
    "today": lambda: date.today().isoformat(),
    "dateAdd": _date_add,
    "dateSubtract": lambda d, n, unit: _date_add(d, -n, unit),
    "dateBetween": _date_between,
    "year": lambda d: _date_part(d, "year"),
    "month": lambda d: _date_part(d, "month"),
    "day": lambda d: _date_part(d, "day"),
    "hour": lambda d: _date_part(d, "hour"),
    "minute": lambda d: _date_part(d, "minute"),
}

# Map reserved-word call syntax (Notion-style) to safe function names.
_RESERVED_CALL = re.compile(r"\b(if|and|or|not)\s*\(")


def evaluate_formula(expression: str, value_lookup: dict[str, Any]) -> Any:
    """Evaluate a Notion-like formula in a sandbox (asteval).

    Fields are referenced via prop("Field Name"). asteval permits only a safe
    subset of Python — no imports, no dunder access, no file/network — so
    arbitrary code execution is not possible. Notion call-style if()/and()/or()/
    not() are rewritten to safe helpers before evaluation.
    """
    value, _ = check_formula(expression, value_lookup)
    return value


def check_formula(expression: str, value_lookup: dict[str, Any]) -> tuple[Any, str | None]:
    """Evaluate and also return a human-readable error (for the editor preview)."""
    expr = _RESERVED_CALL.sub(lambda m: f"_{m.group(1)}(", expression)
    interp = Interpreter()
    interp.symtable["prop"] = lambda name: value_lookup.get(name)
    for name, fn in FORMULA_FUNCS.items():
        interp.symtable[name] = fn
    try:
        result = interp(expr, show_errors=False)
    except Exception as exc:
        return None, str(exc)
    if interp.error:
        try:
            msg = interp.error[0].get_error()[1]
        except Exception:
            msg = "Invalid formula"
        interp.error = []
        return None, str(msg)
    if result is None or isinstance(result, str | bool | int | float | list):
        return result, None
    return str(result), None


class CellValidationError(ValueError):
    """Raised when a cell value doesn't match its field type."""


def _is_number(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool)


TEXT_LIKE = {
    FieldType.text,
    FieldType.long_text,
    FieldType.url,
    FieldType.phone,
    FieldType.country,
}
# select-like = single choice validated against options.choices
SELECT_LIKE = {FieldType.select, FieldType.status, FieldType.priority}


def _choice_ids(field: Field) -> set[str]:
    return {c.get("id") for c in field.options.get("choices", [])}


def validate_cell(field: Field, value: Any) -> Any:
    """Validate/normalize a single cell value for the given field. None is allowed."""
    if value is None or value == "":
        return None

    t = field.type

    if t in TEXT_LIKE:
        if not isinstance(value, str):
            raise CellValidationError(f"{field.name}: expected text")
        return value

    if t is FieldType.email:
        if not isinstance(value, str) or "@" not in value:
            raise CellValidationError(f"{field.name}: invalid email")
        return value

    if t is FieldType.number:
        if not _is_number(value):
            raise CellValidationError(f"{field.name}: expected number")
        return value

    if t is FieldType.rating:
        if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 5:
            raise CellValidationError(f"{field.name}: rating must be 1..5")
        return value

    if t is FieldType.checkbox:
        if not isinstance(value, bool):
            raise CellValidationError(f"{field.name}: expected boolean")
        return value

    if t is FieldType.date:

        def _check_iso(s: str) -> None:
            try:
                datetime.fromisoformat(s)  # accepts date or datetime
            except ValueError as exc:
                raise CellValidationError(f"{field.name}: invalid date") from exc

        # Per-cell range object: {"start": iso, "end": iso|None}
        if isinstance(value, dict):
            start = value.get("start")
            if not start:
                return None
            _check_iso(str(start))
            end = value.get("end")
            if end:
                _check_iso(str(end))
            return {"start": start, "end": end or None}
        if isinstance(value, str):
            _check_iso(value)
            return value
        raise CellValidationError(f"{field.name}: expected ISO date string")

    if t in SELECT_LIKE:
        if value not in _choice_ids(field):
            raise CellValidationError(f"{field.name}: not a valid option")
        return value

    if t is FieldType.multi_select:
        if not isinstance(value, list):
            raise CellValidationError(f"{field.name}: expected a list")
        valid = _choice_ids(field)
        if any(v not in valid for v in value):
            raise CellValidationError(f"{field.name}: contains invalid option")
        return value

    if t is FieldType.people:
        if not isinstance(value, list):
            raise CellValidationError(f"{field.name}: expected a list of user ids")
        return [str(v) for v in value]

    if t is FieldType.progress:
        if not _is_number(value):
            raise CellValidationError(f"{field.name}: expected number")
        return max(0, min(100, value))

    # Reserved types (relation, …) — not editable yet.
    raise CellValidationError(f"{field.name}: field type not supported yet")


def validate_row_data(fields: list[Field], data: dict[str, Any]) -> dict[str, Any]:
    """Validate a partial cell map (keyed by field id) against known fields."""
    by_id = {str(f.id): f for f in fields}
    cleaned: dict[str, Any] = {}
    for field_id, value in data.items():
        field = by_id.get(field_id)
        if field is None:
            raise CellValidationError(f"Unknown field: {field_id}")
        cleaned[field_id] = validate_cell(field, value)
    return cleaned
