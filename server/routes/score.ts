/**
 * POST /api/score — server-side LLM scorer (interview + presentation).
 *
 * OPENROUTER_API_KEY is read only here (and in no client code).
 * Flow: config check → request validation → per-type shouldScore() cost gate
 * (insufficient_data is answered locally, no API call) → OpenRouter (system
 * message + JSON user input, temp 0.2, JSON output) → Zod parse with one
 * retry → guardrail validate() (evidence quotes verified against the
 * transcript; overall recomputed in code) → feedback JSON.
 * Logs carry lengths and counts only — never the key, never transcripts.
 */

import type { Request, Response } from "express";

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
import { chatCompletion, getModel } from "@/lib/openrouter";
import { ScoreRequestSchema, type ScoreRequest } from "@/lib/score";

/**
 * Per-attempt request timeout, enforced by an AbortSignal on the fetch.
 * LLM latency is highly variable (≈3s warm, 30s+ on a cold start), so
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
    status === 402 ||
    status === 403 ||
    /Missing OpenRouter API key|No auth credentials|Insufficient credits|API key not valid|UNAUTHENTICATED/i.test(
      message,
    )
  );
}

/** Maps provider failures (rate limit, overload, network, timeout) to a friendly response. */
function providerErrorResponse(res: Response, err: unknown) {
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
  // A rejected API key / exhausted credits is a config problem, not congestion
  // — say so explicitly rather than inviting blind retries.
  if (isAuthError(err)) {
    return res.status(401).json(
      {
        error:
          "AI scoring is misconfigured — check OPENROUTER_API_KEY.",
        code: "auth",
      },
    );
  }
  if (timedOut) {
    return res.status(504).json({ error: "Mane took too long on that one — try again in a moment.", code: "timeout" });
  }
  if (transient) {
    // 502, not 503: 503 is reserved for the rate-limit kill switch ("paused").
    return res.status(502).json({ error: "Mane is busy, try again in a moment", code: "transient" });
  }
  return res.status(502).json({ error: "Mane couldn't score that run — please try again.", code: "failed" });
}

export async function scoreHandler(req: Request, res: Response) {
  // Server-side secrets only — never NEXT_PUBLIC_, never echoed back.
  const apiKey = (process.env.API_KEY || process.env.OPENROUTER_API_KEY)?.trim();
  const model = getModel();

  if (!apiKey) {
    console.error("[agent:score] step=config-missing");
    return res.status(500).json({ error: "Scoring service is not configured" });
  }

  // express.json() has already parsed (and size-capped) the body.
  const bodyJson: unknown = req.body;

  const parsed = ScoreRequestSchema.safeParse(bodyJson);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const detail = issue
      ? `${issue.path.join(".") || "body"}: ${issue.message}`
      : "Invalid request body.";
    return res.status(400).json({ error: detail });
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
      return res.json({
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
      return res.json({
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

  console.info(
    `[agent:score] step=calling-llm model=${model} type=${input.type} inputChars=${userText.length}`,
  );

  let feedback: InterviewFeedback | PresentationFeedback | null = null;
  let providerAttempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && feedback === null; attempt += 1) {
    let text: string | undefined;
    try {
      text = await chatCompletion({
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userText },
        ],
        temperature: 0.2,
        responseFormat: { type: "json_object" },
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
    } catch (err) {
      // Auth errors are permanent — surface them immediately, never retry.
      if (isAuthError(err)) return providerErrorResponse(res, err);
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
      return providerErrorResponse(res, err);
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
    return res.status(502).json({ error: "Mane couldn't put that scorecard together — please try again." });
  }

  console.info(
    `[agent:score] step=scored type=${input.type} status=${feedback.status} overall=${feedback.overall ?? "n/a"}`,
  );
  return res.json(feedback);
}
