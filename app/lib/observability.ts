import { Client } from "langsmith/client";
import { traceable } from "langsmith/traceable";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const API_KEY = /\b(sk-[a-zA-Z0-9_-]{12,}|lsv2_[a-zA-Z0-9_-]{12,})\b/g;
const BEARER = /Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi;

function redactString(value: string) {
  return value
    .slice(0, 2_000)
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(API_KEY, "[REDACTED_API_KEY]")
    .replace(BEARER, "Bearer [REDACTED]");
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[MAX_DEPTH]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      output[key] = /authorization|cookie|password|secret|api.?key|token/i.test(key)
        ? "[REDACTED]"
        : redact(item, depth + 1);
    }
    return output;
  }
  return value;
}

const tracingEnabled =
  Boolean(process.env.LANGSMITH_API_KEY) && process.env.LANGSMITH_TRACING !== "false";

const client = tracingEnabled
  ? new Client({
      apiKey: process.env.LANGSMITH_API_KEY,
      hideInputs: (inputs) => redact(inputs) as Record<string, unknown>,
      hideOutputs: (outputs) => redact(outputs) as Record<string, unknown>,
    })
  : undefined;

export async function flushTracing() {
  if (client) {
    try {
      await client.flush();
    } catch (e) {
      console.error("Failed to flush LangSmith traces", e);
    }
  }
}

export function traced<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  config: {
    name: string;
    runType?: "chain" | "tool" | "llm";
    processInputs?: (inputs: unknown) => Record<string, unknown>;
    processOutputs?: (outputs: unknown) => Record<string, unknown>;
  },
) {
  if (!tracingEnabled || !client) return fn;
  return traceable(fn, {
    name: config.name,
    run_type: config.runType || "chain",
    project_name: process.env.LANGSMITH_PROJECT || "RepoRoasterNew",
    client,
    processInputs: (inputs) =>
      config.processInputs ? config.processInputs(inputs) : (redact(inputs) as Record<string, unknown>),
    processOutputs: (outputs) =>
      config.processOutputs ? config.processOutputs(outputs) : (redact(outputs) as Record<string, unknown>),
  }) as (...args: TArgs) => Promise<TResult>;
}

export async function hashIdentifier(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function logEvent(event: string, fields: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...redact(fields) as Record<string, unknown>,
    }),
  );
}
