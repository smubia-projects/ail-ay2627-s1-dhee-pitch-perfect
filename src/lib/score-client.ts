/**
 * Client-side entry point for the LLM scorer.
 *
 * This is the ONLY way browser code may reach Gemini: it POSTs to /api/score,
 * which holds the API key and the SDK. Never import @google/genai here and
 * never read GEMINI_API_KEY from the client.
 */

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
  /** Machine-readable cause: "auth" | "timeout" | "transient" | "failed" | "network". */
  readonly code: string;

  constructor(message: string, status: number, code: string = "failed") {
    super(message);
    this.name = "ScoreRequestError";
    this.status = status;
    this.code = code;
  }

  /** True when re-running the same request could plausibly succeed. */
  get retryable(): boolean {
    return this.code !== "auth";
  }
}

async function postScore(
  payload: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; error: ScoreRequestError }> {
  let response: Response;
  try {
    response = await fetch("/api/score", {
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