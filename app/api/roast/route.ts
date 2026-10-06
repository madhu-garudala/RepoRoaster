import { fetchRepositoryContext, GitHubRepositoryError, parseGitHubRepo } from "../../lib/github";
import { publicErrorMessage } from "../../lib/errors";
import { checkRoastLimits } from "../../lib/limits";
import { generateRoast, roastModel } from "../../lib/roast";
import { hashIdentifier, logEvent, traced, flushTracing } from "../../lib/observability";
import { parseLocalContext, parsePreviousRoast, RoastRequestError } from "../../lib/request";
import { storeBackend, storeGet, storeSet } from "../../lib/store";
import { MODE_IDS, type ModeId, type RepositoryContext, type Roast, type RoastResult } from "../../lib/types";

export const dynamic = "force-dynamic";
// Long-form roasts can take a while; keep the platform limit above the 85 s deadline.
export const maxDuration = 90;

const CACHE_TTL_SECONDS = 6 * 60 * 60;
const ROAST_DEADLINE_MS = 85_000;
const MAX_BODY_BYTES = 1048576;
const PROMPT_VERSION = "v2";

type CachedRoast = Omit<RoastResult, "meta">;

function writeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: Record<string, unknown>,
) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function cacheKeyFor(owner: string, repo: string, mode: ModeId) {
  return `roast:${PROMPT_VERSION}:${roastModel()}:${owner.toLowerCase()}/${repo.toLowerCase()}:${mode}`;
}

async function cacheGet(key: string): Promise<CachedRoast | null> {
  const raw = await storeGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedRoast;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: CachedRoast) {
  await storeSet(key, JSON.stringify(value), CACHE_TTL_SECONDS);
}

// Upstream details (HTTP status, provider error code, a bounded message) go to
// server logs only, so production failures are diagnosable without exposing
// them to the browser.
function errorDiagnostics(error: unknown) {
  if (!(error instanceof Error)) return {};
  const upstream = error as Error & { status?: unknown; code?: unknown; cause?: unknown };
  const cause = upstream.cause instanceof Error ? upstream.cause.message : undefined;
  return {
    error_message: error.message.slice(0, 300),
    error_status: typeof upstream.status === "number" ? upstream.status : undefined,
    error_code: typeof upstream.code === "string" ? upstream.code : undefined,
    error_cause: cause?.slice(0, 200),
  };
}

const runRoast = traced(
  async ({
    repoUrl,
    mode,
    signal,
    onStatus,
    localContext,
    previousRoast,
    cacheKey,
  }: {
    repoUrl: string;
    mode: ModeId;
    signal: AbortSignal;
    onStatus: (message: string) => void;
    localContext?: RepositoryContext;
    previousRoast?: Roast;
    cacheKey: string | null;
  }) => {
    let context: RepositoryContext;
    if (localContext) {
      context = localContext;
    } else {
      const { owner, repo } = parseGitHubRepo(repoUrl);
      context = await fetchRepositoryContext(owner, repo, signal, onStatus);
    }

    onStatus("Writing the set. Long-form roasts take a moment…");
    const { roast } = await generateRoast(context, mode, signal, previousRoast);

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
    if (cacheKey) await cacheSet(cacheKey, result);
    return { ...result, cached: false };
  },
  {
    name: "Repo Roast Request",
    runType: "chain",
    processInputs: (inputs) => {
      const value = inputs as { repoUrl?: string; mode?: ModeId };
      return { repository_url: value.repoUrl, mode: value.mode, prompt_version: PROMPT_VERSION };
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  let payload: { repoUrl?: unknown; mode?: unknown; localContext?: unknown; previousRoast?: unknown };
  try {
    // Content-Length is optional (chunked uploads), so enforce the limit on the body itself.
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return returnResponse(
        { error: "Request body is too large." },
        { status: 413, headers: { "X-Request-Id": requestId } },
      );
    }
    payload = JSON.parse(body) as typeof payload;
    if (!payload || typeof payload !== "object") throw new Error("Expected a JSON object.");
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

  let localContext: RepositoryContext | undefined;
  let previousRoast: Roast | undefined;
  try {
    if (payload.localContext !== undefined) {
      localContext = parseLocalContext(payload.localContext);
    } else {
      parseGitHubRepo(repoUrl);
    }
    previousRoast = parsePreviousRoast(payload.previousRoast);
  } catch (error) {
    const status = error instanceof GitHubRepositoryError || error instanceof RoastRequestError ? error.status : 400;
    return returnResponse(
      { error: publicErrorMessage(error) },
      { status, headers: { "X-Request-Id": requestId } },
    );
  }

  // Only fresh roasts of GitHub repositories are cached. Local uploads and tone
  // rewrites are built from client-supplied data, so caching them under a
  // repository key would let one visitor plant a roast that others receive.
  let cacheKey: string | null = null;
  let cached: CachedRoast | null = null;
  if (!localContext && !previousRoast) {
    const { owner, repo } = parseGitHubRepo(repoUrl);
    cacheKey = cacheKeyFor(owner, repo, mode);
    cached = await cacheGet(cacheKey);
  }

  // Cache hits are free; every model call counts against the visitor and daily limits.
  if (!cached) {
    const decision = await checkRoastLimits(request.headers);
    if (!decision.allowed) {
      logEvent("repo_roast_limited", {
        request_id: requestId,
        reason: decision.reason,
        store: storeBackend(),
      });
      return returnResponse(
        { error: decision.message },
        {
          status: 429,
          headers: { "X-Request-Id": requestId, "Retry-After": String(decision.retryAfterSeconds) },
        },
      );
    }
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), ROAST_DEADLINE_MS);
  const signal = AbortSignal.any([request.signal, timeoutController.signal]);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        writeEvent(controller, { type: "status", message: "Validating the target…" });
        const result = cached
          ? { ...cached, cached: true }
          : await runRoast({
            repoUrl,
            mode,
            signal,
            onStatus: (message) => writeEvent(controller, { type: "status", message }),
            localContext,
            previousRoast,
            cacheKey,
          });

        const durationMs = Date.now() - startedAt;
        const response: RoastResult = {
          repo: result.repo,
          roast: result.roast,
          meta: {
            requestId,
            model: roastModel(),
            cached: result.cached,
            durationMs,
          },
        };
        writeEvent(controller, { type: "result", result: response });

        const repositoryHash = await hashIdentifier(result.repo.name);
        logEvent("repo_roast_complete", {
          request_id: requestId,
          repository_hash: repositoryHash,
          model: roastModel(),
          mode,
          cache_hit: result.cached,
          duration_ms: durationMs,
          files_scanned: result.repo.filesScanned,
        });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        writeEvent(controller, { type: "error", message: publicErrorMessage(error), requestId });
        logEvent("repo_roast_error", {
          request_id: requestId,
          model: roastModel(),
          mode,
          duration_ms: durationMs,
          error_name: error instanceof Error ? error.name : "UnknownError",
          ...errorDiagnostics(error),
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
