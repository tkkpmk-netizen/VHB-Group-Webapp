import { describe, expect, it } from "vitest";
import { extractErrorMessage } from "./client";

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
});
