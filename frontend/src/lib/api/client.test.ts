import { describe, expect, it } from "vitest";
import { apiFetch, extractApiError, extractErrorMessage } from "./client";

function res(status: number, body: string): Response {
  return new Response(body, { status });
}

describe("extractErrorMessage", () => {
  it("uses a string detail from the backend", async () => {
    const message = await extractErrorMessage(
      res(422, JSON.stringify({ detail: "Price: expected number" })),
      "/entities",
    );
    expect(message).toBe("Price: expected number");
  });

  it("joins pydantic validation error messages", async () => {
    const body = JSON.stringify({
      detail: [{ msg: "field required" }, { msg: "value is not a valid uuid" }],
    });
    expect(await extractErrorMessage(res(422, body), "/entities")).toBe(
      "field required; value is not a valid uuid",
    );
  });

  it("falls back for non-JSON bodies", async () => {
    expect(await extractErrorMessage(res(502, "Bad Gateway"), "/entities")).toBe(
      "Request to /entities failed (502)",
    );
  });

  it("falls back for JSON without detail", async () => {
    expect(await extractErrorMessage(res(500, "{}"), "/entities")).toBe(
      "Request to /entities failed (500)",
    );
  });

  it("retains a typed conflict payload without parsing detail semantics", async () => {
    const conflict = {
      code: "VERSION_CONFLICT" as const,
      expected_version: 2,
      current_version: 3,
      changed_fields: [{ path: "margin" }],
      rebase_actions: ["compare" as const, "rebase" as const],
      request_id: "request-1",
    };
    const extracted = await extractApiError(
      res(
        409,
        JSON.stringify({
          title: "The record changed",
          detail: "Review the current version.",
          code: "VERSION_CONFLICT",
          conflict,
        }),
      ),
      "/prices/1",
    );

    expect(extracted.message).toBe("Review the current version.");
    expect(extracted.problem?.conflict).toEqual(conflict);
  });
});

describe("apiFetch", () => {
  it("attaches Problem Details to ApiError", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      res(
        409,
        JSON.stringify({
          title: "Conflict",
          code: "VERSION_CONFLICT",
          conflict: {
            code: "VERSION_CONFLICT",
            expected_version: 1,
            current_version: 2,
            changed_fields: [],
            rebase_actions: ["refresh"],
            request_id: "request-2",
          },
        }),
      );
    try {
      await expect(apiFetch("/prices/1")).rejects.toMatchObject({
        status: 409,
        problem: {
          code: "VERSION_CONFLICT",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
