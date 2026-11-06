/**
 * The one way the browser talks to the Pitch Perfect API.
 *
 * The API runs on Cloud Run and the frontend on Vercel, so every request is
 * prefixed with NEXT_PUBLIC_API_BASE (inlined at build time). Locally it
 * defaults to the Express dev server on port 8080 (`npm run dev:server`).
 *
 * The shared rate-limit engine's responses are handled here, once:
 *  - 429 (limit reached)  -> dispatches RATE_LIMIT_EVENT with queries_used, for the CTA modal
 *  - 503 (demo paused)    -> dispatches DEMO_PAUSED_EVENT with the message, for the paused notice
 * <ApiNotices /> (src/components/RateLimitCTA.tsx) renders both. Callers then
 * stop: the offline coach never stands in for an AI result after a 429 / 503
 * (it still covers other failures and the user-chosen local coach mode).
 */

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080").replace(/\/+$/, "");

export const RATE_LIMIT_EVENT = "pitch-perfect:rate-limit";
export const DEMO_PAUSED_EVENT = "pitch-perfect:demo-paused";

/** Thrown by apiJson after a 429 or 503 has already been shown in a modal. */
export class HandledApiError extends Error {
  constructor(public status: number) {
    super(status === 429 ? "Demo limit reached." : "Demo paused.");
  }
}

export const isHandledApiError = (e: unknown): e is HandledApiError => e instanceof HandledApiError;

/**
 * fetch() against the API. Network failures reject as usual. A 429 / 503
 * response dispatches the matching notice event and is returned unchanged.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (res.status === 429 || res.status === 503) {
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.clone().json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
    const detail = (body?.detail ?? {}) as Record<string, unknown>;
    if (res.status === 429) {
      const queriesUsed = Number(body?.queries_used ?? detail.queries_used ?? 0) || 0;
      window.dispatchEvent(new CustomEvent(RATE_LIMIT_EVENT, { detail: { queriesUsed } }));
    } else {
      const message = String(body?.message ?? detail.message ?? "");
      window.dispatchEvent(new CustomEvent(DEMO_PAUSED_EVENT, { detail: { message } }));
    }
  }
  return res;
}

/** POSTs JSON and returns the parsed body, or throws an Error with a readable message. */
export async function apiJson<T>(path: string, payload: unknown, fallbackError: string): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Couldn't reach the Pitch Perfect server. Check your connection and try again.");
  }
  if (res.status === 429 || res.status === 503) throw new HandledApiError(res.status);

  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!res.ok || !body) {
    throw new Error(typeof body?.error === "string" ? body.error : `${fallbackError} (${res.status}).`);
  }
  return body as T;
}
