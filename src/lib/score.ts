/**
 * Shared request contract for POST /api/score.
 *
 * Client-safe module: Zod schemas + types only. The Gemini SDK and the API
 * key live exclusively in `src/app/api/score/route.ts`; browser code calls
 * the route via `@/lib/score-client`. Responses are the per-type feedback
 * objects (InterviewFeedback / PresentationFeedback) already carrying their
 * own `status` guard (scored | insufficient_data).
 */

import { z } from "zod";

import { MAX_TRANSCRIPT_CHARS } from "@/lib/presentation";

// ---------------------------------------------------------------------------
// Shared enrichment blocks (personalisation: purpose, priorities, history,
// timestamped evidence)
// ---------------------------------------------------------------------------

/** One weighted criterion — the user's stated priorities for this run. */
export const PrioritySchema = z.object({
  label: z.string().max(200),
  weight: z.number().min(0).max(10),
});

/** The user's own recent run, so the model compares against THEIR baseline. */
export const RecentSessionSchema = z.object({
  /** Epoch ms when the run completed. */
  at: z.number(),
  /** Headline score, or null when that run wasn't scorable. */
  overall: z.number().nullable(),
  /** Per-skill values (0–100) recorded for that run, when available. */
  skills: z.record(z.string(), z.number()).optional(),
  /** Short title (rubric name / role), for context only. */
  title: z.string().max(200).default(""),
});

/** A timestamped camera event the model may cite as evidence (`atSec`). */
export const EvidenceEventSchema = z.object({
  kind: z.string().max(64),
  startSec: z.number(),
  endSec: z.number(),
});

export type PriorityInput = z.infer<typeof PrioritySchema>;
export type RecentSessionInput = z.infer<typeof RecentSessionSchema>;
export type EvidenceEventInput = z.infer<typeof EvidenceEventSchema>;

// ---------------------------------------------------------------------------
// Interview request (#23)
// ---------------------------------------------------------------------------

export const PreviousAttemptSchema = z.object({
  questionId: z.string(),
  at: z.number(),
  overall: z.number().nullable(),
  strength: z.string().nullable(),
  askUser: z.string().nullable(),
});

/** Measured in CODE by the client — never counted by the model. */
export const InterviewMeasuredSchema = z.object({
  wordCount: z.number(),
  wordsPerMinute: z.number(),
  fillerCount: z.number(),
  fillerList: z.array(z.string()),
  durationSec: z.number(),
});

export const InterviewScoreRequestSchema = z.object({
  type: z.literal("interview"),
  transcript: z.string().max(
    MAX_TRANSCRIPT_CHARS,
    `Transcript exceeds ${MAX_TRANSCRIPT_CHARS.toLocaleString()} characters.`,
  ),
  question: z.string().max(4_000),
  role: z.string().max(500).default(""),
  industry: z.string().max(500).default(""),
  projects: z.string().max(8_000).default(""),
  objective: z.string().max(2_000).default(""),
  previousAttempts: z.array(PreviousAttemptSchema).max(5).default([]),
  /** The user's recent interview runs (any question) for baseline compare. */
  recentSessions: z.array(RecentSessionSchema).max(3).default([]),
  measured: InterviewMeasuredSchema,
});

// ---------------------------------------------------------------------------
// Presentation request (#28)
// ---------------------------------------------------------------------------

/** Camera-based metrics only present when the camera was on. */
export const PresentationMeasuredSchema = z.object({
  cameraOn: z.boolean(),
  wordCount: z.number(),
  wordsPerMinute: z.number(),
  fillerCount: z.number(),
  fillerList: z.array(z.string()),
  pauseCount: z.number().nullable(),
  avgPauseSec: z.number().nullable(),
  /** % of face-visible time facing the audience (null when camera off). */
  gazePct: z.number().nullable(),
  /** % of time in a centered, aligned posture (null when camera off). */
  posturePct: z.number().nullable(),
  /** Visible fidget events (null when camera off). */
  fidgetFlags: z.number().nullable(),
  /**
   * Resolved posture mode for the session — "sitting" excludes stance,
   * pacing and leg-movement cues from scoring (P2).
   */
  postMode: z.enum(["sitting", "standing"]).default("standing"),
  /**
   * % of the intended script's content words that reached the transcript
   * (null when no script was provided). Signals script-vs-delivered drift.
   */
  scriptCoveragePct: z.number().min(0).max(100).nullable().default(null),
  durationSec: z.number(),
});

export const PresentationPreviousRunSchema = z.object({
  at: z.number(),
  overall: z.number().nullable(),
  strength: z.string().nullable(),
});

export const PresentationScoreRequestSchema = z.object({
  type: z.literal("presentation"),
  transcript: z.string().max(
    MAX_TRANSCRIPT_CHARS,
    `Transcript exceeds ${MAX_TRANSCRIPT_CHARS.toLocaleString()} characters.`,
  ),
  /** Everything below is "not provided" when empty — never invented (#10/#27). */
  objective: z.string().max(2_000).default(""),
  keyTakeaways: z.string().max(2_000).default(""),
  audience: z.string().max(500).default(""),
  callToAction: z.string().max(2_000).default(""),
  slidesText: z.string().max(12_000).default(""),
  rubricText: z.string().max(12_000).default(""),
  /** What the presenter INTENDED to say (may differ from the transcript). */
  scriptText: z.string().max(MAX_TRANSCRIPT_CHARS).default(""),
  /** Weighted rubric criteria — the user's stated priorities for this run. */
  priorities: z.array(PrioritySchema).max(12).default([]),
  previousRuns: z.array(PresentationPreviousRunSchema).max(3).default([]),
  /** The user's recent presentation runs for baseline comparison. */
  recentSessions: z.array(RecentSessionSchema).max(3).default([]),
  /** Timestamped camera events the model may cite with `atSec`. */
  events: z.array(EvidenceEventSchema).max(30).default([]),
  measured: PresentationMeasuredSchema,
});

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export const ScoreRequestSchema = z.discriminatedUnion("type", [
  InterviewScoreRequestSchema,
  PresentationScoreRequestSchema,
]);

export type ScoreRequest = z.infer<typeof ScoreRequestSchema>;
export type InterviewScoreRequest = z.infer<typeof InterviewScoreRequestSchema>;
export type PresentationScoreRequest = z.infer<
  typeof PresentationScoreRequestSchema
>;