import { GitHubRepositoryError } from "./github";
import { RoastRequestError } from "./request";

export const OUT_OF_FUEL_MESSAGE =
  "The roaster is out of fuel right now. The comedian's tab ran dry; try again later.";
export const BUSY_MESSAGE = "Too many roasts are cooking at once. Give it a minute and try again.";
export const TIMEOUT_MESSAGE = "The analysis timed out. Try a smaller repository or try again.";
export const GENERIC_MESSAGE = "The roast failed before it reached the table. Try again in a moment.";

type UpstreamError = Error & { status?: unknown; code?: unknown };

/**
 * Maps any failure to a message that is safe and useful to show visitors.
 * Provider account problems (no credit, bad key, missing model access) are the
 * operator's to fix, so visitors get "out of fuel" rather than "try again".
 */
export function publicErrorMessage(error: unknown) {
  if (error instanceof GitHubRepositoryError || error instanceof RoastRequestError) return error.message;
  if (!(error instanceof Error)) return GENERIC_MESSAGE;
  if (error.name === "AbortError" || error.name === "TimeoutError") return TIMEOUT_MESSAGE;
  if (error.message.includes("OPENAI_API_KEY")) return OUT_OF_FUEL_MESSAGE;

  const { status, code } = error as UpstreamError;
  if (code === "insufficient_quota" || code === "invalid_api_key" || code === "model_not_found") {
    return OUT_OF_FUEL_MESSAGE;
  }
  if (status === 401 || status === 403 || status === 404) return OUT_OF_FUEL_MESSAGE;
  if (status === 429) return BUSY_MESSAGE;
  return GENERIC_MESSAGE;
}
