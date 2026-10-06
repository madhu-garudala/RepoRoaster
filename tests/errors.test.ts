import { describe, expect, it } from "vitest";
import { BUSY_MESSAGE, GENERIC_MESSAGE, OUT_OF_FUEL_MESSAGE, publicErrorMessage, TIMEOUT_MESSAGE } from "../app/lib/errors";
import { GitHubRepositoryError } from "../app/lib/github";

function upstream(status: number, code?: string) {
  return Object.assign(new Error("upstream failure"), { status, code });
}

describe("publicErrorMessage", () => {
  it("tells visitors the roaster is out of fuel for provider account problems", () => {
    expect(publicErrorMessage(upstream(429, "insufficient_quota"))).toBe(OUT_OF_FUEL_MESSAGE);
    expect(publicErrorMessage(upstream(401, "invalid_api_key"))).toBe(OUT_OF_FUEL_MESSAGE);
    expect(publicErrorMessage(upstream(404, "model_not_found"))).toBe(OUT_OF_FUEL_MESSAGE);
    expect(publicErrorMessage(new Error("OPENAI_API_KEY is not configured on the server."))).toBe(OUT_OF_FUEL_MESSAGE);
  });

  it("separates provider rate limits from quota exhaustion", () => {
    expect(publicErrorMessage(upstream(429, "rate_limit_exceeded"))).toBe(BUSY_MESSAGE);
  });

  it("keeps GitHub messages and maps timeouts", () => {
    expect(publicErrorMessage(new GitHubRepositoryError("GitHub could not return this repository.", 404)))
      .toBe("GitHub could not return this repository.");
    expect(publicErrorMessage(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(TIMEOUT_MESSAGE);
  });

  it("falls back to the generic message", () => {
    expect(publicErrorMessage(upstream(500))).toBe(GENERIC_MESSAGE);
    expect(publicErrorMessage("nope")).toBe(GENERIC_MESSAGE);
  });
});
