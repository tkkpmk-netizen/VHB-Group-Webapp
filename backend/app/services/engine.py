"""Per-field-type value validation/coercion for row cells."""

from datetime import date
from typing import Any

from app.models.field import Field, FieldType


class CellValidationError(ValueError):
    """Raised when a cell value doesn't match its field type."""


def _is_number(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool)


TEXT_LIKE = {FieldType.text, FieldType.long_text, FieldType.url, FieldType.phone}
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
        if not isinstance(value, str):
            raise CellValidationError(f"{field.name}: expected ISO date string")
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise CellValidationError(f"{field.name}: invalid date") from exc
        return value

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
