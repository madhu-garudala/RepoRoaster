import { describe, expect, it } from "vitest";
import { parseGitHubRepo, selectImportantFiles } from "../app/lib/github";

describe("parseGitHubRepo", () => {
  it("accepts canonical public repository URLs", () => {
    expect(parseGitHubRepo("https://github.com/openai/openai-node")).toEqual({
      owner: "openai",
      repo: "openai-node",
    });
  });

  it("accepts github.com URLs without a protocol", () => {
    expect(parseGitHubRepo("github.com/vercel/next.js")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
  });

  it.each([
    "https://example.com/owner/repo",
    "https://github.com/owner/repo/issues",
    "https://github.com/owner",
    "not a url",
  ])("rejects unsupported input: %s", (value) => {
    expect(() => parseGitHubRepo(value)).toThrow();
  });
});

describe("selectImportantFiles", () => {
  it("prefers high-signal files and excludes generated assets", () => {
    const files = [
      { path: "src/index.ts", type: "blob", mode: "100644", sha: "1", size: 500 },
      { path: "README.md", type: "blob", mode: "100644", sha: "2", size: 500 },
      { path: "dist/bundle.js", type: "blob", mode: "100644", sha: "3", size: 500 },
      { path: "package-lock.json", type: "blob", mode: "100644", sha: "4", size: 500 },
    ] as Parameters<typeof selectImportantFiles>[0];

    expect(selectImportantFiles(files).map((file) => file.path)).toEqual([
      "src/index.ts",
      "README.md",
    ]);
  });
});
