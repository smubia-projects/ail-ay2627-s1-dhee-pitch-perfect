/**
 * Server-only OpenRouter client used by every AI route (scoring, question
 * generation, rubric parsing, presentation evaluation).
 *
 * Talks to the OpenAI-compatible `/chat/completions` endpoint with plain
 * `fetch` — no provider SDK. The API key is read from `OPENROUTER_API_KEY`
 * and never leaves the server; browser code must not import this module.
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Default model: Gemini Flash handles JSON-schema output and native PDF input. */
const DEFAULT_MODEL = "google/gemini-2.5-flash";

/** Model for every AI route — `OPENROUTER_MODEL` env var, else the default. */
export function getModel(): string {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
}

/** Error carrying the upstream HTTP status (when there was one). */
export class OpenRouterError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "file"; file: { filename: string; file_data: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export type ResponseFormat =
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
    };

/** Wraps a JSON Schema as an OpenRouter structured-output `response_format`. */
export function jsonSchemaFormat(
  name: string,
  schema: Record<string, unknown>,
): ResponseFormat {
  return { type: "json_schema", json_schema: { name, strict: true, schema } };
}

/** Builds a PDF `file` content part from base64 data (no data: prefix). */
export function pdfFilePart(base64: string, filename = "slides.pdf"): ContentPart {
  return {
    type: "file",
    file: { filename, file_data: `data:application/pdf;base64,${base64}` },
  };
}

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: ResponseFormat;
  /** Per-request timeout; aborts the fetch when exceeded. */
  timeoutMs?: number;
}

/**
 * Runs one chat completion and returns the assistant's text content.
 * Throws `OpenRouterError` (with `.status`) on any HTTP or provider error.
 */
export async function chatCompletion(options: ChatOptions): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenRouterError(
      "Missing OpenRouter API key. Set OPENROUTER_API_KEY to enable AI coaching.",
    );
  }

  const body: Record<string, unknown> = {
    model: getModel(),
    messages: options.messages,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  if (options.responseFormat) body.response_format = options.responseFormat;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Pitch Perfect",
    },
    body: JSON.stringify(body),
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON body — handled below.
  }
  const obj = (data ?? {}) as {
    error?: { message?: string; code?: number | string };
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  if (!response.ok || obj.error) {
    const status =
      typeof obj.error?.code === "number" ? obj.error.code : response.status;
    const detail = obj.error?.message ?? response.statusText ?? "request failed";
    throw new OpenRouterError(`OpenRouter ${status}: ${detail}`, status);
  }

  const content = obj.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new OpenRouterError("OpenRouter returned an empty response.", 502);
  }
  return content;
}

/**
 * Runs an LLM call with exponential backoff on transient failures
 * (HTTP 503 / 429 / overloaded / unavailable). Capacity spikes are common
 * and usually clear within seconds.
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
        `[agent:llm] retry attempt=${attempt + 2}/${attempts} delayMs=${delayMs} reason="${message.slice(0, 120)}"`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
