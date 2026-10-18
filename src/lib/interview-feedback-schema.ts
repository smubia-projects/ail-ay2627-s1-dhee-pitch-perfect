import { z } from "zod";

/**
 * Interview feedback schema — the exact shape the Gemini scorer must return
 * (Phase 7). `overall` is computed in code by validate(), never trusted from
 * the model.
 */

/** A runnable practice drill attached to the single priority fix. */
const DrillSchema = z.object({
  title: z.string().max(160),
  /** 1–3 concrete steps built from the user's own words. */
  steps: z.array(z.string().max(240)).min(1).max(3),
  /** How long the drill takes, in minutes (2–5 by prompt convention). */
  minutes: z.number().min(1).max(30),
});

const skill = z.object({
  score: z.number().min(0).max(100).nullable(),
  evidenceQuote: z.string().max(200).nullable(),
  reason: z.string().max(300),
});

export const InterviewFeedbackSchema = z.object({
  status: z.enum(["scored", "insufficient_data"]),
  insufficientReason: z.string().nullable(),
  skills: z
    .object({
      structuredThinking: skill,
      starCar: skill,
      measurableImpact: skill,
      clarityDelivery: skill,
      ownership: skill,
      roleFit: skill,
    })
    .nullable(),
  /** computed in code, not by the model */
  overall: z.number().min(0).max(100).nullable(),
  feedback: z
    .object({
      strength: z.object({
        text: z.string(),
        quote: z.string(),
        /** Seconds from session start — interviews have no camera events, so null. */
        atSec: z.number().nullable().default(null),
      }),
      priorityFix: z.object({
        text: z.string(),
        quote: z.string(),
        atSec: z.number().nullable().default(null),
        drill: DrillSchema.nullable().default(null),
      }),
      rewrittenSentence: z.object({ original: z.string(), improved: z.string() }),
      vsLastAttempt: z.string().nullable(),
      askUser: z.string().nullable(),
    })
    .nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});

export type InterviewFeedback = z.infer<typeof InterviewFeedbackSchema>;
export type InterviewSkills = NonNullable<InterviewFeedback["skills"]>;
export type InterviewSkill = InterviewSkills[keyof InterviewSkills];

// ---------------------------------------------------------------------------
// Guardrails (run in code around every model call)
// ---------------------------------------------------------------------------

export const MIN_WORDS = 30;

export function shouldScore(transcript: string) {
  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  return words >= MIN_WORDS;
}

/**
 * Guardrail pass over a parsed model response:
 * - rejects any score whose evidence quote isn't actually in the transcript
 * - forces `atSec` to null (interviews have no camera timeline) and drops
 *   an empty/malformed practice drill
 * - recomputes `overall` from the surviving skills (needs >= 4 valid skills,
 *   otherwise the headline score is withheld)
 * Mutates and returns `fb`.
 */
export function validate(fb: InterviewFeedback, transcript: string) {
  const t = transcript.toLowerCase();
  const skills = fb.skills ? Object.values(fb.skills) : [];
  for (const s of skills) {
    // reject any score whose quote isn't actually in the transcript
    if (
      s.score !== null &&
      (!s.evidenceQuote || !t.includes(s.evidenceQuote.toLowerCase()))
    ) {
      s.score = null;
      s.reason = "No verifiable evidence in transcript.";
    }
  }
  const scored = skills.filter((s) => s.score !== null) as { score: number }[];
  // not enough valid skills, so no headline score
  fb.overall =
    scored.length >= 4
      ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length)
      : null;
  return sanitizeFeedbackTiming(fb);
}

/**
 * Timing/drill sanitising for the interview track:
 * - `atSec` is ALWAYS normalised to null — interviews have no camera
 *   timeline, so any timestamp the model invents is dropped;
 * - an empty/malformed drill is dropped (never rejected wholesale).
 */
export function sanitizeFeedbackTiming(
  fb: InterviewFeedback,
): InterviewFeedback {
  if (!fb.feedback) return fb;
  fb.feedback.strength.atSec = null;
  fb.feedback.priorityFix.atSec = null;
  const drill = fb.feedback.priorityFix.drill;
  if (drill) {
    drill.title = drill.title.trim();
    drill.steps = drill.steps.map((s) => s.trim()).filter(Boolean).slice(0, 3);
    if (!drill.title || drill.steps.length === 0) {
      fb.feedback.priorityFix.drill = null;
    }
  }
  return fb;
}