import {
  InterviewFeedbackSchema,
  validate,
  type InterviewFeedback,
} from "@/lib/interview-feedback-schema";
import type { RecentSessionInput } from "@/lib/score";

/**
 * Interview scorer — builds the JSON input for the model, carries the
 * VERBATIM system prompt, and parses + guardrails the model output.
 * Pure and SDK-free so it is unit-testable; the /api/score route owns the
 * Gemini call itself.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One earlier attempt at the SAME question (from local history). */
export interface PreviousAttempt {
  questionId: string;
  /** Epoch ms. */
  at: number;
  /** Headline score of that attempt, or null when it wasn't scorable. */
  overall: number | null;
  /** The strength Mane gave back then. */
  strength: string | null;
  /** The question Mane asked back then. */
  askUser: string | null;
}

/** Signals measured in CODE — never asked of the model. */
export interface InterviewMeasuredSignals {
  wordCount: number;
  wordsPerMinute: number;
  fillerCount: number;
  fillerList: string[];
  durationSec: number;
}

export interface InterviewScorerInput {
  question: string;
  transcript: string;
  role: string;
  industry: string;
  projects: string;
  objective: string;
  previousAttempts: PreviousAttempt[];
  /** The user's recent interview runs — baseline for comparison + the fix. */
  recentSessions: RecentSessionInput[];
  measured: InterviewMeasuredSignals;
}

const FILLER_RE = /\b(um+|uh+|erm+|hmm+|like|you know|i mean)\b/gi;

/** Fills the measured signals from the transcript + wall-clock duration. */
export function computeInterviewMeasured(
  transcript: string,
  durationSec: number,
): InterviewMeasuredSignals {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const fillers = transcript.match(FILLER_RE) ?? [];
  const minutes = durationSec / 60;
  return {
    wordCount: words.length,
    // Too-short windows produce meaningless rates — report 0 instead.
    wordsPerMinute:
      durationSec >= 3 && minutes > 0 ? Math.round(words.length / minutes) : 0,
    fillerCount: fillers.length,
    fillerList: [...new Set(fillers.map((f) => f.toLowerCase()))],
    durationSec: Math.round(durationSec),
  };
}

/** The exact JSON payload sent as the user message. */
export function buildInterviewScorerInput(
  input: InterviewScorerInput,
): Record<string, unknown> {
  return {
    question: input.question,
    transcript: input.transcript,
    role: input.role,
    industry: input.industry,
    projects: input.projects,
    objective: input.objective,
    previousAttempts: input.previousAttempts,
    recentSessions: input.recentSessions,
    measured: input.measured,
  };
}

// ---------------------------------------------------------------------------
// System prompt (VERBATIM) + output parsing
// ---------------------------------------------------------------------------

export const INTERVIEW_SCORER_SYSTEM_PROMPT = `You are Mane, a warm, direct interview coach. You score ONE spoken interview answer using only the evidence provided.

INPUTS (JSON): question, transcript, role, industry, projects, objective, previousAttempts (may be empty), recentSessions (the user's recent interview runs {at, overall, skills, title} — may be empty), measured (wordCount, wordsPerMinute, fillerCount, fillerList, durationSec).

HARD RULES
1. Use only what is in the inputs. If role, industry, projects or objective are empty, treat them as "not provided". Never invent context, companies, numbers or news.
2. Every score needs an evidence quote copied verbatim from the transcript (max 20 words). If you cannot find a quote, set score to null and evidenceQuote to null, and explain what was missing in "reason".
3. Do not reward length or polish. A vague answer with no example scores low, even if it sounds fluent.
4. If wordCount < 30 or the transcript is empty, return status "insufficient_data" and no scores.
5. Address the speaker as "you". Reference their own words and details. No generic advice that could apply to any answer.
6. Examples in feedback must be built from the user's own content. Do not use canned examples.
7. If previousAttempts exist for this question, compare directly: say what improved and what did not.
8. recentSessions is the user's own baseline across runs: when present, compare against it with real numbers ("your last runs averaged 68") and choose the ONE priorityFix from the skill sitting furthest below that baseline — not the most generic weakness. When empty, pick the skill with the largest absolute gap.
9. priorityFix must be exactly ONE fix and must carry "drill": {title, steps (1–3 concrete steps built from THEIR words), minutes (2–5)} — a practice they can run right now. Never emit generic drills ("practice more", "study the role").
10. No vague advice: every feedback sentence must contain a number, a verbatim quote, or a specific detail from the inputs. "Try to", "be more", "make sure" without a measurable target are banned.
11. Interviews have no camera timeline: strength.atSec and priorityFix.atSec must both be null. Cite verbatim quotes instead.

SCORING SCALE (each skill 0-100)
0-20 absent. 21-40 attempted but weak. 41-60 adequate with clear gaps. 61-80 solid. 81-100 interview-winning, with specific evidence.

SKILLS
- structuredThinking: clear opening, logical order, signposting.
- starCar: Situation, Task, Action, Result all present and distinguishable.
- measurableImpact: quantified outcome or concrete evidence of effect.
- clarityDelivery: concise, few fillers (use measured data), on-topic.
- ownership: "I" actions vs "we", takes responsibility, names own decisions.
- roleFit: ties the answer to the stated role, industry and objective. If role/industry not provided, score null.

OUTPUT: return ONLY valid JSON matching the schema. No markdown, no preamble.
In "feedback": one strength (cite their words), one priority fix (cite their words) WITH a 2–5 minute drill they can run immediately, and a rewrittenSentence that rewrites one of THEIR sentences to be stronger, keeping their facts. If a key detail is missing, put a question to the user in "askUser" instead of inventing it.

OUTPUT SHAPE (JSON):
{
  "status": "scored" | "insufficient_data",
  "insufficientReason": string | null,
  "skills": {
    "structuredThinking": { "score": number|null, "evidenceQuote": string|null, "reason": string },
    "starCar": { "score": number|null, "evidenceQuote": string|null, "reason": string },
    "measurableImpact": { "score": number|null, "evidenceQuote": string|null, "reason": string },
    "clarityDelivery": { "score": number|null, "evidenceQuote": string|null, "reason": string },
    "ownership": { "score": number|null, "evidenceQuote": string|null, "reason": string },
    "roleFit": { "score": number|null, "evidenceQuote": string|null, "reason": string }
  } | null,
  "overall": number | null,
  "feedback": {
    "strength": { "text": string, "quote": string, "atSec": number | null },
    "priorityFix": { "text": string, "quote": string, "atSec": number | null, "drill": { "title": string, "steps": string[], "minutes": number } | null },
    "rewrittenSentence": { "original": string, "improved": string },
    "vsLastAttempt": string | null,
    "askUser": string | null
  } | null,
  "confidence": "low" | "medium" | "high"
}
When status is "insufficient_data": skills and feedback are null, insufficientReason explains why, overall is null.`;

/**
 * Parses raw model output and runs the guardrail pass (quote verification +
 * overall recomputation). Returns null when the shape is invalid — the route
 * retries once in that case.
 */
export function parseInterviewFeedback(
  raw: unknown,
  transcript: string,
): InterviewFeedback | null {
  const parsed = InterviewFeedbackSchema.safeParse(raw);
  if (!parsed.success) return null;
  return validate(parsed.data, transcript);
}