import { hashIdentifier } from "./observability";
import { storeIncrement } from "./store";

const DEFAULT_PER_HOUR = 6;
const DEFAULT_PER_DAY = 300;

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function limitConfig() {
  return {
    perHour: positiveInt(process.env.ROAST_RATE_LIMIT_PER_HOUR, DEFAULT_PER_HOUR),
    perDay: positiveInt(process.env.ROAST_DAILY_LIMIT, DEFAULT_PER_DAY),
  };
}

/** Best-effort client address. Vercel and App Runner both set X-Forwarded-For. */
export function clientAddress(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

export type LimitDecision =
  | { allowed: true }
  | { allowed: false; reason: "visitor" | "daily"; retryAfterSeconds: number; message: string };

function secondsUntilNextHour(now: Date) {
  return 3_600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds());
}

function secondsUntilUtcMidnight(now: Date) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1_000));
}

/**
 * Counts one fresh roast (a model call) against the visitor's hourly allowance and
 * the site-wide daily budget. Cache hits should not call this.
 */
export async function checkRoastLimits(headers: Headers, now = new Date()): Promise<LimitDecision> {
  const { perHour, perDay } = limitConfig();
  const visitor = await hashIdentifier(clientAddress(headers));
  const hourBucket = now.toISOString().slice(0, 13);
  const dayBucket = now.toISOString().slice(0, 10);

  const visitorCount = await storeIncrement(`rl:visitor:${visitor}:${hourBucket}`, 3_600);
  if (visitorCount > perHour) {
    const retryAfterSeconds = secondsUntilNextHour(now);
    return {
      allowed: false,
      reason: "visitor",
      retryAfterSeconds,
      message: `You've used all ${perHour} roasts for this hour. The grill reopens in about ${Math.ceil(retryAfterSeconds / 60)} min.`,
    };
  }

  const dailyCount = await storeIncrement(`rl:daily:${dayBucket}`, 26 * 3_600);
  if (dailyCount > perDay) {
    return {
      allowed: false,
      reason: "daily",
      retryAfterSeconds: secondsUntilUtcMidnight(now),
      message: "The roaster has hit today's limit. Come back tomorrow for fresh burns.",
    };
  }

  return { allowed: true };
}
