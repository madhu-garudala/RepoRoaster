/**
 * Small key-value store used for the roast cache, rate limits and the daily cap.
 *
 * When UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set (for example via
 * the Vercel Upstash integration), state is shared across every server instance.
 * Otherwise it falls back to process memory, which is per instance and resets on
 * cold starts: fine for local development, weaker in serverless production.
 */

type MemoryEntry = { value: string; expiresAt: number };

const MAX_MEMORY_ENTRIES = 500;
const memory = new Map<string, MemoryEntry>();

function memoryGet(key: string) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memory.delete(key);
    return null;
  }
  return entry;
}

function memorySet(key: string, value: string, ttlSeconds: number) {
  memory.delete(key);
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
  while (memory.size > MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value as string | undefined;
    if (!oldest) break;
    memory.delete(oldest);
  }
}

function upstashConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function upstash(commands: Array<Array<string | number>>) {
  const config = upstashConfig();
  if (!config) throw new Error("Upstash is not configured.");
  const response = await fetch(`${config.url}/multi-exec`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`Upstash request failed with ${response.status}.`);
  const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  return results.map((item) => {
    if (item.error) throw new Error(item.error);
    return item.result;
  });
}

export function storeBackend() {
  return upstashConfig() ? "upstash" : "memory";
}

export async function storeGet(key: string): Promise<string | null> {
  if (!upstashConfig()) return memoryGet(key)?.value ?? null;
  try {
    const [value] = await upstash([["GET", key]]);
    return typeof value === "string" ? value : null;
  } catch {
    return memoryGet(key)?.value ?? null;
  }
}

export async function storeSet(key: string, value: string, ttlSeconds: number) {
  memorySet(key, value, ttlSeconds);
  if (!upstashConfig()) return;
  try {
    await upstash([["SET", key, value, "EX", ttlSeconds]]);
  } catch {
    // The in-memory copy above still serves this instance.
  }
}

/** Atomically increments a counter that expires `ttlSeconds` after it is first created. */
export async function storeIncrement(key: string, ttlSeconds: number): Promise<number> {
  if (upstashConfig()) {
    try {
      const [count] = await upstash([
        ["INCR", key],
        ["EXPIRE", key, ttlSeconds, "NX"],
      ]);
      if (typeof count === "number") return count;
    } catch {
      // Fall through to the per-instance counter rather than failing the request.
    }
  }
  const entry = memoryGet(key);
  const count = (entry ? Number(entry.value) : 0) + 1;
  memory.set(key, {
    value: String(count),
    expiresAt: entry?.expiresAt ?? Date.now() + ttlSeconds * 1_000,
  });
  return count;
}

/** Test helper: clears the in-memory store. */
export function resetMemoryStore() {
  memory.clear();
}
