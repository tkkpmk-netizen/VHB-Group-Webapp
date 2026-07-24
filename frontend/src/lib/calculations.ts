export type CalculationOperation =
  | "count"
  | "filled"
  | "empty"
  | "unique"
  | "percent_filled"
  | "sum"
  | "avg"
  | "min"
  | "max";

export type CalculationOption = {
  value: CalculationOperation | "";
  label: string;
};

const BASE_OPTIONS: CalculationOption[] = [
  { value: "", label: "None" },
  { value: "count", label: "Count all" },
  { value: "filled", label: "Filled" },
  { value: "empty", label: "Empty" },
  { value: "unique", label: "Unique" },
  { value: "percent_filled", label: "% Filled" },
];

const NUMERIC_OPTIONS: CalculationOption[] = [
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
];

const NUMERIC_FIELD_TYPES = new Set(["number", "rating", "progress"]);
const OPERATIONS = new Set<CalculationOperation>(
  [...BASE_OPTIONS, ...NUMERIC_OPTIONS]
    .map((option) => option.value)
    .filter((value): value is CalculationOperation => value !== ""),
);

export function normalizeCalculation(
  operation: string | null | undefined,
): CalculationOperation | null {
  if (!operation) return null;
  const normalized = operation === "average" ? "avg" : operation;
  return OPERATIONS.has(normalized as CalculationOperation)
    ? (normalized as CalculationOperation)
    : null;
}

export function calculationOptions(fieldType: string): CalculationOption[] {
  return NUMERIC_FIELD_TYPES.has(fieldType)
    ? [...BASE_OPTIONS, ...NUMERIC_OPTIONS]
    : BASE_OPTIONS;
}

export function calculationForField(
  fieldType: string,
  operation: string | null | undefined,
): CalculationOperation | null {
  const normalized = normalizeCalculation(operation);
  if (!normalized) return null;
  return calculationOptions(fieldType).some(
    (option) => option.value === normalized,
  )
    ? normalized
    : null;
}
