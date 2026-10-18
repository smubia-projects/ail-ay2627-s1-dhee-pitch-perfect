import { GoogleGenAI } from "@google/genai";

/**
 * Model used for coaching feedback, scoring, question generation and rubric
 * parsing (Gemini Flash family).
 *
 * SINGLE SOURCE OF TRUTH for every API route: `GEMINI_MODEL` env var, default
 * `gemini-3.7-flash` (the model confirmed available for this key; 2.0/2.5
 * Flash 404 for recently-created keys, 3.8/`flash-latest` are capped at
 * ~20 requests/day on the free tier). If a call ever 404s, probe available
 * models via GET /v1beta/models.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.7-flash";

/**
 * Returns a configured Gemini client (new `@google/genai` SDK — the legacy
 * `@google/generative-ai` package is retired).
 *
 * Only API routes call this with `process.env.GEMINI_API_KEY` (server-side
 * secret). There is deliberately NO `NEXT_PUBLIC_` fallback: a public key
 * would be bundled into the browser. The app builds and runs without a key —
 * callers get a descriptive error instead.
 */
export function getGeminiClient(apiKey?: string): GoogleGenAI {
  const key = apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Missing Gemini API key. Set GEMINI_API_KEY in .env.local to enable AI coaching.",
    );
  }

  return new GoogleGenAI({ apiKey: key });
}

/**
 * Runs a Gemini call with exponential backoff on transient failures
 * (HTTP 503 / 429 / UNAVAILABLE / overloaded). Capacity spikes on the
 * Flash models are common and usually clear within seconds.
 */
export async function generateWithRetry<T>(
  run: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 800;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const transient =
        /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded/i.test(
          message,
        ) &&
        // Daily-quota lockouts ("retry in 20h…") won't clear with backoff.
        !/retry in \d+h/i.test(message);
      if (!transient || attempt === attempts - 1) throw err;
      const delayMs = baseDelayMs * 2 ** attempt;
      console.warn(
        `[agent:gemini] retry attempt=${attempt + 2}/${attempts} delayMs=${delayMs} reason="${message.slice(0, 120)}"`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}