import { z } from "zod";

/**
 * Presentation feedback schema (#28) — the same shape as the interview one
 * but with presentation skills. Camera-based skills (eyeContact, posture)
 * are forced to null in code when the camera was off. `overall` is computed
 * in code by validate(), never trusted from the model.
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
  /** Verbatim transcript quote, OR a measured number for camera metrics. */
  evidenceQuote: z.string().max(200).nullable(),
  reason: z.string().max(300),
});

/**
 * Script adherence (#28b) — how much of the INTENDED script actually reached
 * the delivery, grounded in transcript quotes. Nullable + optional so older
 * model output (without this block) still parses.
 */
const ScriptAdherenceSchema = z
  .object({
    /** % of the script's content that was delivered (0-100), or null. */
    coveragePct: z.number().min(0).max(100).nullable().default(null),
    /** Sections of the script that WERE covered — short labels/quotes. */
    covered: z.array(z.string().max(240)).max(20).default([]),
    /** Scripted sections that were SKIPPED (the model names what never arrived). */
    skipped: z.array(z.string().max(240)).max(20).default([]),
    /** Things said OFF-script, each quoted verbatim from the transcript. */
    addedOffScript: z.array(z.string().max(240)).max(20).default([]),
    reason: z.string().max(400).default(""),
  })
  .nullable()
  .default(null);

/** Per-criterion verdict against the user's OWN rubric, with evidence + a fix. */
const CriterionResultSchema = z.object({
  label: z.string().max(200),
  verdict: z.enum(["met", "partially_met", "not_met"]),
  /** Verbatim transcript quote (or measured value) backing the verdict. */
  evidenceQuote: z.string().max(300).nullable().default(null),
  /** A specific, content-tied fix for this criterion. */
  fix: z.string().max(400).default(""),
});

/** One concrete, timestamp-tied fix. */
const TopFixSchema = z.object({
  text: z.string().max(400),
  /** Seconds from session start, verified against evidence events (±1 s). */
  atSec: z.number().nullable().default(null),
  /** Verbatim transcript quote backing this fix, when applicable. */
  evidenceQuote: z.string().max(300).nullable().default(null),
});

export const PresentationFeedbackSchema = z.object({
  status: z.enum(["scored", "insufficient_data"]),
  insufficientReason: z.string().nullable(),
  skills: z
    .object({
      pace: skill,
      clarity: skill,
      structure: skill,
      presence: skill,
      eyeContact: skill,
      posture: skill,
    })
    .nullable(),
  /** How much of the intended script was actually delivered. */
  scriptAdherence: ScriptAdherenceSchema,
  /** Verdict against EACH of the user's custom criteria, with evidence. */
  criteriaResults: z.array(CriterionResultSchema).max(12).default([]),
  /** The top fixes, tied to timestamps / verbatim quotes. */
  top3Fixes: z.array(TopFixSchema).max(3).default([]),
  /** computed in code, not by the model */
  overall: z.number().min(0).max(100).nullable(),
  feedback: z
    .object({
      strength: z.object({
        text: z.string(),
        quote: z.string(),
        /** Seconds from session start, verified against evidence events. */
        atSec: z.number().nullable().default(null),
      }),
      priorityFix: z.object({
        text: z.string(),
        quote: z.string(),
        atSec: z.number().nullable().default(null),
        drill: DrillSchema.nullable().default(null),
      }),
      rewrittenSentence: z.object({
        original: z.string(),
        improved: z.string(),
      }),
      vsLastAttempt: z.string().nullable(),
      askUser: z.string().nullable(),
    })
    .nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});

export type PresentationFeedback = z.infer<typeof PresentationFeedbackSchema>;
export type PresentationSkills = NonNullable<PresentationFeedback["skills"]>;
export type ScriptAdherence = NonNullable<
  PresentationFeedback["scriptAdherence"]
>;
export type CriterionResult = PresentationFeedback["criteriaResults"][number];
export type TopFix = PresentationFeedback["top3Fixes"][number];

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

export const MIN_PRESENTATION_WORDS = 30;

export function shouldScore(transcript: string): boolean {
  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  return words >= MIN_PRESENTATION_WORDS;
}

/**
 * Timing/drill sanitising for `atSec` + `drill`:
 * - `atSec` survives only when it matches a supplied evidence event's
 *   `startSec` (±1 s) and fits inside the session (no events → null);
 * - an empty/malformed drill is dropped (never rejected wholesale).
 */
export interface FeedbackTimingOptions {
  /** Session length in seconds — `atSec` outside [0, durationSec] is dropped. */
  durationSec?: number | null;
  /** `startSec` of each supplied evidence event. */
  eventSecs?: number[];
}

export function sanitizeFeedbackTiming(
  fb: PresentationFeedback,
  opts?: FeedbackTimingOptions,
): PresentationFeedback {
  if (!fb.feedback) return fb;
  const keepAt = (at: number | null): number | null => {
    if (at === null) return null;
    if (!opts?.eventSecs?.length) return null;
    if (opts.durationSec != null && (at < 0 || at > opts.durationSec)) {
      return null;
    }
    return opts.eventSecs.some((e) => Math.abs(e - at) <= 1)
      ? Math.round(at)
      : null;
  };
  fb.feedback.strength.atSec = keepAt(fb.feedback.strength.atSec);
  fb.feedback.priorityFix.atSec = keepAt(fb.feedback.priorityFix.atSec);
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

/**
 * Guardrail pass: verifies quotes against the transcript (camera/metric
 * skills may instead cite a "measured …" number per the prompt's evidence
 * rules), sanitises `atSec` (event-verified) + the practice `drill`, and
 * recomputes `overall` (needs >= 4 valid skills, otherwise the headline
 * score is withheld).
 */
/**
 * A quote counts as evidence only if it is verbatim from the transcript, or a
 * camera/metric citation ("measured gazePct 62" / "gazePct 62"). `t` is the
 * lowercased transcript.
 */
function quoteOk(q: string | null | undefined, t: string): boolean {
  const quote = q?.trim() ?? "";
  if (!quote) return false;
  const lower = quote.toLowerCase();
  if (t.includes(lower)) return true;
  // Camera/metric citation: an optional "measured" prefix, a metric-ish token,
  // then a number. Lets the model cite "gazePct 74" without the word "measured".
  return /^(measured\s+)?[a-z][a-zA-Z]*\s+\d/.test(lower);
}

export function validate(
  fb: PresentationFeedback,
  transcript: string,
  opts?: FeedbackTimingOptions,
): PresentationFeedback {
  const t = transcript.toLowerCase();
  const skills = fb.skills ? Object.values(fb.skills) : [];
  for (const s of skills) {
    const quote = s.evidenceQuote?.trim() ?? "";
    if (s.score !== null && !quoteOk(quote, t)) {
      s.score = null;
      s.reason = "No verifiable evidence in transcript.";
    }
  }
  const scored = skills.filter((s) => s.score !== null) as { score: number }[];
  fb.overall =
    scored.length >= 4
      ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length)
      : null;

  // --- Content blocks (#28b): verify quotes, drop empty/unverifiable entries ---
  if (fb.scriptAdherence) {
    const sa = fb.scriptAdherence;
    // Anything the model claims was "added off-script" must be a real quote.
    sa.addedOffScript = sa.addedOffScript.filter((q) => quoteOk(q, t)).slice(0, 10);
    sa.covered = sa.covered.map((s) => s.trim()).filter(Boolean).slice(0, 10);
    sa.skipped = sa.skipped.map((s) => s.trim()).filter(Boolean).slice(0, 10);
    if (!sa.reason) sa.reason = "";
  }
  fb.criteriaResults = (fb.criteriaResults ?? [])
    .map((c) => ({
      ...c,
      label: c.label.trim(),
      evidenceQuote: quoteOk(c.evidenceQuote, t) ? c.evidenceQuote : null,
      fix: c.fix.trim(),
    }))
    .filter((c) => c.label.length > 0)
    .slice(0, 12);
  fb.top3Fixes = (fb.top3Fixes ?? [])
    .map((f) => ({
      ...f,
      text: f.text.trim(),
      evidenceQuote: quoteOk(f.evidenceQuote, t) ? f.evidenceQuote : null,
      atSec: sanitizeAtSec(f.atSec, opts),
    }))
    .filter((f) => f.text.length > 0)
    .slice(0, 3);

  return sanitizeFeedbackTiming(fb, opts);
}

/** Event-verified `atSec` for a top-fix (no events → null, never invented). */
function sanitizeAtSec(
  at: number | null,
  opts?: FeedbackTimingOptions,
): number | null {
  if (at === null) return null;
  if (!opts?.eventSecs?.length) return null;
  if (opts.durationSec != null && (at < 0 || at > opts.durationSec)) {
    return null;
  }
  return opts.eventSecs.some((e) => Math.abs(e - at) <= 1)
    ? Math.round(at)
    : null;
}

/**
 * Forces eye-contact / posture to null when the camera was off (#27/#12).
 * Call BEFORE validate() so the overall recomputation counts only the
 * remaining valid skills.
 */
export function applyCameraGuard(
  fb: PresentationFeedback,
  cameraOn: boolean,
): PresentationFeedback {
  if (!cameraOn && fb.skills) {
    for (const key of ["eyeContact", "posture"] as const) {
      const s = fb.skills[key];
      if (s) {
        s.score = null;
        s.evidenceQuote = null;
        s.reason = "Camera was off, so this was not measured.";
      }
    }
  }
  return fb;
}