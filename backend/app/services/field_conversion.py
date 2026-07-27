"""Safe, previewable conversion of persisted dynamic field values."""

from __future__ import annotations

import json
import math
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.models.field import Entity, Field, FieldType

CONVERTIBLE_FIELD_TYPES = {
    FieldType.name,
    FieldType.text,
    FieldType.long_text,
    FieldType.number,
    FieldType.checkbox,
    FieldType.date,
    FieldType.url,
    FieldType.email,
    FieldType.phone,
    FieldType.select,
    FieldType.multi_select,
    FieldType.status,
    FieldType.priority,
    FieldType.rating,
    FieldType.country,
    FieldType.people,
    FieldType.progress,
}

_SINGLE_CHOICE_TYPES = {FieldType.select, FieldType.status, FieldType.priority}
_CHOICE_TYPES = _SINGLE_CHOICE_TYPES | {FieldType.multi_select}
_TEXT_TYPES = {
    FieldType.name,
    FieldType.text,
    FieldType.long_text,
    FieldType.url,
    FieldType.phone,
    FieldType.country,
}
_GENERIC_OPTION_KEYS = {
    "required",
    "edit_permission",
    "alignment",
    "wrap",
    "entity_doc_visible",
}
_TARGET_OPTION_KEYS: dict[FieldType, set[str]] = {
    FieldType.number: {"format", "currency_code", "precision", "unit_code"},
    FieldType.date: {"date_format"},
    FieldType.url: {"hyperlink"},
    FieldType.select: {"choices"},
    FieldType.multi_select: {"choices"},
    FieldType.status: {"choices", "groups"},
    FieldType.priority: {"choices", "groups"},
}
_CHOICE_COLORS = ("blue", "green", "purple", "orange", "pink", "teal", "yellow")
_MAX_INVALID_SAMPLES = 8


@dataclass(frozen=True)
class FieldConversionPlan:
    target_options: dict[str, Any]
    entity_data: dict[uuid.UUID, dict[str, Any]]
    total_cells: int
    converted_cells: int
    cleared_cells: int
    empty_cells: int
    generated_choices: int
    cleared_samples: list[str]
    invalid_entity_ids: list[uuid.UUID]
    invalid_reason_counts: dict[str, int]
    invalid_samples: list[dict[str, Any]]


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == []


def _source_value(field: Field, value: Any) -> Any:
    choices = {
        str(choice.get("id")): str(choice.get("label") or choice.get("id") or "")
        for choice in (field.options or {}).get("choices", [])
        if choice.get("id") is not None
    }
    if field.type in _SINGLE_CHOICE_TYPES:
        return choices.get(str(value), value)
    if field.type == FieldType.multi_select and isinstance(value, list):
        return [choices.get(str(item), item) for item in value]
    return value


def _as_text(value: Any) -> str | None:
    if isinstance(value, dict):
        start = value.get("start")
        end = value.get("end")
        if start and end:
            return f"{start} → {end}"
        return str(start) if start else None
    if isinstance(value, list):
        return ", ".join(str(item) for item in value if not _is_empty(item)) or None
    if isinstance(value, str | int | float | bool):
        return str(value)
    return None


def _as_number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return value if math.isfinite(float(value)) else None
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    # Keep one leading sign, digits and one decimal separator. Thousands
    # separators and surrounding currency/unit text are deliberately removed.
    first_digit = re.search(r"\d", normalized)
    sign = (
        "-"
        if (
            first_digit is not None
            and (
                "-" in normalized[: first_digit.start()]
                or (
                    normalized.lstrip().startswith("(")
                    and normalized.rstrip().endswith(")")
                )
            )
        )
        else ""
    )
    numeric = re.sub(r"[^0-9.,]", "", normalized)
    if not numeric:
        return None
    if "," in numeric and "." in numeric:
        # The right-most separator is the decimal separator; the other is grouping.
        decimal = "," if numeric.rfind(",") > numeric.rfind(".") else "."
        grouping = "." if decimal == "," else ","
        numeric = numeric.replace(grouping, "").replace(decimal, ".")
    elif "," in numeric:
        parts = numeric.split(",")
        numeric = (
            "".join(parts)
            if len(parts) > 2 or (len(parts) == 2 and len(parts[1]) == 3)
            else ".".join(parts)
        )
    elif numeric.count(".") > 1:
        parts = numeric.split(".")
        numeric = (
            "".join(parts)
            if all(len(part) == 3 for part in parts[1:])
            else "".join(parts[:-1]) + "." + parts[-1]
        )
    normalized = sign + numeric
    try:
        parsed = float(normalized)
    except ValueError:
        return None
    if not math.isfinite(parsed):
        return None
    return int(parsed) if parsed.is_integer() else parsed


def _valid_iso(value: str) -> bool:
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return False
    return True


def _choice_labels(value: Any) -> list[str]:
    values = value if isinstance(value, list) else [value]
    return [
        label
        for item in values
        if (label := _as_text(item)) is not None and label.strip()
    ]


def _normalize_choice(
    choice: dict[str, Any], index: int, target_type: FieldType
) -> dict[str, Any] | None:
    label = str(choice.get("label") or "").strip()
    if not label:
        return None
    normalized: dict[str, Any] = {
        "id": str(choice.get("id") or uuid.uuid4()),
        "label": label,
        "color": str(choice.get("color") or _CHOICE_COLORS[index % len(_CHOICE_COLORS)]),
    }
    if target_type in {FieldType.status, FieldType.priority}:
        normalized["group"] = str(choice.get("group") or "not_started")
    return normalized


def _target_options(
    field: Field,
    target_type: FieldType,
    requested_options: dict[str, Any],
    source_values: list[Any],
) -> tuple[dict[str, Any], int]:
    old_options = field.options or {}
    options = {
        key: old_options[key]
        for key in _GENERIC_OPTION_KEYS
        if key in old_options
    }
    allowed = _TARGET_OPTION_KEYS.get(target_type, set())
    options.update(
        {key: value for key, value in requested_options.items() if key in allowed}
    )
    if target_type not in _CHOICE_TYPES:
        return options, 0

    supplied = options.get("choices")
    choices: list[dict[str, Any]] = []
    if isinstance(supplied, list):
        for index, choice in enumerate(supplied):
            if not isinstance(choice, dict):
                continue
            normalized = _normalize_choice(choice, index, target_type)
            if normalized is not None:
                choices.append(normalized)

    generated = 0
    if not choices:
        seen: set[str] = set()
        for source_value in source_values:
            for label in _choice_labels(source_value):
                key = label.casefold()
                if key in seen:
                    continue
                seen.add(key)
                choice_id = uuid.uuid5(
                    field.id, f"{target_type.value}:{key}"
                ).hex
                generated += 1
                generated_choice: dict[str, Any] = {
                    "id": choice_id,
                    "label": label,
                    "color": _CHOICE_COLORS[(len(choices)) % len(_CHOICE_COLORS)],
                }
                if target_type in {FieldType.status, FieldType.priority}:
                    generated_choice["group"] = "not_started"
                choices.append(generated_choice)
    options["choices"] = choices
    return options, generated


def _convert_value(
    value: Any, target_type: FieldType, target_options: dict[str, Any]
) -> Any | None:
    if target_type in _TEXT_TYPES:
        return _as_text(value)
    if target_type == FieldType.email:
        text = _as_text(value)
        return text if text and "@" in text else None
    if target_type == FieldType.number:
        return _as_number(value)
    if target_type == FieldType.rating:
        number = _as_number(value)
        return (
            int(number)
            if number is not None and float(number).is_integer() and 1 <= number <= 5
            else None
        )
    if target_type == FieldType.progress:
        number = _as_number(value)
        return max(0, min(100, number)) if number is not None else None
    if target_type == FieldType.checkbox:
        if isinstance(value, bool):
            return value
        if isinstance(value, int | float):
            return value != 0
        if isinstance(value, str):
            normalized = value.strip().casefold()
            if normalized in {"true", "yes", "1", "on", "checked"}:
                return True
            if normalized in {"false", "no", "0", "off", "unchecked"}:
                return False
        return None
    if target_type == FieldType.date:
        if isinstance(value, str) and _valid_iso(value):
            return value
        if isinstance(value, dict):
            start = str(value.get("start") or "")
            end = str(value.get("end") or "")
            if not start or not _valid_iso(start) or (end and not _valid_iso(end)):
                return None
            return {"start": start, "end": end or None}
        return None
    if target_type == FieldType.people:
        return [str(item) for item in value] if isinstance(value, list) else None
    if target_type in _CHOICE_TYPES:
        choices = target_options.get("choices", [])
        by_label = {
            str(choice.get("label") or "").casefold(): str(choice.get("id"))
            for choice in choices
        }
        labels = _choice_labels(value)
        mapped = [by_label[label.casefold()] for label in labels if label.casefold() in by_label]
        if target_type == FieldType.multi_select:
            return list(dict.fromkeys(mapped)) if mapped else None
        return mapped[0] if mapped else None
    return None


def _invalid_reason(
    value: Any,
    target_type: FieldType,
    target_options: dict[str, Any],
) -> str:
    """Explain why a non-empty value cannot be represented by the target field."""
    if target_type in _TEXT_TYPES:
        return "The value cannot be represented as text"
    if target_type == FieldType.email:
        return "Expected an email address containing @"
    if target_type == FieldType.number:
        return "No numeric value could be extracted"
    if target_type == FieldType.rating:
        return "Expected a whole number from 1 to 5"
    if target_type == FieldType.progress:
        return "No numeric percentage could be extracted"
    if target_type == FieldType.checkbox:
        return "Expected true/false, yes/no, 1/0, on/off, or checked/unchecked"
    if target_type == FieldType.date:
        return "Expected an ISO date or a valid date range"
    if target_type == FieldType.people:
        return "Expected a list of workspace user IDs"
    if target_type in _CHOICE_TYPES:
        labels = _choice_labels(value)
        if not labels:
            return "No option label could be read from the value"
        configured_labels = {
            str(choice.get("label") or "").casefold()
            for choice in target_options.get("choices", [])
        }
        if any(label.casefold() not in configured_labels for label in labels):
            return "Value does not match any configured option"
        return "The value could not be mapped to an option"
    return f"The value cannot be converted to {target_type.value}"


def _display_value(value: Any) -> str:
    if isinstance(value, dict | list):
        rendered = json.dumps(value, ensure_ascii=False, default=str)
    else:
        rendered = str(value)
    return rendered if len(rendered) <= 160 else f"{rendered[:157]}…"


def build_field_conversion_plan(
    field: Field,
    entities: list[Entity],
    target_type: FieldType,
    requested_options: dict[str, Any],
) -> FieldConversionPlan:
    """Return converted JSONB payloads and a loss summary without mutating models."""
    field_key = str(field.id)
    source_values = [
        _source_value(field, entity.data.get(field_key))
        for entity in entities
        if not _is_empty(entity.data.get(field_key))
    ]
    target_options, generated_choices = _target_options(
        field, target_type, requested_options, source_values
    )
    entity_data: dict[uuid.UUID, dict[str, Any]] = {}
    converted_cells = 0
    cleared_cells = 0
    empty_cells = 0
    cleared_samples: list[str] = []
    invalid_entity_ids: list[uuid.UUID] = []
    invalid_reason_counts: dict[str, int] = {}
    invalid_samples: list[dict[str, Any]] = []

    for entity in entities:
        next_data = dict(entity.data)
        raw_value = entity.data.get(field_key)
        if _is_empty(raw_value):
            next_data.pop(field_key, None)
            empty_cells += 1
        else:
            source_value = _source_value(field, raw_value)
            converted = _convert_value(source_value, target_type, target_options)
            if converted is None:
                next_data.pop(field_key, None)
                cleared_cells += 1
                invalid_entity_ids.append(entity.id)
                reason = _invalid_reason(source_value, target_type, target_options)
                invalid_reason_counts[reason] = invalid_reason_counts.get(reason, 0) + 1
                if len(cleared_samples) < 5:
                    cleared_samples.append(entity.name)
                if len(invalid_samples) < _MAX_INVALID_SAMPLES:
                    invalid_samples.append(
                        {
                            "entity_id": entity.id,
                            "entity_name": entity.name,
                            "value": _display_value(source_value),
                            "reason": reason,
                        }
                    )
            else:
                next_data[field_key] = converted
                converted_cells += 1
        entity_data[entity.id] = next_data

    return FieldConversionPlan(
        target_options=target_options,
        entity_data=entity_data,
        total_cells=len(entities),
        converted_cells=converted_cells,
        cleared_cells=cleared_cells,
        empty_cells=empty_cells,
        generated_choices=generated_choices,
        cleared_samples=cleared_samples,
        invalid_entity_ids=invalid_entity_ids,
        invalid_reason_counts=invalid_reason_counts,
        invalid_samples=invalid_samples,
    )
