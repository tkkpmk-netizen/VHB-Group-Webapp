import { describe, expect, it } from "vitest";
import type { components } from "./api/schema";
import {
  choiceColor,
  conditionalColorForEntity,
  conditionalColorForGroup,
  type ConditionalColorConfig,
} from "./conditional-colors";

type Field = components["schemas"]["FieldOut"];
type Entity = components["schemas"]["EntityOut"];

const statusField = {
  id: "status-field",
  name: "Status",
  type: "status",
  options: {
    choices: [
      { id: "todo", label: "To do", color: "gray" },
      { id: "done", label: "Done", color: "green" },
    ],
  },
} as unknown as Field;

const entity = {
  id: "entity-1",
  name: "Launch",
  data: { "status-field": "done", amount: 12 },
} as unknown as Entity;

describe("conditional colors", () => {
  it("uses the original color of a Select-like tag", () => {
    expect(choiceColor(statusField, "done")).toBe("green");
    expect(choiceColor(statusField, ["todo", "done"])).toBe("gray");
  });

  it("colors both entities and their matching group from the tag field", () => {
    const config: ConditionalColorConfig = {
      mode: "tag",
      target: "both",
      tagFieldId: statusField.id,
      rules: [],
    };
    expect(conditionalColorForEntity(entity, [statusField], config)).toBe(
      "green",
    );
    expect(conditionalColorForGroup(statusField, "done", config)).toBe(
      "green",
    );
  });

  it("applies the first matching custom rule", () => {
    const amountField = {
      id: "amount",
      name: "Amount",
      type: "number",
      options: {},
    } as unknown as Field;
    const config: ConditionalColorConfig = {
      mode: "rules",
      target: "rows",
      tagFieldId: null,
      rules: [
        {
          id: "large",
          fieldId: amountField.id,
          operator: "gt",
          value: "10",
          color: "orange",
        },
      ],
    };
    expect(
      conditionalColorForEntity(entity, [statusField, amountField], config),
    ).toBe("orange");
  });

  it("applies custom rules to a group when they target its grouping field", () => {
    const config: ConditionalColorConfig = {
      mode: "rules",
      target: "groups",
      tagFieldId: null,
      rules: [
        {
          id: "done-group",
          fieldId: statusField.id,
          operator: "is",
          value: "done",
          color: "green",
        },
      ],
    };
    expect(conditionalColorForGroup(statusField, "done", config)).toBe(
      "green",
    );
    expect(conditionalColorForGroup(statusField, "todo", config)).toBeNull();
  });
});
