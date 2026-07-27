import { describe, expect, it } from "vitest";
import type { components } from "./api/schema";
import { serverFilterTreeFor, toText, type FilterGroup } from "./view";

type Field = components["schemas"]["FieldOut"];

describe("serverFilterTreeFor", () => {
  it("preserves nested AND/OR filters for evaluation before pagination", () => {
    const filter: FilterGroup = {
      conj: "and",
      rules: [
        { fieldId: "score", op: "gt", value: "10" },
        {
          conj: "or",
          rules: [
            { fieldId: "region", op: "is", value: "north" },
            { fieldId: "region", op: "is", value: "south" },
          ],
        },
      ],
    };

    expect(serverFilterTreeFor(filter)).toEqual({
      conj: "and",
      rules: [
        { field_id: "score", operator: "gt", value: "10" },
        {
          conj: "or",
          rules: [
            { field_id: "region", operator: "eq", value: "north" },
            { field_id: "region", operator: "eq", value: "south" },
          ],
        },
      ],
    });
  });

  it("omits incomplete rules without weakening valid siblings", () => {
    expect(
      serverFilterTreeFor({
        conj: "or",
        rules: [
          { fieldId: "", op: "contains", value: "ignored" },
          { fieldId: "name", op: "starts_with", value: "Acme" },
        ],
      }),
    ).toEqual({
      conj: "or",
      rules: [
        { field_id: "name", operator: "starts_with", value: "Acme" },
      ],
    });
  });
});

describe("toText", () => {
  const field = (type: Field["type"], choices: { id: string; label: string }[]): Field =>
    ({
      id: "field-id",
      database_id: "database-id",
      name: "Field",
      type,
      icon: null,
      icon_color: null,
      options: { choices },
      order: 0,
    }) as Field;

  it("resolves stored select and status identifiers to their labels", () => {
    expect(
      toText(
        field("select", [{ id: "brand-id", label: "VHB Group" }]),
        "brand-id",
      ),
    ).toBe("VHB Group");
    expect(
      toText(
        field("status", [{ id: "ready-id", label: "Ready" }]),
        "ready-id",
      ),
    ).toBe("Ready");
  });

  it("resolves every stored multi-select identifier", () => {
    expect(
      toText(
        field("multi_select", [
          { id: "vietnam-id", label: "Vietnam" },
          { id: "export-id", label: "Export" },
        ]),
        ["vietnam-id", "export-id"],
      ),
    ).toBe("Vietnam, Export");
  });
});
