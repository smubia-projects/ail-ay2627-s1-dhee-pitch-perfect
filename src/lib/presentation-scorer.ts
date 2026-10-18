import {
  PresentationFeedbackSchema,
  applyCameraGuard,
  validate,
  type FeedbackTimingOptions,
  type PresentationFeedback,
} from "@/lib/presentation-feedback-schema";
import type { PresentationScoreRequest } from "@/lib/score";

/**
 * Presentation scorer (#28) — same pattern as the interview one: builds the
 * JSON input, carries the system prompt, parses + guardrails the output.
 * Pure and SDK-free; the /api/score route owns the Gemini call.
 */

/** Previous presentation run for direct comparison. */
export interface PresentationPreviousRun {
  at: number;
  overall: number | null;
  strength: string | null;
}

/** The exact JSON payload sent as the user message. */
export function buildPresentationScorerInput(
  request: PresentationScoreRequest,
): Record<string, unknown> {
  return {
    transcript: request.transcript,
    // Empty fields are "not provided" — the prompt forbids inventing them.
    objective: request.objective,
    keyTakeaways: request.keyTakeaways,
    audience: request.audience,
    callToAction: request.callToAction,
    slidesText: request.slidesText,
    /** What the presenter INTENDED to say — drift detector, not the transcript. */
    scriptText: request.scriptText,
    rubricText: request.rubricText,
    /** The user's stated priorities: weighted criteria, always included. */
    priorities: request.priorities,
    previousRuns: request.previousRuns satisfies PresentationPreviousRun[],
    /** The user's own recent runs — baseline for comparison + the fix. */
    recentSessions: request.recentSessions,
    /** Timestamped camera events the model may cite with atSec (±1 s). */
    evidenceEvents: request.events,
    measured: request.measured,
  };
}

// ---------------------------------------------------------------------------
// System prompt + output parsing
// ---------------------------------------------------------------------------

export const PRESENTATION_SCORER_SYSTEM_PROMPT = `You are Mane, a warm, direct presentation coach. You score ONE rehearsal run using only the evidence provided.

INPUTS (JSON): transcript (what the speaker said), objective, keyTakeaways, audience, callToAction, slidesText, scriptText (the words the presenter INTENDED to say), rubricText, priorities (label + weight — the user's stated focus), previousRuns (may be empty), recentSessions (the user's recent runs {at, overall, skills, title}; may be empty), evidenceEvents (timestamped camera events {kind, startSec, endSec}; may be empty), measured (cameraOn, wordCount, wordsPerMinute, fillerCount, fillerList, pauseCount, avgPauseSec, gazePct, posturePct, fidgetFlags, postMode, scriptCoveragePct, durationSec).

HARD RULES
1. Use only what is in the inputs. Empty fields are "not provided". Never invent context, numbers, audience facts, rubric weights or goals.
2. Every transcript-based skill score needs an evidence quote copied verbatim from the transcript (max 20 words). Camera metrics (eyeContact, posture) may instead cite the measured number, e.g. "gazePct 62". If you cannot find support, set score to null and evidenceQuote to null, and explain what was missing in "reason".
3. Do not reward length or polish. A vague talk with no structure scores low even if it sounds confident.
4. If wordCount < 30 or the transcript is empty, return status "insufficient_data" and no scores.
5. When measured.cameraOn is false, set eyeContact and posture to null with reason "Camera was off, so this was not measured." — never guess body metrics.
6. Address the speaker as "you" and use their own words. No generic advice that could apply to any talk. Examples must be built from their content.
7. If previousRuns exist, compare directly: say what improved and what did not.
8. priorities are the user's stated focus for this run: give the matching skills extra scrutiny, name the weight when explaining a gap ("structure carries weight 3 for you"), and when picking the ONE priorityFix prefer the highest-weighted area that actually slipped.
9. recentSessions is the user's own baseline across runs: compare with real numbers ("your last runs averaged 71") and say which skills went up or down. Choose the priorityFix from the skill furthest below their own baseline when one exists.
10. priorityFix must be exactly ONE fix and must carry "drill": {title, steps (1–3 concrete steps built from THEIR words), minutes (2–5)} — a practice they can run right now. Never emit generic drills ("practice more", "slow down").
11. Timestamps: strength.atSec and priorityFix.atSec must be the startSec of an event you actually cite from evidenceEvents (within ±1 s, inside the session) — otherwise null. Never invent timestamps.
12. scriptText is what the presenter INTENDED to say and measured.scriptCoveragePct is the % of the script's content words that reached the transcript. When coverage is below 70, name the drift: quote the delivered line and say which scripted section (its own words) never arrived. If transcript and script are the same text, or no script was provided (coverage null), skip the drift comment entirely.
13. No vague advice: every feedback sentence must contain a number, a verbatim quote, a measured value, or a specific detail from the inputs.
14. measured.postMode "sitting" means the presenter is SEATED: score posture from the shoulders and torso only; never mention stance, feet, weight shifts or walking pacing; and treat fidgetFlags as not applicable when it is null (sitting excludes stance/leg movement) rather than as zero.
15. CONTENT GROUNDING: never give generic advice that could apply to any talk. Every fix, criterion verdict, and comment must be tied to THIS talk — cite a verbatim transcript quote, a slide line, or a measured number. If you cannot tie it to their content, omit it.
16. scriptAdherence: compare transcript against scriptText. Report coveragePct (the % of scripted content actually delivered), list the scripted sections you HEARD (covered) and those that NEVER ARRIVED (skipped, in the presenter's own words), and any material said OFF-script (addedOffScript, each a verbatim transcript quote). If no script was provided, set scriptAdherence to null.
17. criteriaResults: return ONE entry per item in priorities/rubricText (the user's OWN criteria). For each: the exact label, a verdict of "met" | "partially_met" | "not_met", a verbatim transcript quote as evidenceQuote (or a "measured …" value), and a specific fix. Do not invent criteria; only use the ones provided.
18. top3Fixes: the 3 most impactful, concrete fixes, each tied to a timestamp (the startSec of an event you cite from evidenceEvents, else null) and/or a verbatim quote. Order by impact. These replace vague "practice more" advice.

SCORING SCALE (each skill 0-100)
0-20 absent. 21-40 attempted but weak. 41-60 adequate with clear gaps. 61-80 solid. 81-100 stage-ready, with specific evidence.

SKILLS
- pace: wordsPerMinute and pauses against a conversational 110-160 wpm (use measured data).
- clarity: plain language, few fillers (use measured fillerCount/fillerList), on-topic.
- structure: clear opening, logical sections, signposting, and a closing recap.
- presence: energy and delivery — use measured pauses/fidgetFlags when the camera was on.
- eyeContact: audience orientation via gazePct. Null when the camera was off.
- posture: centered, aligned stance via posturePct. Null when the camera was off.

OUTPUT: return ONLY valid JSON matching the schema. No markdown, no preamble.
In "feedback": one strength (cite their words or a measured number), one priority fix (cite their words or a measured number) WITH a 2–5 minute drill they can run immediately, and a rewrittenSentence that rewrites one of THEIR sentences to be stronger, keeping their facts. If the objective or a key detail is missing, put a question to the user in "askUser" instead of inventing it.

OUTPUT SHAPE (JSON):
{
  "status": "scored" | "insufficient_data",
  "insufficientReason": string | null,
  "skills": {
    "pace": { "score": number|null, "evidenceQuote": string|null, "reason": string },
    "clarity": { "score": number|null, "evidenceQuote": string|null, "reason": string },
    "structure": { "score": number|null, "evidenceQuote": string|null, "reason": string },
    "presence": { "score": number|null, "evidenceQuote": string|null, "reason": string },
    "eyeContact": { "score": number|null, "evidenceQuote": string|null, "reason": string },
    "posture": { "score": number|null, "evidenceQuote": string|null, "reason": string }
  } | null,
  "scriptAdherence": {
    "coveragePct": number | null,
    "covered": string[],
    "skipped": string[],
    "addedOffScript": string[],
    "reason": string
  } | null,
  "criteriaResults": [
    { "label": string, "verdict": "met" | "partially_met" | "not_met", "evidenceQuote": string | null, "fix": string }
  ],
  "top3Fixes": [
    { "text": string, "atSec": number | null, "evidenceQuote": string | null }
  ],
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
When status is "insufficient_data": skills, scriptAdherence and feedback are null, criteriaResults and top3Fixes are empty arrays, insufficientReason explains why, overall is null.`;

/**
 * Parses raw model output and runs the guardrail pass (camera guard first,
 * then quote verification + overall recomputation). Returns null when the
 * shape is invalid — the route retries once in that case.
 */
export function parsePresentationFeedback(
  raw: unknown,
  transcript: string,
  cameraOn: boolean,
  opts?: FeedbackTimingOptions,
): PresentationFeedback | null {
  const parsed = PresentationFeedbackSchema.safeParse(raw);
  if (!parsed.success) return null;
  const guarded = applyCameraGuard(parsed.data, cameraOn);
  return validate(guarded, transcript, opts);
}