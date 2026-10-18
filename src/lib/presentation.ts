/**
 * Shared types for the Presentation Coach engine: the custom rubric parser
 * output (qualitative directives + hard telemetry rules + semantic
 * overrides) and the Gemini evaluation scorecard schema.
 */

/** Qualitative directives extracted from a custom grading rubric. */
export type DirectiveCategory =
  | "narrative_hook"
  | "structure"
  | "content"
  | "delivery"
  | "visual_aid"
  | "other";

/** Telemetry signals a rubric can attach hard numeric rules to. */
export type TelemetryMetric =
  | "wpm"
  | "pause_seconds"
  | "pitch_std_hz"
  | "posture_lean_deg"
  | "shoulder_tilt_deg"
  | "gaze_deviation_deg"
  | "head_yaw_deg"
  | "arms_crossed_seconds"
  | "hands_outside_box_seconds"
  | "sway_frequency_hz"
  | "sway_seconds"
  | "steps";

export type Comparator = "at_least" | "at_most" | "ideal_range";

export type RuleSeverity = "hard" | "soft";

/** Telemetry signals that a semantic override may protect from penalties. */
export type ProtectedSignal =
  | "gaze_off_camera"
  | "turned_away"
  | "posture_lean"
  | "arms_crossed"
  | "hands_outside_box"
  | "swaying";

export interface QualitativeDirective {
  category: DirectiveCategory;
  instruction: string;
  /** Slide/section the directive applies to, if identifiable. */
  slideRef: string;
}

export interface TelemetryRule {
  metric: TelemetryMetric;
  comparator: Comparator;
  /** Threshold value (lower bound, target, or single bound). */
  value: number;
  /** Upper bound for `ideal_range`, otherwise null. */
  valueMax: number | null;
  unit: string;
  severity: RuleSeverity;
  description: string;
}

export interface SemanticOverride {
  /** What the rubric asks the speaker to do (e.g. "turn to the physical
   * slide on the left wall"). */
  cue: string;
  /** Signals that must NOT be penalized while this cue applies. */
  protects: ProtectedSignal[];
  /** How the evaluator should recognise/apply this override. */
  guidance: string;
}

/** Output of POST /api/presentation/parse-rubric. */
export interface ParsedRubric {
  /** Which engine produced this: Gemini, or the offline fallback. */
  engine?: "gemini" | "local";
  title: string;
  /** Normalized/extracted slide text (also filled from PDF uploads). */
  slideText: string;
  directives: QualitativeDirective[];
  telemetryRules: TelemetryRule[];
  semanticOverrides: SemanticOverride[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Evaluation scorecard (POST /api/presentation/evaluate)
// ---------------------------------------------------------------------------

export type ScoreGrade = "excellent" | "good" | "fair" | "needs_work";
export type PointStatus = "met" | "deducted" | "na";
export type EvidenceSource = "telemetry" | "transcript" | "rubric" | "audio";
export type HighlightAssessment = "good" | "ok" | "needs_work";

export interface ScoreEvidence {
  source: EvidenceSource;
  detail: string;
  /** Seconds from session start, when the evidence is an event. */
  timestampSec: number | null;
  /** Occurrence count, when the evidence is aggregated. */
  count: number | null;
}

export interface ScorecardPoint {
  id: string;
  category: string;
  title: string;
  status: PointStatus;
  maxPoints: number;
  pointsDeducted: number;
  feedback: string;
  evidence: ScoreEvidence[];
  recommendation: string;
}

export interface ScorecardCategory {
  id: string;
  name: string;
  maxPoints: number;
  awardedPoints: number;
  deductionTotal: number;
}

export interface TelemetryHighlight {
  metric: string;
  observation: string;
  assessment: HighlightAssessment;
}

/** A flagged unconventional move or phrase with whitelist state. */
export interface FlaggedMove {
  /** Stable id derived from the phrase/move. */
  id: string;
  /** The phrase ("um…") or move ("looked down repeatedly"). */
  phrase: string;
  kind: "phrase" | "move";
  /** Occurrence count within the session. */
  count: number;
  /** Best-effort timestamp (seconds) of the first occurrence. */
  timestampSec: number | null;
  /** True once the user marks it intentional — evaluator ignores it. */
  whitelisted: boolean;
}

/** A timestamped weak point / stumble pulled from telemetry events. */
export interface TimestampedFeedback {
  label: string;
  startSec: number;
  endSec: number;
  severity: "minor" | "major";
}

export interface Scorecard {
  /** Which engine produced this: Gemini, or the offline fallback. */
  engine?: "gemini" | "local";
  overallScore: number;
  grade: ScoreGrade;
  summary: string;
  categories: ScorecardCategory[];
  points: ScorecardPoint[];
  telemetryHighlights: TelemetryHighlight[];
  strengths: string[];
  improvements: string[];
  /** Major weak points with timestamps from the session. */
  timestampedFeedback?: TimestampedFeedback[];
  /** Unconventional moves/phrases the user can whitelist as intentional. */
  flaggedMoves?: FlaggedMove[];
}

// ---------------------------------------------------------------------------
// Limits shared by the UI and API routes
// ---------------------------------------------------------------------------

export const MAX_SLIDE_CHARS = 30_000;
export const MAX_RUBRIC_CHARS = 20_000;
export const MAX_TRANSCRIPT_CHARS = 30_000;
/** PDF slides are forwarded to Gemini inline (Flash supports ≤ 300 pages). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Trims long documents for prompt assembly, keeping head and tail. */
export function trimForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.ceil(maxChars * 0.7);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n\n[... content trimmed for length ...]\n\n${text.slice(text.length - tail)}`;
}

/** Stopwords — the remaining content words carry the script's meaning. */
const SCRIPT_STOPWORDS = new Set(
  ("the a an and or but if then for of to in on at with about from into over after before " +
    "was were is are be been being do does did have has had i we you they he she it my our your " +
    "their this that these those not no yes so as by up down out off can could would should will " +
    "just actually basically really like know going got get make made very too when where which " +
    "who what how why all any both each few more most other some such only own same than")
    .split(" ")
    .filter(Boolean),
);

/**
 * How much of the intended script made it into the delivered transcript:
 * the percentage of the script's distinct content words (≥3 letters,
 * non-stopword) that appear anywhere in the transcript. Returns null when
 * no script was provided or there is too little content to judge. Sent to
 * the scorer as a measured signal for script-drift feedback.
 */
export function scriptCoveragePct(
  script: string,
  transcript: string,
): number | null {
  const source = script.trim();
  if (!source) return null;
  const scriptWords = source.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const content = [
    ...new Set(
      scriptWords.filter((w) => w.length > 2 && !SCRIPT_STOPWORDS.has(w)),
    ),
  ];
  if (content.length < 10) return null;
  const spoken = new Set(transcript.toLowerCase().match(/[a-z0-9']+/g) ?? []);
  const hit = content.filter((w) => spoken.has(w)).length;
  return Math.max(0, Math.min(100, Math.round((hit / content.length) * 100)));
}
