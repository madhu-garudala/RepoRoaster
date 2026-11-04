import { describe, expect, it } from "vitest";
import { DEFAULT_ANTHROPIC_ROAST_MODEL, OPENAI_ROAST_MODEL, resolveRoastProvider } from "../app/lib/roast";

describe("resolveRoastProvider", () => {
  it("keeps the OpenAI path when no Anthropic key is present", () => {
    expect(resolveRoastProvider({ OPENAI_API_KEY: "sk-test" })).toEqual({
      provider: "openai",
      model: OPENAI_ROAST_MODEL,
    });
  });

  it("switches to Claude Haiku when ANTHROPIC_API_KEY is set", () => {
    expect(resolveRoastProvider({ OPENAI_API_KEY: "sk-test", ANTHROPIC_API_KEY: "sk-ant-test" })).toEqual({
      provider: "anthropic",
      model: DEFAULT_ANTHROPIC_ROAST_MODEL,
    });
  });

  it("honours ANTHROPIC_MODEL for the Claude path only", () => {
    expect(
      resolveRoastProvider({ ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_MODEL: " claude-sonnet-5-5 " }).model,
    ).toBe("claude-sonnet-5-5");
    expect(resolveRoastProvider({ LLM_PROVIDER: "openai", ANTHROPIC_MODEL: "claude-sonnet-5-5" }).model).toBe(
      OPENAI_ROAST_MODEL,
    );
  });

  it("lets LLM_PROVIDER force a provider regardless of which keys exist", () => {
    expect(resolveRoastProvider({ LLM_PROVIDER: "openai", ANTHROPIC_API_KEY: "sk-ant-test" }).provider).toBe("openai");
    expect(resolveRoastProvider({ LLM_PROVIDER: "Anthropic" }).provider).toBe("anthropic");
  });

  it("rejects an unknown LLM_PROVIDER without leaking anything else", () => {
    expect(() => resolveRoastProvider({ LLM_PROVIDER: "gemini", ANTHROPIC_API_KEY: "sk-ant-test" })).toThrow(
      /LLM_PROVIDER must be/,
    );
  });
});
