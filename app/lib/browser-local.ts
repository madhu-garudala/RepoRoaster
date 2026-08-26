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

function countSignals(filePaths: string[]) {
  const blobPaths = filePaths.map((p) => p.toLowerCase());
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

export async function processBrowserFiles(files: File[], onStatus?: (m: string) => void): Promise<RepositoryContext> {
  onStatus?.("Scanning local directory…");

  let sizeKb = 0;
  const languages: Record<string, number> = {};

  const fileItems = [];
  for (const file of files) {
    const relPath = file.webkitRelativePath.split("/").slice(1).join("/");
    if (!relPath) continue;

    sizeKb += file.size;
    const ext = relPath.split(".").pop() || "unknown";
    languages[ext] = (languages[ext] || 0) + file.size;

    if (isTextCandidate(relPath, file.size)) {
      fileItems.push({ file, path: relPath, size: file.size });
    }
  }

  const selected = fileItems
    .sort((a, b) => scoreFile(b.path) - scoreFile(a.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES);

  onStatus?.(`Reading ${selected.length} high-signal local files…`);

  const contents = await Promise.all(
    selected.map(async (item) => {
      try {
        const text = await item.file.text();
        return {
          path: item.path,
          size: item.size,
          content: text.slice(0, MAX_FILE_CHARS),
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
    throw new Error("This repository has no readable source files to roast.");
  }

  const primaryExt = Object.keys(languages).sort((a, b) => languages[b] - languages[a])[0];
  const repoName = files[0].webkitRelativePath.split("/")[0] || "local-repo";

  return {
    owner: "local",
    repo: repoName,
    fullName: repoName,
    htmlUrl: `file://${repoName}`,
    description: "Local Repository",
    defaultBranch: "local",
    stars: 0,
    forks: 0,
    openIssues: 0,
    license: null,
    createdAt: new Date().toISOString(),
    pushedAt: new Date().toISOString(),
    sizeKb: Math.round(sizeKb / 1024),
    primaryLanguage: primaryExt,
    languages,
    totalFiles: files.length,
    sampledFiles,
    signals: countSignals(files.map((f) => f.webkitRelativePath.split("/").slice(1).join("/"))),
  };
}
