import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { RepositoryContext } from "./types";

const MAX_FILES = 12;
const MAX_FILE_CHARS = 14_000;
const MAX_TOTAL_CHARS = 72_000;

const TEXT_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt",
  "swift", "php", "cs", "cpp", "c", "h", "vue", "svelte", "html", "css", "scss",
  "sql", "sh", "bash", "yml", "yaml", "toml", "json", "md", "mdx", "txt", "xml",
  "graphql", "gql", "proto", "dockerfile",
]);

const IGNORED_PATH_PARTS = [
  "node_modules/", "vendor/", "dist/", "build/", ".next/", "coverage/", "public/",
  "assets/", "fixtures/", "snapshots/", "generated/", "migrations/", ".git/",
];

function isTextCandidate(filePath: string, size: number) {
  if (size > 120_000) return false;
  const lower = filePath.toLowerCase();
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

export function scoreFile(filePath: string) {
  const lower = filePath.toLowerCase();
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

export class LocalRepositoryError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "LocalRepositoryError";
    this.status = status;
  }
}

type FileItem = { path: string; size: number; absolutePath: string };

async function walkDir(dir: string, baseDir: string, maxFiles = 10000): Promise<FileItem[]> {
  const files: FileItem[] = [];
  const queue: string[] = [dir];
  let count = 0;

  while (queue.length > 0 && count < maxFiles) {
    const current = queue.shift()!;
    try {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (count >= maxFiles) break;
        const fullPath = path.join(current, entry.name);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

        if (entry.isDirectory()) {
          // ignore known large directories quickly
          if (!IGNORED_PATH_PARTS.some((part) => (relPath + "/").toLowerCase().includes(part))) {
            queue.push(fullPath);
          }
        } else if (entry.isFile()) {
          count++;
          const stat = await fs.stat(fullPath);
          if (isTextCandidate(relPath, stat.size)) {
            files.push({ path: relPath, size: stat.size, absolutePath: fullPath });
          }
        }
      }
    } catch (e) {
      // ignore unreadable directories
    }
  }
  return files;
}

function countSignals(files: FileItem[]) {
  const blobPaths = files.map((file) => file.path.toLowerCase());
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
    truncatedTree: false,
  };
}

export async function fetchLocalRepositoryContext(
  repoPath: string,
  signal: AbortSignal,
  onStatus?: (message: string) => void,
): Promise<RepositoryContext> {
  let stat;
  try {
    stat = await fs.stat(repoPath);
  } catch {
    throw new LocalRepositoryError("Local path not found or inaccessible.", 404);
  }

  if (!stat.isDirectory()) {
    throw new LocalRepositoryError("Path must be a directory.", 400);
  }

  onStatus?.("Scanning local directory…");
  
  const allFiles = await walkDir(repoPath, repoPath);
  const selected = allFiles
    .sort((a, b) => scoreFile(b.path) - scoreFile(a.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES);

  onStatus?.(`Reading ${selected.length} high-signal local files…`);

  const contents = await Promise.all(
    selected.map(async (file) => {
      try {
        const content = await fs.readFile(file.absolutePath, "utf-8");
        return {
          path: file.path,
          size: file.size,
          content: content.slice(0, MAX_FILE_CHARS),
        };
      } catch {
        return null;
      }
    })
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
    throw new LocalRepositoryError("This repository has no readable source files to roast.", 422);
  }

  const languages: Record<string, number> = {};
  let sizeKb = 0;
  for (const file of allFiles) {
    sizeKb += file.size;
    const ext = file.path.split(".").pop() || "unknown";
    languages[ext] = (languages[ext] || 0) + file.size;
  }
  
  const primaryExt = Object.keys(languages).sort((a, b) => languages[b] - languages[a])[0];

  return {
    owner: "local",
    repo: path.basename(repoPath),
    fullName: repoPath,
    htmlUrl: `file://${repoPath}`,
    description: "Local Repository",
    defaultBranch: "local",
    stars: 0,
    forks: 0,
    openIssues: 0,
    license: null,
    createdAt: stat.birthtime.toISOString(),
    pushedAt: stat.mtime.toISOString(),
    sizeKb: Math.round(sizeKb / 1024),
    primaryLanguage: primaryExt,
    languages,
    totalFiles: allFiles.length,
    sampledFiles,
    signals: countSignals(allFiles),
  };
}
