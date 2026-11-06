/**
 * Client-side entry point for the LLM scorer.
 *
 * Browser code reaches the model only through the Cloud Run API: this POSTs to
 * /api/score via the shared apiFetch helper (NEXT_PUBLIC_API_BASE + 429/503
 * notices). The OpenRouter key lives on the server and is never read here.
 */

import { apiFetch } from "@/lib/api";
import type { InterviewFeedback } from "@/lib/interview-feedback-schema";
import type { PresentationFeedback } from "@/lib/presentation-feedback-schema";
import {
  InterviewScoreRequestSchema,
  PresentationScoreRequestSchema,
  type InterviewScoreRequest,
  type PresentationScoreRequest,
} from "@/lib/score";

/** Friendly, UI-ready error thrown for non-2xx responses from /api/score. */
export class ScoreRequestError extends Error {
  readonly status: number;
  /**
   * Machine-readable cause: "auth" | "timeout" | "transient" | "failed" |
   * "network" | "rate_limited" (429, CTA shown) | "paused" (503, notice shown).
   */
  readonly code: string;

  constructor(message: string, status: number, code: string = "failed") {
    super(message);
    this.name = "ScoreRequestError";
    this.status = status;
    this.code = code;
  }

  /** True when re-running the same request could plausibly succeed. */
  get retryable(): boolean {
    return this.code !== "auth" && this.code !== "rate_limited" && this.code !== "paused";
  }

  /** True for 429 / 503: the AI limit or the kill switch stopped the request, so no offline result replaces it. */
  get limited(): boolean {
    return this.code === "rate_limited" || this.code === "paused";
  }
}

async function postScore(
  payload: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; error: ScoreRequestError }> {
  let response: Response;
  try {
    response = await apiFetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return {
      ok: false,
      error: new ScoreRequestError(
        "Mane is busy, try again in a moment",
        0,
        "network",
      ),
    };
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON body — fall through to the generic message below.
  }

  // 429 / 503 come from the shared rate-limit engine; apiFetch has already
  // shown the CTA modal / paused notice.
  if (response.status === 429) {
    return {
      ok: false,
      error: new ScoreRequestError("demo limit reached", 429, "rate_limited"),
    };
  }
  if (response.status === 503) {
    return {
      ok: false,
      error: new ScoreRequestError("demo temporarily paused", 503, "paused"),
    };
  }

  if (!response.ok) {
    const fallback = "Mane is busy, try again in a moment";
    const obj =
      data !== null && typeof data === "object"
        ? (data as { error?: unknown; code?: unknown })
        : null;
    const message =
      obj && typeof obj.error === "string" ? obj.error : fallback;
    const code =
      obj && typeof obj.code === "string"
        ? obj.code
        : response.status === 401
          ? "auth"
          : response.status === 504
            ? "timeout"
            : response.status >= 500 || response.status === 0
              ? "transient"
              : "failed";
    return { ok: false, error: new ScoreRequestError(message, response.status, code) };
  }
  return { ok: true, data };
}

/** Scores one interview answer (throws ScoreRequestError on failure). */
export async function scoreInterviewAnswer(
  payload: InterviewScoreRequest,
): Promise<InterviewFeedback> {
  const body = InterviewScoreRequestSchema.parse(payload);
  const out = await postScore(body);
  if (!out.ok) throw out.error;
  // The route already parsed + guardrailed the model output.
  return out.data as InterviewFeedback;
}

/** Scores one presentation run (throws ScoreRequestError on failure). */
export async function scorePresentationRun(
  payload: PresentationScoreRequest,
): Promise<PresentationFeedback> {
  const body = PresentationScoreRequestSchema.parse(payload);
  const out = await postScore(body);
  if (!out.ok) throw out.error;
  return out.data as PresentationFeedback;
}