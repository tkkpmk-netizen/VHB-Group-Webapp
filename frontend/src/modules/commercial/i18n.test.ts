import { describe, expect, it } from "vitest";
import {
  commercialHelpEnglish,
  commercialHelpVietnamese,
  commercialText,
} from "@/modules/commercial/i18n";

describe("Commercial dictionaries", () => {
  it("keeps contextual help keys aligned", () => {
    expect(Object.keys(commercialHelpVietnamese).sort()).toEqual(
      Object.keys(commercialHelpEnglish).sort(),
    );
  });

  it("uses English canonical labels and exposes unknown keys", () => {
    expect(commercialText("navigation.quality")).toBe("Quality Control");
    expect(commercialText("unknown.key")).toBe("unknown.key");
  });
});
