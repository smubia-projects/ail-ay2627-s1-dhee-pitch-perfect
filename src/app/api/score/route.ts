/**
 * POST /api/score — server-side LLM scorer (interview + presentation).
 *
 * The Gemini SDK and GEMINI_API_KEY live only here (and in no client code).
 * Flow: config check → request validation → per-type shouldScore() cost gate
 * (insufficient_data is answered locally, no API call) → Gemini (system
 * instruction + JSON user input, temp 0.2, JSON output) → Zod parse with one
 * retry → guardrail validate() (evidence quotes verified against the
 * transcript; overall recomputed in code) → feedback JSON.
 * Logs carry lengths and counts only — never the key, never transcripts.
 */

import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

import {
  shouldScore as interviewShouldScore,
  type InterviewFeedback,
} from "@/lib/interview-feedback-schema";
import {
  INTERVIEW_SCORER_SYSTEM_PROMPT,
  buildInterviewScorerInput,
  parseInterviewFeedback,
} from "@/lib/interview-scorer";
import {
  shouldScore as presentationShouldScore,
  type PresentationFeedback,
} from "@/lib/presentation-feedback-schema";
import {
  PRESENTATION_SCORER_SYSTEM_PROMPT,
  buildPresentationScorerInput,
  parsePresentationFeedback,
} from "@/lib/presentation-scorer";
import { GEMINI_MODEL } from "@/lib/gemini";
import { ScoreRequestSchema, type ScoreRequest } from "@/lib/score";

export const runtime = "nodejs";
/** Two scoring attempts at 50s each — keep platform headroom above that. */
export const maxDuration = 120;

/**
 * Per-attempt request timeout, enforced by both the SDK and an AbortSignal.
 * Gemini Flash latency is highly variable (≈3s warm, 30s+ on a cold start), so
 * the cap is generous — aborting a slow-but-working call is worse than waiting.
 */
const REQUEST_TIMEOUT_MS = 50_000;
const MAX_ATTEMPTS = 2;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Strips a stray ```json fence the model occasionally wraps around JSON. */
function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

/** True only for failures worth retrying (rate limit, overload, timeout, network). */
function isTransientProviderError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const status =
    typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : undefined;
  const timedOut = /timed?\s?out|timeout|abort/i.test(message);
  const transient =
    status === 429 ||
    (status !== undefined && status >= 500) ||
    /429|RESOURCE_EXHAUSTED|rate.?limit|overloaded|UNAVAILABLE|503|fetch failed|network|ECONN|ENOTFOUND/i.test(
      message,
    );
  return timedOut || transient;
}

/** A rejected/missing API key is a config problem, not congestion. */
function isAuthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const status =
    typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : undefined;
  return (
    status === 401 ||
    status === 403 ||
    /API key not valid|UNAUTHENTICATED|PERMISSION_DENIED|API key not found/i.test(
      message,
    )
  );
}

/** Maps provider failures (rate limit, overload, network, timeout) to a friendly response. */
function providerErrorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  const status =
    typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : undefined;
  const timedOut = /timed?\s?out|timeout|abort/i.test(message);
  const transient = isTransientProviderError(err);
  console.error(
    `[agent:score] step=provider-error status=${status ?? "n/a"} kind=${
      timedOut ? "timeout" : transient ? "transient" : "failed"
    } detail="${message.slice(0, 160).replace(/["\n\r]/g, " ")}"`,
  );
  // A rejected API key is a config problem, not congestion — say so explicitly
  // so the user fixes .env.local rather than retrying blindly.
  if (isAuthError(err)) {
    return NextResponse.json(
      {
        error:
          "AI scoring is misconfigured — check GEMINI_API_KEY in .env.local.",
        code: "auth",
      },
      { status: 401 },
    );
  }
  if (timedOut) {
    return NextResponse.json(
      { error: "Mane took too long on that one — try again in a moment.", code: "timeout" },
      { status: 504 },
    );
  }
  if (transient) {
    return NextResponse.json(
      { error: "Mane is busy, try again in a moment", code: "transient" },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { error: "Mane couldn't score that run — please try again.", code: "failed" },
    { status: 502 },
  );
}

export async function POST(request: Request) {
  // Server-side secrets only — never NEXT_PUBLIC_, never echoed back.
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = GEMINI_MODEL;

  if (!apiKey) {
    console.error("[agent:score] step=config-missing");
    return NextResponse.json(
      { error: "Scoring service is not configured" },
      { status: 500 },
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = ScoreRequestSchema.safeParse(bodyJson);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const detail = issue
      ? `${issue.path.join(".") || "body"}: ${issue.message}`
      : "Invalid request body.";
    return NextResponse.json({ error: detail }, { status: 400 });
  }
  const input: ScoreRequest = parsed.data;
  const transcript = input.transcript.trim();
  const spoken = countWords(transcript);

  // Per-type system prompt, user payload, and cost gate.
  let systemInstruction: string;
  let userText: string;
  if (input.type === "interview") {
    console.info(
      `[agent:score] step=request type=interview transcriptWords=${spoken} previousAttempts=${input.previousAttempts.length}`,
    );
    if (!interviewShouldScore(transcript)) {
      // No API call, no cost (#13/#23).
      console.info(`[agent:score] step=insufficient-data words=${spoken}`);
      return NextResponse.json({
        status: "insufficient_data",
        insufficientReason: `No answer detected: ${spoken} word${spoken === 1 ? "" : "s"} captured — at least 30 are needed to score an answer.`,
        skills: null,
        overall: null,
        feedback: null,
        confidence: "low",
      } satisfies InterviewFeedback);
    }
    systemInstruction = INTERVIEW_SCORER_SYSTEM_PROMPT;
    userText = JSON.stringify(buildInterviewScorerInput(input));
  } else {
    console.info(
      `[agent:score] step=request type=presentation transcriptWords=${spoken} cameraOn=${input.measured.cameraOn} previousRuns=${input.previousRuns.length}`,
    );
    if (!presentationShouldScore(transcript)) {
      console.info(`[agent:score] step=insufficient-data words=${spoken}`);
      return NextResponse.json({
        status: "insufficient_data",
        insufficientReason: `No speech detected: ${spoken} word${spoken === 1 ? "" : "s"} captured — there is nothing to score.`,
        skills: null,
        scriptAdherence: null,
        criteriaResults: [],
        top3Fixes: [],
        overall: null,
        feedback: null,
        confidence: "low",
      } satisfies PresentationFeedback);
    }
    systemInstruction = PRESENTATION_SCORER_SYSTEM_PROMPT;
    userText = JSON.stringify(buildPresentationScorerInput(input));
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS },
  });
  console.info(
    `[agent:score] step=calling-gemini model=${model} type=${input.type} inputChars=${userText.length}`,
  );

  let feedback: InterviewFeedback | PresentationFeedback | null = null;
  let providerAttempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && feedback === null; attempt += 1) {
    let text: string | undefined;
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userText }] }],
        config: {
          systemInstruction,
          temperature: 0.2,
          responseMimeType: "application/json",
          abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      });
      text = response.text;
    } catch (err) {
      // Auth errors are permanent — surface them immediately, never retry.
      if (isAuthError(err)) return providerErrorResponse(err);
      // Transient (429/5xx/timeout/network): one backoff retry, then give up
      // with a clear, non-silent error the UI can offer a Retry button for.
      providerAttempts += 1;
      if (isTransientProviderError(err) && providerAttempts < 2) {
        const delayMs = 1_000;
        console.warn(
          `[agent:score] step=provider-retry attempt=${providerAttempts} delayMs=${delayMs} reason="${
            (err instanceof Error ? err.message : String(err)).slice(0, 120)
          }"`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt -= 1; // this retry is provider-level, not a schema pass
        continue;
      }
      return providerErrorResponse(err);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(stripJsonFences(text ?? ""));
    } catch {
      console.error(
        `[agent:score] step=parse-failed attempt=${attempt} reason=invalid-json`,
      );
      continue;
    }

    // Zod parse + guardrails; null → retry once.
    // Presentation timing options let validate() verify `atSec` against
    // the real evidence events (interviews always normalise atSec to null).
    feedback =
      input.type === "interview"
        ? parseInterviewFeedback(raw, transcript)
        : parsePresentationFeedback(raw, transcript, input.measured.cameraOn, {
            durationSec: input.measured.durationSec,
            eventSecs: input.events.map((e) => e.startSec),
          });
    if (feedback === null) {
      console.error(
        `[agent:score] step=parse-failed attempt=${attempt} reason=schema`,
      );
    }
  }

  if (feedback === null) {
    return NextResponse.json(
      { error: "Mane couldn't put that scorecard together — please try again." },
      { status: 502 },
    );
  }

  console.info(
    `[agent:score] step=scored type=${input.type} status=${feedback.status} overall=${feedback.overall ?? "n/a"}`,
  );
  return NextResponse.json(feedback);
}
