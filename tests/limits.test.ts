import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRoastLimits, clientAddress } from "../app/lib/limits";
import { resetMemoryStore } from "../app/lib/store";

function headersFor(ip: string) {
  return new Headers({ "x-forwarded-for": `${ip}, 10.0.0.1` });
}

describe("clientAddress", () => {
  it("uses the first X-Forwarded-For entry", () => {
    expect(clientAddress(headersFor("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("falls back when no address is present", () => {
    expect(clientAddress(new Headers())).toBe("unknown");
  });
});

describe("checkRoastLimits", () => {
  const env = { ...process.env };
  const now = new Date("2026-10-06T12:30:00Z");

  beforeEach(() => {
    resetMemoryStore();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.ROAST_RATE_LIMIT_PER_HOUR = "2";
    process.env.ROAST_DAILY_LIMIT = "3";
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("limits each visitor per hour and reports when they can retry", async () => {
    expect((await checkRoastLimits(headersFor("198.51.100.1"), now)).allowed).toBe(true);
    expect((await checkRoastLimits(headersFor("198.51.100.1"), now)).allowed).toBe(true);
    const blocked = await checkRoastLimits(headersFor("198.51.100.1"), now);
    expect(blocked).toMatchObject({ allowed: false, reason: "visitor", retryAfterSeconds: 1_800 });
  });

  it("caps total roasts per day across visitors", async () => {
    expect((await checkRoastLimits(headersFor("198.51.100.1"), now)).allowed).toBe(true);
    expect((await checkRoastLimits(headersFor("198.51.100.2"), now)).allowed).toBe(true);
    expect((await checkRoastLimits(headersFor("198.51.100.3"), now)).allowed).toBe(true);
    const blocked = await checkRoastLimits(headersFor("198.51.100.4"), now);
    expect(blocked).toMatchObject({ allowed: false, reason: "daily", retryAfterSeconds: 41_400 });
  });

  it("starts a fresh visitor allowance in the next hour", async () => {
    await checkRoastLimits(headersFor("198.51.100.1"), now);
    await checkRoastLimits(headersFor("198.51.100.1"), now);
    const nextHour = new Date("2026-10-06T13:00:01Z");
    expect((await checkRoastLimits(headersFor("198.51.100.1"), nextHour)).allowed).toBe(true);
  });
});
