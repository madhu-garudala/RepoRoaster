import { z } from "zod";

export const MODE_IDS = ["pep-talk", "code-review", "napalm", "nsfw", "funny"] as const;

export type ModeId = (typeof MODE_IDS)[number];

export const ROAST_HIT_COUNT = 5;

export const roastSchema = z.object({
  verdict: z.string().min(5).max(160),
  score: z.number().int().min(0).max(100),
  summary: z.string().min(40).max(1_600),
  hits: z
    .array(
      z.object({
        title: z.string().min(3).max(120),
        body: z.string().min(20).max(1_100),
        evidence: z.string().min(3).max(300),
        severity: z.enum(["low", "medium", "high"]),
      }),
    )
    .length(ROAST_HIT_COUNT),
  redeemingQuality: z.string().min(20).max(700),
  firstAid: z.array(z.string().min(8).max(300)).length(3),
  micDrop: z.string().min(10).max(280),
});

export type Roast = z.infer<typeof roastSchema>;

export type RepositoryContext = {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  openIssues: number;
  license: string | null;
  createdAt: string;
  pushedAt: string;
  sizeKb: number;
  primaryLanguage: string;
  languages: Record<string, number>;
  totalFiles: number;
  sampledFiles: Array<{ path: string; content: string; size: number }>;
  signals: {
    tests: number;
    docs: number;
    configs: number;
    workflows: number;
    directories: number;
    truncatedTree: boolean;
  };
};

export type RoastResult = {
  repo: {
    name: string;
    url: string;
    description: string | null;
    stars: number;
    language: string;
    filesScanned: number;
    totalFiles: number;
  };
  roast: Roast;
  meta: {
    requestId: string;
    model: string;
    cached: boolean;
    durationMs: number;
  };
};
