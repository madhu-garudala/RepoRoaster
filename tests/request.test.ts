import { describe, expect, it } from "vitest";
import { isSafeRepositoryUrl, parseLocalContext, parsePreviousRoast } from "../app/lib/request";

const localContext = {
  owner: "facebook",
  repo: "my-project",
  htmlUrl: "https://evil.example",
  stars: 999_999,
  primaryLanguage: "ts",
  languages: { ts: 1200 },
  sizeKb: 2,
  totalFiles: 3,
  sampledFiles: [{ path: "src/index.ts", content: "export const x = 1;", size: 19 }],
  signals: { tests: 0, docs: 1, configs: 1, workflows: 0, directories: 1, truncatedTree: false },
};

const roast = {
  verdict: "Bold choices",
  score: 42,
  summary: "x".repeat(40),
  hits: Array.from({ length: 5 }, () => ({
    title: "Hit",
    body: "y".repeat(20),
    evidence: "zzz",
    severity: "low",
  })),
  redeemingQuality: "r".repeat(20),
  firstAid: ["a".repeat(8), "b".repeat(8), "c".repeat(8)],
  micDrop: "And that's the show.",
};

describe("parseLocalContext", () => {
  it("pins identity fields server-side", () => {
    const context = parseLocalContext(localContext);
    expect(context.owner).toBe("local");
    expect(context.fullName).toBe("my-project");
    expect(context.htmlUrl).toBe("");
    expect(context.stars).toBe(0);
    expect(context.sampledFiles).toHaveLength(1);
  });

  it("rejects uploads beyond the sampling budget", () => {
    const tooMany = Array.from({ length: 13 }, (_, index) => ({ path: `f${index}.ts`, content: "a", size: 1 }));
    expect(() => parseLocalContext({ ...localContext, sampledFiles: tooMany })).toThrow();

    const tooLong = Array.from({ length: 6 }, (_, index) => ({
      path: `f${index}.ts`,
      content: "a".repeat(13_000),
      size: 13_000,
    }));
    expect(() => parseLocalContext({ ...localContext, sampledFiles: tooLong })).toThrow();
  });

  it("rejects malformed input", () => {
    expect(() => parseLocalContext("nope")).toThrow();
    expect(() => parseLocalContext({ ...localContext, sampledFiles: [] })).toThrow();
  });
});

describe("parsePreviousRoast", () => {
  it("accepts a schema-valid roast and ignores absence", () => {
    expect(parsePreviousRoast(roast)?.score).toBe(42);
    expect(parsePreviousRoast(undefined)).toBeUndefined();
  });

  it("rejects anything that is not a roast", () => {
    expect(() => parsePreviousRoast({ verdict: "hi" })).toThrow();
  });
});

describe("isSafeRepositoryUrl", () => {
  it.each([
    ["https://github.com/vercel/next.js", true],
    ["https://evil.example/vercel/next.js", false],
    ["javascript:alert(1)", false],
    ["", false],
  ])("%s -> %s", (url, expected) => {
    expect(isSafeRepositoryUrl(url)).toBe(expected);
  });
});
