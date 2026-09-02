import { describe, expect, it } from "vitest";
import { redact } from "../app/lib/observability";

describe("redact", () => {
  it("removes sensitive object fields", () => {
    expect(
      redact({ authorization: "Bearer secret", apiKey: "sk-example123456789", safe: "visible" }),
    ).toEqual({
      authorization: "[REDACTED]",
      apiKey: "[REDACTED]",
      safe: "visible",
    });
  });

  it("redacts secrets embedded in strings", () => {
    expect(redact("contact me@example.com with Bearer abc.def-123")).toBe(
      "contact [REDACTED_EMAIL] with Bearer [REDACTED]",
    );
  });
});
