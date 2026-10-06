import { describe, expect, it } from "vitest";
import { roastAsText, roastShareUrl } from "../app/lib/share";

const result = {
  repo: { name: "owner/repo" },
  roast: {
    verdict: "A monument to optimism",
    score: 41,
    summary: "Opening bit.",
    hits: [{ title: "Hit one", body: "Body", evidence: "src/index.ts", severity: "high" as const }],
    redeemingQuality: "It compiles.",
    firstAid: ["Delete it", "Rename it", "Apologize"],
    micDrop: "Goodnight.",
  },
};

describe("share helpers", () => {
  it("builds an X intent with the score, verdict and site", () => {
    const url = new URL(roastShareUrl(result, "https://roast.example"));
    const text = url.searchParams.get("text") ?? "";
    expect(url.hostname).toBe("twitter.com");
    expect(text).toContain("owner/repo scored 41/100");
    expect(text).toContain("A monument to optimism");
    expect(text).toContain("https://roast.example");
  });

  it("renders the whole roast as text", () => {
    const text = roastAsText(result, "https://roast.example");
    expect(text).toContain("1. Hit one [high]");
    expect(text).toContain("🎤 Goodnight.");
  });
});
