/**
 * Dual-rubric scoring engine — Verbal Delivery (50 pts) vs Non-Verbal
 * Communication (50 pts) — plus the dynamic aggregator and the quality
 * timeline (peak / dip / recovery / steady segments).
 *
 * Pure math + state machines: no React, no DOM, no MediaPipe types, so the
 * whole pipeline is unit-testable with Node. `use-telemetry` feeds it one
 * record per analysis frame (~4 Hz); the presentation page finalizes the
 * draft with the transcript (clarity + structure) and aggregates.
 *
 * Documented adaptations from the written spec:
 *  - Head-pose pitch sign is flipped: our `pitchDeg` is POSITIVE = looking
 *    down; the spec's θ_pitch is positive = looking up.
 *  - ASR/VAD are the app's own (Web Speech captions + RMS speech detector),
 *    not Whisper/YAMNet; analysis runs at 4 Hz (preview stays at display
 *    rate). Kinetic energy uses normalized image coords per hand sample as
 *    written, with the spec's raw bands (0.002–0.015 good, <0.0005 rigid,
 *    >0.0300 fidget).
 *  - EMA smoothing α = 0.15 on the geometry/affect streams (yaw, pitch,
 *    shoulder tilt, lean, smile, tension); Ke is already a spatial average
 *    over hand landmarks and is classified on the raw sample with a 1.5 s
 *    streak guard so genuine rigidity is detected promptly at our ~1.3 Hz
 *    hand cadence.
 */

// ---------------------------------------------------------------------------
// Constants — thresholds & calibration (spec values)
// ---------------------------------------------------------------------------

/** EMA smoothing factor for all geometry/affect signals. */
export const EMA_ALPHA = 0.15;

export const VERBAL_MAX = 50;
export const NONVERBAL_MAX = 50;

// Gaze / head orientation ----------------------------------------------------
const ENGAGE_YAW_DEG = 8;
const ENGAGE_PITCH_MIN_DEG = -10; // spec −5..10 (their sign) → ours flipped
const ENGAGE_PITCH_MAX_DEG = 5;
const SCRIPT_DROP_PITCH_DEG = 15; // ours: > +15° = looking down at notes
const SCRIPT_DROP_SEC = 2.0;
const FLOOR_STARE_YAW_DEG = 22;
const FLOOR_STARE_SEC = 1.5;
const GAZE_MAX = 15;
const GAZE_FLAG_PENALTY = 5;

// Facial affect (informational — the spec's matrix assigns no points) --------
const SMILE_THRESHOLD = 0.35;
const TENSION_THRESHOLD = 0.5;
const TENSION_SEC = 3.0;

// Posture --------------------------------------------------------------------
const SHOULDER_CENTERED_DEG = 5;
const SHOULDER_LEAN_FLAG_DEG = 8;
const SPINE_TILT_DEG = 10;
/**
 * Hardware-calibration bands — used when the presenter drives slides/clicks
 * from this device, so reaching for a keyboard or clicker stays "centered".
 */
const DEVICE_CENTERED_TILT_DEG = 10;
const DEVICE_SPINE_TILT_DEG = 15;
const POSTURE_MAX = 20;
const POSTURE_FLAG_PENALTY = 5;
const SHOULDER_FLAG_SEC = 1.5;
/** Minimum seconds of face/body time before body metrics count as "measured". */
const MIN_VISION_SEC_FOR_SCORING = 2.0;

// Hand kinetics (normalized image coords per hand sample) --------------------
const KE_RIGID = 0.0005;
const KE_GOOD_MIN = 0.002;
const KE_GOOD_MAX = 0.015;
const KE_FIDGET = 0.03;
const KE_FLAG_SEC = 1.5;
const KINETIC_MAX = 15;
const KINETIC_FLAG_PENALTY = 5;

// Pacing ---------------------------------------------------------------------
const WPM_TARGET_MIN = 130;
const WPM_TARGET_MAX = 160;
const WPM_FAST = 185;
const PACE_MAX = 15;
const PACE_FLAG_PENALTY = 5;
const WPM_WINDOW_MS = 15_000;
const WPM_WINDOW_MIN_SPEAKING_SEC = 3;

// Pauses ---------------------------------------------------------------------
const STRATEGIC_PAUSE_MIN_S = 1.0;
const STRATEGIC_PAUSE_MAX_S = 3.0;
const AWKWARD_PAUSE_S = 3.5;
const PAUSE_MAX = 10;
const PAUSE_FLAG_PENALTY = 5;

// Content clarity & structure (transcript) -----------------------------------
const CLARITY_MAX = 15;
const STRUCTURE_MAX = 10;
const VERBAL_CONTENT_MIN_WORDS = 10;

// Aggregator / timeline -------------------------------------------------------
const FRAME_GAP_MAX_SEC = 0.5;
const TIMELINE_MIN_SEGMENT_SEC = 10;
const TIMELINE_MAX_SEGMENTS = 8;
const PEAK_THRESHOLD = 80;
const DIP_THRESHOLD = 60;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** `mm:ss` formatter for timeline timestamps. */
export function mmss(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

/** Exponential moving average (α = 0.15); the first sample seeds the state. */
export function createEma(alpha: number = EMA_ALPHA): (value: number) => number {
  let prev: number | null = null;
  return (value: number) => {
    prev = prev === null ? value : prev + alpha * (value - prev);
    return prev;
  };
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? [];
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RubricStatus = "ok" | "SKIPPED";

/** One scored line inside a rubric card (always displayed as earned / max). */
export interface RubricRow {
  id: string;
  label: string;
  max: number;
  earned: number;
}

export interface RubricFlag {
  label: string;
  /** Points removed from this rubric by the flag (0 = informational note). */
  penalty: number;
}

export interface RubricResult {
  status: RubricStatus;
  /** Earned points 0..max, or null when the engine had no input (SKIPPED). */
  score: number | null;
  max: number;
  /** Human copy shown when `status === "SKIPPED"`. */
  message?: string;
  rows: RubricRow[];
  flags: RubricFlag[];
}

export type SegmentStatus = "peak" | "dip" | "recovery" | "steady";

export interface QualitySegment {
  /** `mm:ss` from session start — the moment this segment turns on. */
  timestamp: string;
  /** Segment start in seconds (used for click-to-seek; additive to the JSON). */
  atSec: number;
  score: number;
  /** Wire field name matches the report schema: `status`. */
  status: SegmentStatus;
  title: string;
  analysis: string;
}

/** Telemetry-only result from the hook; content rows are added later. */
export interface DualRubricDraft {
  nonVerbal: RubricResult;
  verbalBase: {
    paceEarned: number;
    pauseEarned: number;
    flags: RubricFlag[];
    /** Estimated words from voiced speech (fallback when captions are empty). */
    estimatedWords: number;
    hasAudio: boolean;
    /** True only when there was real audio timing to measure pace/pauses. */
    hasAudioTiming: boolean;
    speakingSec: number;
  };
  timeline: QualitySegment[];
  durationSec: number;
}

export interface DualRubricReport {
  verbal: RubricResult;
  nonVerbal: RubricResult;
  /**
   * 0–100, normalized across the engines that actually had input — but ONLY
   * when both engines scored. When speech or the camera was missing the run
   * is not honestly scorable: finalScore is null and insufficientReason
   * explains why (never rescale the remaining half to look like a full
   * score).
   */
  finalScore: number | null;
  /** Why finalScore is null (empty when the score is valid). */
  insufficientReason: string | null;
  timeline: QualitySegment[];
}

/** Per-frame input — everything the hook can observe at ~4 Hz. */
export interface DualFrameInput {
  tMs: number;
  /** Raw head pose (our sign: pitch > 0 = looking down). null = no face. */
  yawDeg: number | null;
  pitchDeg: number | null;
  shoulderTiltDeg: number | null;
  leanDeg: number | null;
  /** Blendshape averages 0–1. */
  smile: number | null;
  tension: number | null;
  /** Kinetic energy for this hand sample (null when hands weren't analyzed). */
  kinetic: number | null;
  speaking: boolean;
  /** Cumulative estimated words + spoken seconds so far (for the WPM window). */
  wordsCum: number;
  speakingSecCum: number;
}

// ---------------------------------------------------------------------------
// Dynamic aggregator — averages ONLY active engines, normalizes to 0–100
// ---------------------------------------------------------------------------

/**
 * Equivalent to the four-branch spec (`both → sum`, `one → /50*100`,
 * `none → 0`) collapsed into one formula and clamped, so a drifting subscore
 * can never emit >100 or <0.
 */
export function aggregateFinalScore(
  verbal: { active: boolean; score: number },
  nonVerbal: { active: boolean; score: number },
): number {
  const v = verbal.active ? clamp(verbal.score, 0, VERBAL_MAX) : 0;
  const n = nonVerbal.active ? clamp(nonVerbal.score, 0, NONVERBAL_MAX) : 0;
  const measurable =
    (verbal.active ? VERBAL_MAX : 0) + (nonVerbal.active ? NONVERBAL_MAX : 0);
  return measurable > 0 ? Math.round(((v + n) / measurable) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Transcript content scoring (clarity + structure)
// ---------------------------------------------------------------------------

/** Plain-language clarity, 0–15: filler density + sentence length. */
export function scoreClarity(transcript: string): number {
  const words = wordsOf(transcript);
  if (words.length < VERBAL_CONTENT_MIN_WORDS) return 0;
  const sentences = sentencesOf(transcript);
  const fillers =
    transcript.match(/\b(um+|uh+|erm+|hmm+)\b|you know|kind of|sort of/gi)
      ?.length ?? 0;
  const fillersPer100 = (fillers / words.length) * 100;
  const avgSentence = words.length / Math.max(1, sentences.length);

  let earned = CLARITY_MAX;
  if (fillersPer100 > 4) {
    earned -= Math.min(9, Math.round((fillersPer100 - 4) * 1.5));
  }
  if (avgSentence > 28) {
    earned -= Math.min(6, Math.round((avgSentence - 28) / 3));
  }
  return clamp(earned, 0, CLARITY_MAX);
}

/** Opening preview + closing summary detection, 0–10 (5 each). */
export function scoreStructure(transcript: string): number {
  const words = wordsOf(transcript);
  if (words.length < VERBAL_CONTENT_MIN_WORDS) return 0;
  const sentences = sentencesOf(transcript);
  const head = sentences.slice(0, 3).join(" ");
  const tail = sentences.slice(-3).join(" ");
  const open = /\b(today|agenda|overview|roadmap|i will|i'?ll|we will|we'?ll|let'?s (start|begin)|my goal|first)\b/i.test(
    head,
  );
  const close = /\b(recap|summary|summarize|thank you|thanks|questions|next steps|in closing|to close|in summary)\b/i.test(
    tail,
  );
  return (open ? 5 : 0) + (close ? 5 : 0);
}

// ---------------------------------------------------------------------------
// Quality timeline
// ---------------------------------------------------------------------------

type KeBand = "rigid" | "neutral" | "good" | "fidget";

interface TimelineSample {
  tMs: number;
  /** Blended 0–1 quality for this frame (active components only). */
  q: number;
  engage: 0 | 1 | null;
  posture: 0 | 1 | null;
  kinetic: KeBand | null;
  wpm: number | null;
  speaking: boolean;
}

interface SegmentStats {
  score: number;
  wpmAvg: number | null;
  engageRatio: number | null;
  postureRatio: number | null;
  kineticRatio: number | null;
  rigidShare: number;
  fidgetShare: number;
  speakingShare: number;
}

const COMPONENT_WEIGHTS = {
  engage: 0.35,
  posture: 0.25,
  kinetic: 0.2,
  pace: 0.2,
} as const;

function statsOf(samples: TimelineSample[]): SegmentStats {
  let qSum = 0;
  let wpmSum = 0;
  let wpmN = 0;
  let engageGood = 0;
  let engageN = 0;
  let postGood = 0;
  let postN = 0;
  let keGood = 0;
  let keN = 0;
  let rigid = 0;
  let fidget = 0;
  let speaking = 0;
  for (const s of samples) {
    qSum += s.q;
    if (s.speaking) speaking += 1;
    if (s.engage !== null) {
      engageN += 1;
      engageGood += s.engage;
    }
    if (s.posture !== null) {
      postN += 1;
      postGood += s.posture;
    }
    if (s.kinetic !== null) {
      keN += 1;
      if (s.kinetic === "good") keGood += 1;
      if (s.kinetic === "rigid") rigid += 1;
      if (s.kinetic === "fidget") fidget += 1;
    }
    if (s.wpm !== null && s.speaking) {
      wpmSum += s.wpm;
      wpmN += 1;
    }
  }
  return {
    score: samples.length > 0 ? Math.round((qSum / samples.length) * 100) : 0,
    wpmAvg: wpmN > 0 ? Math.round(wpmSum / wpmN) : null,
    engageRatio: engageN > 0 ? engageGood / engageN : null,
    postureRatio: postN > 0 ? postGood / postN : null,
    kineticRatio: keN > 0 ? keGood / keN : null,
    rigidShare: keN > 0 ? rigid / keN : 0,
    fidgetShare: keN > 0 ? fidget / keN : 0,
    speakingShare: samples.length > 0 ? speaking / samples.length : 0,
  };
}

/** Component that lost the most weighted points in this segment. */
function weakestComponent(
  stats: SegmentStats,
): keyof typeof COMPONENT_WEIGHTS | null {
  const candidates: Array<[keyof typeof COMPONENT_WEIGHTS, number]> = [];
  if (stats.engageRatio !== null) {
    candidates.push(["engage", 1 - stats.engageRatio]);
  }
  if (stats.postureRatio !== null) {
    candidates.push(["posture", 1 - stats.postureRatio]);
  }
  if (stats.kineticRatio !== null) {
    candidates.push(["kinetic", 1 - stats.kineticRatio]);
  }
  if (stats.wpmAvg !== null && stats.speakingShare > 0.2) {
    const inBand =
      stats.wpmAvg >= WPM_TARGET_MIN && stats.wpmAvg <= WPM_TARGET_MAX;
    candidates.push(["pace", inBand ? 0 : 1]);
  }
  const ranked = candidates
    .map(([key, loss]) => [key, loss * COMPONENT_WEIGHTS[key]] as const)
    .sort((a, b) => b[1] - a[1]);
  return ranked.length > 0 && ranked[0]![1] > 0.04 ? ranked[0]![0] : null;
}

function describeSegment(stats: SegmentStats): { title: string; analysis: string } {
  const pct = (r: number | null) => (r === null ? 0 : Math.round(r * 100));
  const worst = weakestComponent(stats);

  if (worst !== null) {
    switch (worst) {
      case "pace":
        if (stats.wpmAvg !== null && stats.wpmAvg > WPM_FAST) {
          return {
            title: "Pacing Spike",
            analysis: `Your pace jumped to ${stats.wpmAvg} WPM here. Take a breath before you move to the next point.`,
          };
        }
        return {
          title: "Pacing Dip",
          analysis: `Your pace drifted to about ${stats.wpmAvg ?? "—"} WPM, below the 130 to 160 sweet spot. Add a little energy.`,
        };
      case "engage":
        return {
          title: "Focus Drift",
          analysis: `You faced your audience for only ${pct(stats.engageRatio)}% of this stretch. Glances at notes are fine, then look back sooner.`,
        };
      case "posture":
        return {
          title: "Posture Dip",
          analysis: `You stayed upright for only ${pct(stats.postureRatio)}% of this stretch. Roll your shoulders back and reset.`,
        };
      case "kinetic":
        return stats.rigidShare >= stats.fidgetShare
          ? {
              title: "Hands Went Still",
              analysis:
                "Your hands froze here. Keep them moving naturally so you stay dynamic.",
            }
          : {
              title: "Fidgeting Spike",
              analysis:
                "Your hands moved too fast here. Slow the gestures down and make each one deliberate.",
            };
      default:
        break;
    }
  }

  if (stats.score <= DIP_THRESHOLD) {
    return {
      title: "Quality Dip",
      analysis: `This stretch scored ${stats.score}/100. Several signals dipped together. Reset before the next section.`,
    };
  }
  // Strong / ordinary stretch — describe what worked, with real numbers.
  if (stats.wpmAvg !== null && stats.speakingShare > 0.2) {
    return {
      title: stats.score >= PEAK_THRESHOLD ? "Clear Delivery" : "Steady Pacing",
      analysis:
        stats.score >= PEAK_THRESHOLD
          ? `Steady pace (${stats.wpmAvg} WPM) with ${pct(stats.engageRatio)}% audience orientation.`
          : `Pace held around ${stats.wpmAvg} WPM with consistent flow.`,
    };
  }
  if (stats.score >= PEAK_THRESHOLD) {
    return {
      title: "Strong Audience Presence",
      analysis: `${pct(stats.engageRatio)}% audience orientation with upright posture and controlled gestures.`,
    };
  }
  return {
    title: "Consistent Flow",
    analysis: `Posture and gestures stayed in the controlled band (engaged ${pct(stats.engageRatio)}% of the stretch).`,
  };
}

function buildTimeline(
  samples: TimelineSample[],
  durationSec: number,
): QualitySegment[] {
  if (samples.length === 0 || durationSec <= 0) return [];
  const segments = clamp(
    Math.floor(durationSec / TIMELINE_MIN_SEGMENT_SEC),
    1,
    TIMELINE_MAX_SEGMENTS,
  );
  const startMs = samples[0]!.tMs;
  const endMs = Math.max(samples[samples.length - 1]!.tMs, startMs + 1);
  const buckets: TimelineSample[][] = Array.from({ length: segments }, () => []);
  for (const s of samples) {
    const frac = (s.tMs - startMs) / (endMs - startMs);
    const idx = clamp(Math.floor(frac * segments), 0, segments - 1);
    buckets[idx]!.push(s);
  }

  const out: QualitySegment[] = [];
  let prevStatus: SegmentStatus | null = null;
  buckets.forEach((bucket) => {
    if (bucket.length === 0) return;
    const stats = statsOf(bucket);
    let status: SegmentStatus;
    if (stats.score <= DIP_THRESHOLD) status = "dip";
    else if (stats.score >= PEAK_THRESHOLD) {
      status = prevStatus === "dip" ? "recovery" : "peak";
    } else status = "steady";
    prevStatus = status;
    const { title, analysis } = describeSegment(stats);
    const atSec = (bucket[0]!.tMs - startMs) / 1000;
    out.push({
      timestamp: mmss(atSec),
      atSec: round1(atSec),
      score: stats.score,
      status,
      title,
      analysis,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Accumulator — folds per-frame telemetry into the two rubric scores
// ---------------------------------------------------------------------------

export class DualRubricAccumulator {
  private readonly startedAtMs: number;
  /** Hardware calibration: device interaction is never a posture/fidget fault. */
  private readonly ignoreDevice: boolean;
  /** Posture mode — sitting excludes stance/leg cues (not in this matrix,
   *  but the flag tells the user their choice was applied). */
  private postMode: "sitting" | "standing" = "standing";
  private lastMs: number | null = null;
  private pausesMs: number[] = [];

  // EMA-smoothed geometry / affect signals (α = 0.15).
  private readonly emaYaw = createEma();
  private readonly emaPitch = createEma();
  private readonly emaTilt = createEma();
  private readonly emaLean = createEma();
  private readonly emaSmile = createEma();
  private readonly emaTension = createEma();

  // Non-verbal accumulators.
  private headSec = 0;
  private engageSec = 0;
  private scriptStreakSec = 0;
  private scriptFlags = 0;
  private scriptFlagged = false;
  private stareStreakSec = 0;
  private stareFlags = 0;
  private stareFlagged = false;
  private affectSec = 0;
  private smileSec = 0;
  private tensionStreakSec = 0;
  private tensionNoted = false;
  private postureSec = 0;
  private centeredSec = 0;
  private shoulderStreakSec = 0;
  private shoulderFlags = 0;
  private shoulderFlagged = false;
  private keSec = 0;
  private keGoodSec = 0;
  private rigidStreakSec = 0;
  private rigidFlags = 0;
  private rigidFlagged = false;
  private fidgetStreakSec = 0;
  private fidgetFlags = 0;
  private fidgetFlagged = false;

  // Verbal — pacing.
  private paceSamples = 0;
  private paceInBandSec = 0;
  private paceSecTotal = 0;
  private fastStreakSec = 0;
  private fastFlags = 0;
  private fastFlagged = false;
  private speakingSec = 0;
  private maxWords = 0;
  private window: Array<{ tMs: number; words: number; speakingSec: number }> =
    [];

  // Timeline.
  private samples: TimelineSample[] = [];
  private lastKeMs: number | null = null;

  /**
   * @param options.ignoreDeviceInteraction Hardware calibration switch — the
   * presenter is driving slides/clicks from this machine, so keyboard and
   * clicker movements must not be scored as negative posture or fidgeting.
   */
  constructor(
    startedAtMs: number,
    options: { ignoreDeviceInteraction?: boolean } = {},
  ) {
    this.startedAtMs = startedAtMs;
    this.ignoreDevice = options.ignoreDeviceInteraction === true;
  }

  /** Pause durations (ms) transferred from the speech detector at finish. */
  setPauses(pausesMs: number[]): void {
    this.pausesMs = [...pausesMs];
  }

  /** Posture mode for this session — finish() notes the exclusion (P2). */
  setPostMode(mode: "sitting" | "standing"): void {
    this.postMode = mode;
  }

  feed(input: DualFrameInput): void {
    const dt =
      this.lastMs === null
        ? 0
        : clamp((input.tMs - this.lastMs) / 1000, 0, FRAME_GAP_MAX_SEC);
    this.lastMs = input.tMs;
    this.maxWords = Math.max(this.maxWords, input.wordsCum);

    // Gaze / head orientation (EMA-smoothed) -------------------------------
    let engage: 0 | 1 | null = null;
    if (input.yawDeg !== null && input.pitchDeg !== null) {
      const yaw = this.emaYaw(input.yawDeg);
      const pitch = this.emaPitch(input.pitchDeg);
      this.headSec += dt;
      const engaged =
        Math.abs(yaw) <= ENGAGE_YAW_DEG &&
        pitch >= ENGAGE_PITCH_MIN_DEG &&
        pitch <= ENGAGE_PITCH_MAX_DEG;
      if (engaged) this.engageSec += dt;
      engage = engaged ? 1 : 0;

      // Script/notes drop: looking DOWN past +15° (our sign) for ≥ 2 s.
      // Hardware calibration: glancing at this device's own keyboard/clicker
      // is legitimate interaction, so it never raises a script-drop flag.
      if (pitch > SCRIPT_DROP_PITCH_DEG && !this.ignoreDevice) {
        this.scriptStreakSec += dt;
        if (this.scriptStreakSec >= SCRIPT_DROP_SEC) {
          if (!this.scriptFlagged) {
            this.scriptFlagged = true;
            this.scriptFlags += 1;
          }
        }
      } else {
        if (this.scriptStreakSec >= SCRIPT_DROP_SEC) this.scriptFlagged = false;
        this.scriptStreakSec = 0;
      }

      // Floor/wall staring: |yaw| > 22° for ≥ 1.5 s.
      if (Math.abs(yaw) > FLOOR_STARE_YAW_DEG) {
        this.stareStreakSec += dt;
        if (this.stareStreakSec >= FLOOR_STARE_SEC && !this.stareFlagged) {
          this.stareFlagged = true;
          this.stareFlags += 1;
        }
      } else {
        if (this.stareStreakSec >= FLOOR_STARE_SEC) this.stareFlagged = false;
        this.stareStreakSec = 0;
      }
    }

    // Facial affect (informational rows — no matrix points) ------------------
    if (input.smile !== null || input.tension !== null) {
      this.affectSec += dt;
      if (input.smile !== null) {
        const smile = this.emaSmile(input.smile);
        if (smile > SMILE_THRESHOLD) this.smileSec += dt;
      }
      if (input.tension !== null) {
        const tension = this.emaTension(input.tension);
        if (tension > TENSION_THRESHOLD) {
          this.tensionStreakSec += dt;
          if (this.tensionStreakSec >= TENSION_SEC && !this.tensionNoted) {
            this.tensionNoted = true;
          }
        } else {
          this.tensionStreakSec = 0;
        }
      }
    }
    // Posture (shoulder tilt + spine lean from the pose engine) --------------
    let posture: 0 | 1 | null = null;
    if (input.shoulderTiltDeg !== null && input.leanDeg !== null) {
      const tilt = this.emaTilt(input.shoulderTiltDeg);
      const lean = this.emaLean(input.leanDeg);
      this.postureSec += dt;
      // Hardware calibration relaxes the "centered" band (driving a keyboard
      // or clicker leans the body) and disables asymmetric-lean flags.
      const centered =
        Math.abs(tilt) <
          (this.ignoreDevice ? DEVICE_CENTERED_TILT_DEG : SHOULDER_CENTERED_DEG) &&
        Math.abs(lean) <
          (this.ignoreDevice ? DEVICE_SPINE_TILT_DEG : SPINE_TILT_DEG);
      if (centered) this.centeredSec += dt;
      posture = centered ? 1 : 0;

      if (!this.ignoreDevice && Math.abs(tilt) > SHOULDER_LEAN_FLAG_DEG) {
        this.shoulderStreakSec += dt;
        if (this.shoulderStreakSec >= SHOULDER_FLAG_SEC && !this.shoulderFlagged) {
          this.shoulderFlagged = true;
          this.shoulderFlags += 1;
        }
      } else {
        if (this.shoulderStreakSec >= SHOULDER_FLAG_SEC) {
          this.shoulderFlagged = false;
        }
        this.shoulderStreakSec = 0;
      }
    }

    // Hand kinetics (raw Ke bands — already an N-sample spatial average) -----
    let kinetic: KeBand | null = null;
    if (input.kinetic !== null) {
      const keDt =
        this.lastKeMs === null
          ? 0
          : clamp((input.tMs - this.lastKeMs) / 1000, 0, 1.5);
      this.lastKeMs = input.tMs;
      if (keDt > 0) {
        const ke = input.kinetic;
        this.keSec += keDt;
        if (this.ignoreDevice) {
          // Hardware calibration: keyboard/clicker movement is intentional
          // interaction — count it as controlled hand dynamics and never as
          // a fidget/rigidity fault.
          this.keGoodSec += keDt;
          kinetic = "good";
        } else if (ke >= KE_GOOD_MIN && ke <= KE_GOOD_MAX) {
          this.keGoodSec += keDt;
          kinetic = "good";
        } else if (ke < KE_RIGID) {
          kinetic = "rigid";
        } else if (ke > KE_FIDGET) {
          kinetic = "fidget";
        } else {
          kinetic = "neutral";
        }

        if (kinetic === "rigid") {
          this.rigidStreakSec += keDt;
          if (this.rigidStreakSec >= KE_FLAG_SEC && !this.rigidFlagged) {
            this.rigidFlagged = true;
            this.rigidFlags += 1;
          }
          this.fidgetStreakSec = 0;
          this.fidgetFlagged = false;
        } else if (kinetic === "fidget") {
          this.fidgetStreakSec += keDt;
          if (this.fidgetStreakSec >= KE_FLAG_SEC && !this.fidgetFlagged) {
            this.fidgetFlagged = true;
            this.fidgetFlags += 1;
          }
          this.rigidStreakSec = 0;
          this.rigidFlagged = false;
        } else {
          if (this.rigidStreakSec >= KE_FLAG_SEC) this.rigidFlagged = false;
          if (this.fidgetStreakSec >= KE_FLAG_SEC) this.fidgetFlagged = false;
          this.rigidStreakSec = 0;
          this.fidgetStreakSec = 0;
        }
      }
    }

    // Pacing — windowed WPM(t) over the trailing 15 s of speech --------------
    let wpm: number | null = null;
    if (input.speaking) this.speakingSec += dt;
    this.window.push({
      tMs: input.tMs,
      words: input.wordsCum,
      speakingSec: input.speakingSecCum,
    });
    while (
      this.window.length > 1 &&
      input.tMs - this.window[0]!.tMs > WPM_WINDOW_MS
    ) {
      this.window.shift();
    }
    if (input.speaking) {
      const oldest = this.window[0]!;
      const speakDelta = input.speakingSecCum - oldest.speakingSec;
      const wordDelta = input.wordsCum - oldest.words;
      if (speakDelta >= WPM_WINDOW_MIN_SPEAKING_SEC) {
        wpm = (wordDelta / (speakDelta / 60));
      }
      if (wpm !== null && wpm > 0) {
        this.paceSamples += 1;
        this.paceSecTotal += dt;
        if (wpm >= WPM_TARGET_MIN && wpm <= WPM_TARGET_MAX) {
          this.paceInBandSec += dt;
        }
        if (wpm > WPM_FAST) {
          this.fastStreakSec += dt;
          if (this.fastStreakSec >= 2 && !this.fastFlagged) {
            this.fastFlagged = true;
            this.fastFlags += 1;
          }
        } else {
          if (this.fastStreakSec >= 2) this.fastFlagged = false;
          this.fastStreakSec = 0;
        }
      }
    }

    // Timeline sample — quality blended across ACTIVE components only ---------
    const comps: Array<[number, number]> = [];
    if (engage !== null) comps.push([engage, COMPONENT_WEIGHTS.engage]);
    if (posture !== null) comps.push([posture, COMPONENT_WEIGHTS.posture]);
    if (kinetic !== null) {
      const v = kinetic === "good" ? 1 : kinetic === "neutral" ? 0.5 : 0;
      comps.push([v, COMPONENT_WEIGHTS.kinetic]);
    }
    if (wpm !== null) {
      const inBand = wpm >= WPM_TARGET_MIN && wpm <= WPM_TARGET_MAX ? 1 : 0;
      comps.push([inBand, COMPONENT_WEIGHTS.pace]);
    }
    if (comps.length > 0) {
      const wSum = comps.reduce((s, [, w]) => s + w, 0);
      const q = comps.reduce((s, [v, w]) => s + v * w, 0) / wSum;
      this.samples.push({
        tMs: input.tMs,
        q,
        engage,
        posture,
        kinetic,
        wpm,
        speaking: input.speaking,
      });
    }
  }

  /**
   * Snapshot the draft (idempotent). `pausesMs` overrides the stored pause
   * list so the hook can pass the live speech detector's durations.
   */
  finish(pausesMs?: number[]): DualRubricDraft {
    const pauses = pausesMs ?? this.pausesMs;
    const durationSec =
      this.lastMs === null ? 0 : (this.lastMs - this.startedAtMs) / 1000;

    // --- Non-verbal matrix (gaze 15 + posture 20 + kinetic 15 = 50) ---------
    let nonVerbal: RubricResult;
    // A couple of stray frames isn't a measurement. Require a floor of vision
    // time before scoring the body, otherwise report "not enough data" (never 0).
    const hasVision =
      this.headSec >= MIN_VISION_SEC_FOR_SCORING ||
      this.postureSec >= MIN_VISION_SEC_FOR_SCORING;
    if (!hasVision) {
      const sawCamera = this.headSec > 0 || this.postureSec > 0;
      nonVerbal = {
        status: "SKIPPED",
        score: null,
        max: NONVERBAL_MAX,
        message: sawCamera
          ? "The camera only caught a fleeting glimpse — not enough body data to score."
          : "Camera off, so body scoring was skipped",
        rows: [],
        flags: [],
      };
    } else {
      const rows: RubricRow[] = [];
      const flags: RubricFlag[] = [];
      let presentMax = 0;
      let presentEarned = 0;

      if (this.headSec > 0) {
        const ratio = clamp(this.engageSec / this.headSec, 0, 1);
        const earned = clamp(
          Math.round(
            GAZE_MAX * ratio -
              GAZE_FLAG_PENALTY * this.scriptFlags -
              GAZE_FLAG_PENALTY * this.stareFlags,
          ),
          0,
          GAZE_MAX,
        );
        rows.push({ id: "gaze", label: "Gaze & orientation", max: GAZE_MAX, earned });
        presentMax += GAZE_MAX;
        presentEarned += earned;
        if (this.scriptFlags > 0) {
          flags.push({
            label: `Looked down at notes, over ${SCRIPT_DROP_PITCH_DEG}° for ${SCRIPT_DROP_SEC}s (x${this.scriptFlags})`,
            penalty: GAZE_FLAG_PENALTY,
          });
        }
        if (this.stareFlags > 0) {
          flags.push({
            label: `Looked away at the floor or wall (x${this.stareFlags})`,
            penalty: GAZE_FLAG_PENALTY,
          });
        }
      }

      if (this.postureSec > 0) {
        const ratio = clamp(this.centeredSec / this.postureSec, 0, 1);
        const earned = clamp(
          Math.round(POSTURE_MAX * ratio - POSTURE_FLAG_PENALTY * this.shoulderFlags),
          0,
          POSTURE_MAX,
        );
        rows.push({ id: "posture", label: "Posture & alignment", max: POSTURE_MAX, earned });
        presentMax += POSTURE_MAX;
        presentEarned += earned;
        if (this.shoulderFlags > 0) {
          flags.push({
            label: `Leaned to one side, shoulder roll over ${SHOULDER_LEAN_FLAG_DEG}° (x${this.shoulderFlags})`,
            penalty: POSTURE_FLAG_PENALTY,
          });
        }
      }

      if (this.keSec > 0) {
        const ratio = clamp(this.keGoodSec / this.keSec, 0, 1);
        const earned = clamp(
          Math.round(
            KINETIC_MAX * ratio -
              KINETIC_FLAG_PENALTY * this.rigidFlags -
              KINETIC_FLAG_PENALTY * this.fidgetFlags,
          ),
          0,
          KINETIC_MAX,
        );
        rows.push({ id: "kinetic", label: "Hand dynamics", max: KINETIC_MAX, earned });
        presentMax += KINETIC_MAX;
        presentEarned += earned;
        if (this.rigidFlags > 0) {
          flags.push({
            label: `Arms stayed frozen (x${this.rigidFlags})`,
            penalty: KINETIC_FLAG_PENALTY,
          });
        }
        if (this.fidgetFlags > 0) {
          flags.push({
            label: `Fast hand fidgeting (x${this.fidgetFlags})`,
            penalty: KINETIC_FLAG_PENALTY,
          });
        }
      }

      // Informational affect notes (the spec assigns no matrix points here).
      if (this.affectSec > 0 && this.tensionNoted) {
        flags.push({ label: "Tension visible (brow down / jaw clenched)", penalty: 0 });
      }
      if (this.affectSec > 0 && this.smileSec / this.affectSec >= 0.5) {
        flags.push({ label: "Positive warmth (relaxed smile most of the run)", penalty: 0 });
      }
      if (this.ignoreDevice) {
        flags.push({
          label: "Hardware mode on: keyboard and clicker moves are excluded from posture and fidget scoring",
          penalty: 0,
        });
      }
      if (this.postMode === "sitting") {
        flags.push({
          label: "Sitting mode on: stance, pacing and leg-movement cues excluded from scoring",
          penalty: 0,
        });
      }

      const score =
        presentMax > 0
          ? clamp(Math.round((presentEarned / presentMax) * NONVERBAL_MAX), 0, NONVERBAL_MAX)
          : 0;
      nonVerbal = { status: "ok", score, max: NONVERBAL_MAX, rows, flags };
    }

    // --- Verbal base (pacing 15 + pauses 10; content rows come later) -------
    const paceRatio =
      this.paceSecTotal > 0 ? this.paceInBandSec / this.paceSecTotal : 0;
    const paceEarned = clamp(
      Math.round(PACE_MAX * paceRatio - PACE_FLAG_PENALTY * this.fastFlags),
      0,
      PACE_MAX,
    );
    const strategicPauses = pauses.filter(
      (p) => p >= STRATEGIC_PAUSE_MIN_S * 1000 && p <= STRATEGIC_PAUSE_MAX_S * 1000,
    ).length;
    const awkwardPauses = pauses.filter((p) => p > AWKWARD_PAUSE_S * 1000).length;
    const pauseEarned = strategicPauses > 0 ? PAUSE_MAX : 0;

    const verbalFlags: RubricFlag[] = [];
    if (this.fastFlags > 0) {
      verbalFlags.push({
        label: `Spoke too fast, over ${WPM_FAST} WPM (x${this.fastFlags})`,
        penalty: PACE_FLAG_PENALTY,
      });
    }
    if (awkwardPauses > 0) {
      verbalFlags.push({
        label: `Awkward silence > ${AWKWARD_PAUSE_S}s (×${awkwardPauses})`,
        penalty: PAUSE_FLAG_PENALTY,
      });
    }

    return {
      nonVerbal,
      verbalBase: {
        paceEarned,
        pauseEarned,
        flags: verbalFlags,
        estimatedWords: Math.round(this.maxWords),
        hasAudio: this.speakingSec > 0 || this.maxWords > 0,
        /** Pace/pauses are only meaningful with real audio timing to measure. */
        hasAudioTiming: this.paceSecTotal > 0 || pauses.length > 0,
        speakingSec: round1(this.speakingSec),
      },
      timeline: buildTimeline(this.samples, durationSec),
      durationSec: round1(durationSec),
    };
  }
}

// ---------------------------------------------------------------------------
// Finalizer — adds transcript content rows and aggregates the final score
// ---------------------------------------------------------------------------

/**
 * Turns the hook's telemetry draft into the full dual-rubric report:
 * clarity (15) + structure (10) come from the transcript, both rubrics are
 * normalized (0–50 each) and the aggregator produces the 0–100 final score.
 */
export function finalizeDualRubric(
  draft: DualRubricDraft,
  transcript: string,
): DualRubricReport {
  const base = draft.verbalBase;
  const transcriptWords = wordsOf(transcript).length;
  const activeWords = Math.max(transcriptWords, base.estimatedWords);
  const hasTranscript = transcriptWords >= VERBAL_CONTENT_MIN_WORDS;

  let verbal: RubricResult;
  if (activeWords < VERBAL_CONTENT_MIN_WORDS || (!base.hasAudio && !hasTranscript)) {
    verbal = {
      status: "SKIPPED",
      score: null,
      max: VERBAL_MAX,
      message: "No speech detected, so the speaking score was skipped",
      rows: [],
      flags: [],
    };
  } else if (hasTranscript) {
    const rows: RubricRow[] = [];
    // Pace/pauses only count when there was real audio timing to measure them.
    // With a transcript but no mic timing, score content alone and renormalize
    // rather than handing out hard zeros for data we never captured.
    const paceRows: RubricRow[] = base.hasAudioTiming
      ? [
          { id: "pacing", label: "Pacing (130–160 WPM)", max: PACE_MAX, earned: base.paceEarned },
          { id: "pauses", label: "Strategic pauses (1–3 s)", max: PAUSE_MAX, earned: base.pauseEarned },
        ]
      : [];
    const contentRows: RubricRow[] = [
      { id: "clarity", label: "Plain-language clarity", max: CLARITY_MAX, earned: scoreClarity(transcript) },
      { id: "structure", label: "Opening & closing structure", max: STRUCTURE_MAX, earned: scoreStructure(transcript) },
    ];
    rows.push(...paceRows, ...contentRows);
    const measuredMax = paceRows.reduce((s, r) => s + r.max, 0) + CLARITY_MAX + STRUCTURE_MAX;
    const raw = rows.reduce((s, r) => s + r.earned, 0);
    const score =
      measuredMax > 0
        ? clamp(Math.round((raw / measuredMax) * VERBAL_MAX), 0, VERBAL_MAX)
        : 0;
    const flags: RubricFlag[] = [...base.flags];
    if (!base.hasAudioTiming) {
      flags.push({
        label: "No usable mic audio, so pacing and pauses were not measured",
        penalty: 0,
      });
    }
    verbal = { status: "ok", score, max: VERBAL_MAX, rows, flags };
  } else {
    // No transcript text (STT unsupported / script empty): score the
    // telemetry-only half (pacing + pauses, max 25) and renormalize to 50 so
    // a caption-less run is never capped at half credit.
    const raw = base.paceEarned + base.pauseEarned;
    const rows: RubricRow[] = [
      { id: "pacing", label: "Pacing (130–160 WPM)", max: PACE_MAX, earned: base.paceEarned },
      { id: "pauses", label: "Strategic pauses (1–3 s)", max: PAUSE_MAX, earned: base.pauseEarned },
    ];
    verbal = {
      status: "ok",
      score: clamp(Math.round((raw / (PACE_MAX + PAUSE_MAX)) * VERBAL_MAX), 0, VERBAL_MAX),
      max: VERBAL_MAX,
      rows,
      flags: [
        ...base.flags,
        { label: "No transcript, so clarity and structure were not scored", penalty: 0 },
      ],
    };
  }

  const verbalOk = verbal.status === "ok";
  const nonVerbalOk = draft.nonVerbal.status === "ok";

  // #11 — never rescale a single active engine into a headline score: if
  // speech or the camera is missing there is "not enough data to score".
  const reasons: string[] = [];
  if (!verbalOk) {
    reasons.push(
      verbal.message ?? "No speech was detected, so the speaking score was skipped.",
    );
  }
  if (!nonVerbalOk) {
    reasons.push(
      draft.nonVerbal.message ??
        "The camera was off, so body scoring was skipped.",
    );
  }
  const sufficient = verbalOk && nonVerbalOk;
  const finalScore = sufficient
    ? aggregateFinalScore(
        { active: true, score: verbal.score ?? 0 },
        { active: true, score: draft.nonVerbal.score ?? 0 },
      )
    : null;

  return {
    verbal,
    nonVerbal: draft.nonVerbal,
    finalScore,
    insufficientReason: sufficient ? null : reasons.join(" "),
    timeline: draft.timeline,
  };
}









