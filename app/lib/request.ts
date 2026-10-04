import { z } from "zod";
import { roastSchema, type RepositoryContext, type Roast } from "./types";

// Mirrors the client-side sampling bounds in browser-local.ts so a hand-crafted
// request cannot push more evidence to the model than the UI ever would.
const MAX_FILES = 12;
const MAX_FILE_CHARS = 14_000;
const MAX_TOTAL_CHARS = 72_000;

const count = z.number().int().min(0).max(1_000_000_000);

const localContextSchema = z.object({
  repo: z.string().trim().min(1).max(100),
  primaryLanguage: z.string().max(40).catch("unknown"),
  languages: z.record(z.string().max(40), count).catch({}),
  sizeKb: count.catch(0),
  totalFiles: count.catch(0),
  sampledFiles: z
    .array(
      z.object({
        path: z.string().min(1).max(300),
        content: z.string().max(MAX_FILE_CHARS),
        size: count,
      }),
    )
    .min(1)
    .max(MAX_FILES)
    .refine(
      (files) => files.reduce((sum, file) => sum + file.content.length, 0) <= MAX_TOTAL_CHARS,
      "Sampled files exceed the total character budget.",
    ),
  signals: z
    .object({
      tests: count,
      docs: count,
      configs: count,
      workflows: count,
      directories: count,
    })
    .catch({ tests: 0, docs: 0, configs: 0, workflows: 0, directories: 0 }),
});

export class RoastRequestError extends Error {
  status = 400;
}

/**
 * Rebuilds a local-folder context from untrusted client input. Identity fields
 * (owner, URL, stars, ...) are fixed server-side so a request cannot pose as a
 * GitHub repository or smuggle in an arbitrary link.
 */
export function parseLocalContext(input: unknown): RepositoryContext {
  const parsed = localContextSchema.safeParse(input);
  if (!parsed.success) {
    throw new RoastRequestError("The local folder upload was malformed or too large.");
  }
  const value = parsed.data;
  const now = new Date().toISOString();
  return {
    owner: "local",
    repo: value.repo,
    fullName: value.repo,
    htmlUrl: "",
    description: "Local Repository",
    defaultBranch: "local",
    stars: 0,
    forks: 0,
    openIssues: 0,
    license: null,
    createdAt: now,
    pushedAt: now,
    sizeKb: value.sizeKb,
    primaryLanguage: value.primaryLanguage,
    languages: value.languages,
    totalFiles: value.totalFiles,
    sampledFiles: value.sampledFiles,
    signals: { ...value.signals, truncatedTree: false },
  };
}

export function parsePreviousRoast(input: unknown): Roast | undefined {
  if (input === undefined || input === null) return undefined;
  const parsed = roastSchema.safeParse(input);
  if (!parsed.success) {
    throw new RoastRequestError("The previous roast could not be reused. Run a fresh roast instead.");
  }
  return parsed.data;
}

/** Only links to github.com are rendered as clickable repository links. */
export function isSafeRepositoryUrl(url: string) {
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/.test(url);
}
