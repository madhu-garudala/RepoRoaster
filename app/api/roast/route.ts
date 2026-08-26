import { fetchRepositoryContext, GitHubRepositoryError, parseGitHubRepo } from "../../lib/github";
import { generateRoast, ROAST_MODEL } from "../../lib/roast";
import { hashIdentifier, logEvent, traced, flushTracing } from "../../lib/observability";
import { MODE_IDS, type ModeId, type RoastResult } from "../../lib/types";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 50;
const MAX_BODY_BYTES = 1048576;

type CacheRecord = { createdAt: number; result: Omit<RoastResult, "meta"> };
const responseCache = new Map<string, CacheRecord>();

function writeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: Record<string, unknown>,
) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function cacheGet(key: string) {
  const record = responseCache.get(key);
  if (!record) return null;
  if (Date.now() - record.createdAt > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  responseCache.delete(key);
  responseCache.set(key, record);
  return record.result;
}

function cacheSet(key: string, value: Omit<RoastResult, "meta">) {
  responseCache.set(key, { createdAt: Date.now(), result: value });
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value as string | undefined;
    if (!oldest) break;
    responseCache.delete(oldest);
  }
}

function safeError(error: unknown) {
  if (error instanceof GitHubRepositoryError) return error.message;
  if (error instanceof Error && error.name === "AbortError") {
    return "The analysis timed out. Try a smaller repository or try again.";
  }
  if (error instanceof Error && error.message.includes("OPENAI_API_KEY")) return error.message;
  return "The roast failed before it reached the table. Try again in a moment.";
}

const runRoast = traced(
  async ({
    repoUrl,
    mode,
    signal,
    onStatus,
    payload,
  }: {
    repoUrl: string;
    mode: ModeId;
    signal: AbortSignal;
    onStatus: (message: string) => void;
    payload?: any;
  }) => {
    let owner: string;
    let repo: string;

    if (payload?.localContext) {
      owner = payload.localContext.owner;
      repo = payload.localContext.repo;
    } else {
      const parsed = parseGitHubRepo(repoUrl);
      owner = parsed.owner;
      repo = parsed.repo;
    }

    const cacheKey = `${owner.toLowerCase()}/${repo.toLowerCase()}:${mode}:${ROAST_MODEL}:v1`;
    const cached = cacheGet(cacheKey);
    if (cached) return { ...cached, cached: true };

    let context;
    if (payload?.localContext) {
      context = payload.localContext;
    } else {
      context = await fetchRepositoryContext(owner, repo, signal, onStatus);
    }
    onStatus("Luna is sharpening the punchlines…");
    const { roast } = await generateRoast(context, mode, signal, payload?.previousRoast);

    const result = {
      repo: {
        name: context.fullName,
        url: context.htmlUrl,
        description: context.description,
        stars: context.stars,
        language: context.primaryLanguage,
        filesScanned: context.sampledFiles.length,
        totalFiles: context.totalFiles,
      },
      roast,
    };
    cacheSet(cacheKey, result);
    return { ...result, cached: false };
  },
  {
    name: "Repo Roast Request",
    runType: "chain",
    processInputs: (inputs) => {
      const value = inputs as { repoUrl?: string; mode?: ModeId };
      return { repository_url: value.repoUrl, mode: value.mode, prompt_version: "v1" };
    },
    processOutputs: (outputs) => {
      const value = outputs as { repo?: { name?: string }; roast?: { score?: number }; cached?: boolean };
      return { repository: value.repo?.name, score: value.roast?.score, cache_hit: value.cached };
    },
  },
);

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const contentLength = Number(request.headers.get("content-length") || 0);

  const returnResponse = async (body: any, init?: ResponseInit) => {
    await flushTracing();
    return Response.json(body, init);
  };

  if (contentLength > MAX_BODY_BYTES) {
    return returnResponse(
      { error: "Request body is too large." },
      { status: 413, headers: { "X-Request-Id": requestId } },
    );
  }

  let payload: { repoUrl?: unknown; mode?: unknown; localContext?: any };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return returnResponse(
      { error: "Send a repository URL and roast mode as JSON." },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const repoUrl = typeof payload.repoUrl === "string" ? payload.repoUrl.trim() : "";
  const mode = typeof payload.mode === "string" && MODE_IDS.includes(payload.mode as ModeId)
    ? (payload.mode as ModeId)
    : null;

  if (!repoUrl || !mode) {
    return returnResponse(
      { error: "Choose a valid roast mode and enter a repository URL or local path." },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  try {
    if (!payload.localContext) {
      parseGitHubRepo(repoUrl);
    }
  } catch (error) {
    return returnResponse(
      { error: safeError(error) },
      { status: error instanceof GitHubRepositoryError ? error.status : 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), 52_000);
  const signal = AbortSignal.any([request.signal, timeoutController.signal]);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        writeEvent(controller, { type: "status", message: "Validating the target…" });
        const result = await runRoast({
          repoUrl,
          mode,
          signal,
          onStatus: (message) => writeEvent(controller, { type: "status", message }),
          payload,
        });

        const durationMs = Date.now() - startedAt;
        const response: RoastResult = {
          repo: result.repo,
          roast: result.roast,
          meta: {
            requestId,
            model: ROAST_MODEL,
            cached: result.cached,
            durationMs,
          },
        };
        writeEvent(controller, { type: "result", result: response });

        const repositoryHash = await hashIdentifier(result.repo.name);
        logEvent("repo_roast_complete", {
          request_id: requestId,
          repository_hash: repositoryHash,
          model: ROAST_MODEL,
          mode,
          cache_hit: result.cached,
          duration_ms: durationMs,
          files_scanned: result.repo.filesScanned,
        });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        writeEvent(controller, { type: "error", message: safeError(error), requestId });
        logEvent("repo_roast_error", {
          request_id: requestId,
          model: ROAST_MODEL,
          mode,
          duration_ms: durationMs,
          error_name: error instanceof Error ? error.name : "UnknownError",
        });
      } finally {
        clearTimeout(timeout);
        controller.close();
        await flushTracing();
      }
    },
    cancel() {
      clearTimeout(timeout);
      timeoutController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId,
    },
  });
}
