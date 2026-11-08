/**
 * Server-only OpenRouter client used by every AI route (scoring, question
 * generation, rubric parsing, presentation evaluation).
 *
 * Talks to the OpenAI-compatible `/chat/completions` endpoint with plain
 * `fetch` — no provider SDK. The API key is read from `OPENROUTER_API_KEY`
 * and never leaves the server; browser code must not import this module.
 */

export const OPENROUTER_BASE_URL = ((process.env.API_BASE_URL || process.env.OPENROUTER_BASE_URL)?.trim() || "https://api.apiyi.com/v1").replace(/\/+$/, "");

/** Default model for every route (reads images, honours JSON mode). */
const DEFAULT_MODEL = "deepseek-v4-1-flash-260910";
/**
 * Model for a request that carries a PDF (rubric parse with slides): deepseek-v4-1-flash-260910 rejects PDF parts
 * (HTTP 400 "Invalid base64 image_url", 2026-11-08), Gemini reads them.
 */
const DEFAULT_PDF_MODEL = "gemini-3.5-flash-lite";

/** Model for every AI route — `OPENROUTER_MODEL` env var, else the default. */
export function getModel(): string {
  return (process.env.MODEL_NAME || process.env.OPENROUTER_MODEL)?.trim() || DEFAULT_MODEL;
}

/** `PDF_MODEL_NAME`, else the default PDF-capable model. */
export function getPdfModel(): string {
  return process.env.PDF_MODEL_NAME?.trim() || DEFAULT_PDF_MODEL;
}

const hasPdf = (messages: ChatMessage[]) =>
  messages.some((m) => Array.isArray(m.content) &&
    m.content.some((p) => p.type === "image_url" && p.image_url.url.startsWith("data:application/pdf")));

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
  | { type: "image_url"; image_url: { url: string } };

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

/**
 * Builds a PDF content part from base64 data (no data: prefix). apiyi's Gemini models read a PDF sent as an
 * `image_url` data URL and silently ignore OpenRouter-style `file` parts.
 */
export function pdfFilePart(base64: string): ContentPart {
  return { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } };
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
  const apiKey = (process.env.API_KEY || process.env.OPENROUTER_API_KEY)?.trim();
  if (!apiKey) {
    throw new OpenRouterError(
      "Missing OpenRouter API key. Set OPENROUTER_API_KEY to enable AI coaching.",
    );
  }

  const model = hasPdf(options.messages) ? getPdfModel() : getModel();
  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
  };
  // DeepSeek thinks before answering by default (about 2x slower); every route here has a visitor waiting.
  if (model.includes("deepseek")) body.reasoning_effort = "none";
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  if (options.responseFormat?.type === "json_schema") {
    // JSON mode with the shape in the prompt (the club pattern); routes validate the result themselves.
    body.response_format = { type: "json_object" };
    body.messages = withShape(options.messages, options.responseFormat.json_schema.schema);
  } else if (options.responseFormat) {
    body.response_format = options.responseFormat;
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "ManeStage",
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

/** Appends "reply with JSON in this shape" to the last user message (text or parts). */
function withShape(messages: ChatMessage[], schema: Record<string, unknown>): ChatMessage[] {
  const note = `Reply with ONE JSON object and nothing else. It must match this JSON Schema (every required field present):\n${JSON.stringify(schema)}`;
  const last = messages.map((m) => m.role).lastIndexOf("user");
  return messages.map((m, i) => {
    if (i !== last) return m;
    if (typeof m.content === "string") return { ...m, content: `${m.content}\n\n${note}` };
    return { ...m, content: [...m.content, { type: "text", text: note }] };
  });
}

/** Strips a ```json fence the model sometimes wraps around JSON (Gemini does even in JSON mode). */
export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

/** Parses a model reply as a JSON object: fences stripped, else the outermost {...}. Throws SyntaxError. */
export function parseModelJson<T = unknown>(text: string): T {
  const body = stripJsonFences(text);
  try {
    return JSON.parse(body) as T;
  } catch (err) {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1)) as T;
    throw err;
  }
}

/**
 * chatCompletion (with generateWithRetry) + parseModelJson + an optional check. A reply that doesn't parse or fails
 * `check` (which returns a problem string, or null when fine) gets one more call that carries the problem.
 */
export async function chatJson<T>(
  options: ChatOptions,
  check: (value: T) => string | null = () => null,
  label = "llm",
): Promise<T> {
  let messages = options.messages;
  let problem = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const text = await generateWithRetry(() => chatCompletion({ ...options, messages }));
    try {
      const value = parseModelJson<T>(text);
      problem = check(value) ?? "";
      if (!problem) return value;
    } catch (err) {
      problem = `the reply was not valid JSON (${err instanceof Error ? err.message.slice(0, 120) : "parse error"})`;
    }
    console.warn(`[agent:${label}] step=reply-rejected attempt=${attempt} reason="${problem.slice(0, 200)}"`);
    messages = [
      ...options.messages,
      { role: "assistant", content: text.slice(0, 12_000) },
      { role: "user", content: `That reply was not usable: ${problem}. Reply again with the complete JSON object only.` },
    ];
  }
  throw new OpenRouterError(`The AI reply was not usable: ${problem}`, 502);
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
