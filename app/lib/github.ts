import type { RepositoryContext } from "./types";

const GITHUB_API = "https://api.github.com";
const MAX_FILES = 12;
const MAX_FILE_CHARS = 14_000;
const MAX_TOTAL_CHARS = 72_000;

type RepoMetadata = {
  full_name: string;
  html_url: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  license: { spdx_id?: string; name?: string } | null;
  created_at: string;
  pushed_at: string;
  size: number;
  language: string | null;
  private: boolean;
  archived: boolean;
};

type TreeItem = {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
};

type TreeResponse = { sha: string; truncated: boolean; tree: TreeItem[] };
type BlobResponse = { content: string; encoding: string; size: number };

export class GitHubRepositoryError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GitHubRepositoryError";
    this.status = status;
  }
}

export function parseGitHubRepo(input: string) {
  const value = input.trim();
  if (!value || value.length > 300) {
    throw new GitHubRepositoryError("Enter a valid public GitHub repository URL.");
  }

  let url: URL;
  try {
    url = new URL(value.startsWith("http") ? value : `https://${value}`);
  } catch {
    throw new GitHubRepositoryError("That does not look like a GitHub repository URL.");
  }

  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    throw new GitHubRepositoryError("Only public github.com repository URLs are supported.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new GitHubRepositoryError("Use the repository root URL, like github.com/owner/repo.");
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  const safePart = /^[a-zA-Z0-9_.-]+$/;
  if (!safePart.test(owner) || !safePart.test(repo) || !repo) {
    throw new GitHubRepositoryError("That GitHub owner or repository name is not valid.");
  }

  return { owner, repo };
}

function githubHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-roaster",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function githubJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders(),
    signal,
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new GitHubRepositoryError(
        "Repository not found. Make sure it exists and is public.",
        404,
      );
    }
    if (response.status === 403 || response.status === 429) {
      throw new GitHubRepositoryError(
        "GitHub’s public API limit is busy right now. Try again shortly or add GITHUB_TOKEN.",
        429,
      );
    }
    throw new GitHubRepositoryError("GitHub could not return this repository.", 502);
  }

  return (await response.json()) as T;
}

const TEXT_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt",
  "swift", "php", "cs", "cpp", "c", "h", "vue", "svelte", "html", "css", "scss",
  "sql", "sh", "bash", "yml", "yaml", "toml", "json", "md", "mdx", "txt", "xml",
  "graphql", "gql", "proto", "dockerfile",
]);

const IGNORED_PATH_PARTS = [
  "node_modules/", "vendor/", "dist/", "build/", ".next/", "coverage/", "public/",
  "assets/", "fixtures/", "snapshots/", "generated/", "migrations/",
];

function isTextCandidate(file: TreeItem) {
  if (file.type !== "blob" || !file.path || (file.size ?? 0) > 120_000) return false;
  const lower = file.path.toLowerCase();
  if (IGNORED_PATH_PARTS.some((part) => lower.includes(part))) return false;
  if (/\.(min\.(js|css)|map|lock|svg)$/i.test(lower)) return false;
  const name = lower.split("/").pop() || "";
  const extension = name.includes(".") ? name.split(".").pop() || "" : name;
  return (
    TEXT_EXTENSIONS.has(extension) ||
    /^(readme|license|dockerfile|makefile|procfile|gemfile|rakefile)$/i.test(name) ||
    name.startsWith(".env.example")
  );
}

export function scoreFile(path: string) {
  const lower = path.toLowerCase();
  const name = lower.split("/").pop() || lower;
  const depth = lower.split("/").length - 1;
  let score = 0;

  if (/^readme(\.|$)/.test(name)) score += 150;
  if (/^(package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|build\.gradle)$/.test(name)) score += 135;
  if (/^(dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/.test(name)) score += 110;
  if (/^(tsconfig|vite\.config|next\.config|eslint\.config|webpack\.config)/.test(name)) score += 95;
  if (lower.startsWith(".github/workflows/")) score += 85;
  if (/(^|\/)(test|tests|spec|__tests__)(\/|\.)/.test(lower)) score += 78;
  if (/(^|\/)(src|app|lib)\/(index|main|app|server|route)\./.test(lower)) score += 90;
  if (/(^|\/)(index|main|app|server)\.(ts|tsx|js|jsx|py|go|rs)$/.test(lower)) score += 70;
  if (lower.startsWith("src/") || lower.startsWith("app/")) score += 35;
  if (/security|contributing|architecture/.test(name)) score += 45;

  return score - depth * 3;
}

export function selectImportantFiles(files: TreeItem[]) {
  return files
    .filter(isTextCandidate)
    .sort((a, b) => scoreFile(b.path) - scoreFile(a.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES);
}

function decodeBase64(value: string) {
  const normalized = value.replace(/\s/g, "");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function countSignals(files: TreeItem[], truncatedTree: boolean) {
  const blobPaths = files.filter((file) => file.type === "blob").map((file) => file.path.toLowerCase());
  const directories = new Set<string>();
  for (const path of blobPaths) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }

  return {
    tests: blobPaths.filter((path) => /(^|\/)(test|tests|spec|__tests__)(\/|\.)/.test(path)).length,
    docs: blobPaths.filter((path) => /(^|\/)(docs?\/|readme|contributing|changelog)/.test(path)).length,
    configs: blobPaths.filter((path) => /(^|\/)(\.|.*config\.|package\.json|pyproject\.toml|cargo\.toml|go\.mod)/.test(path)).length,
    workflows: blobPaths.filter((path) => path.startsWith(".github/workflows/")).length,
    directories: directories.size,
    truncatedTree,
  };
}

export async function fetchRepositoryContext(
  owner: string,
  repo: string,
  signal: AbortSignal,
  onStatus?: (message: string) => void,
): Promise<RepositoryContext> {
  onStatus?.("Asking GitHub for the evidence…");
  const metadata = await githubJson<RepoMetadata>(`/repos/${owner}/${repo}`, signal);

  if (metadata.private) {
    throw new GitHubRepositoryError("Private repositories are not supported.", 403);
  }
  if (metadata.archived) {
    onStatus?.("This repo is archived. Dusting off the evidence…");
  }

  onStatus?.("Mapping the repository’s questionable decisions…");
  const [tree, languages] = await Promise.all([
    githubJson<TreeResponse>(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(metadata.default_branch)}?recursive=1`,
      signal,
    ),
    githubJson<Record<string, number>>(`/repos/${owner}/${repo}/languages`, signal),
  ]);

  const blobs = tree.tree.filter((item) => item.type === "blob");
  const selected = selectImportantFiles(blobs);
  onStatus?.(`Reading ${selected.length} high-signal files…`);

  const contents = await Promise.all(
    selected.map(async (file) => {
      try {
        const blob = await githubJson<BlobResponse>(
          `/repos/${owner}/${repo}/git/blobs/${file.sha}`,
          signal,
        );
        if (blob.encoding !== "base64") return null;
        return {
          path: file.path,
          size: blob.size,
          content: decodeBase64(blob.content).slice(0, MAX_FILE_CHARS),
        };
      } catch (error) {
        if (signal.aborted) throw error;
        return null;
      }
    }),
  );

  let totalChars = 0;
  const sampledFiles = contents.filter((file): file is NonNullable<typeof file> => {
    if (!file?.content.trim() || totalChars >= MAX_TOTAL_CHARS) return false;
    const remaining = MAX_TOTAL_CHARS - totalChars;
    file.content = file.content.slice(0, remaining);
    totalChars += file.content.length;
    return true;
  });

  if (!sampledFiles.length) {
    throw new GitHubRepositoryError("This repository has no readable source files to roast.", 422);
  }

  return {
    owner,
    repo,
    fullName: metadata.full_name,
    htmlUrl: metadata.html_url,
    description: metadata.description,
    defaultBranch: metadata.default_branch,
    stars: metadata.stargazers_count,
    forks: metadata.forks_count,
    openIssues: metadata.open_issues_count,
    license: metadata.license?.spdx_id || metadata.license?.name || null,
    createdAt: metadata.created_at,
    pushedAt: metadata.pushed_at,
    sizeKb: metadata.size,
    primaryLanguage: metadata.language || Object.keys(languages)[0] || "Unknown",
    languages,
    totalFiles: blobs.length,
    sampledFiles,
    signals: countSignals(tree.tree, tree.truncated),
  };
}
