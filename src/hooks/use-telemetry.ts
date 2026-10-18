"use client";

/**
 * Phase 2 — MediaPipe telemetry + local audio engine.
 *
 * This hook owns the whole measurement pipeline:
 *
 *  1. Camera/microphone acquisition (getUserMedia).
 *  2. MediaPipe task loading (Pose 33 joints, Face 478 points + 52
 *     blendshapes, Hands 21 joints per hand) on top of the shared wasm
 *     fileset served from the jsDelivr CDN.
 *  3. A throttled (~4 FPS) analysis loop that runs MediaPipe tasks and computes
 *     the mathematical telemetry described below.
 *  4. A Web Audio pipeline (AudioContext + AnalyserNode) that measures
 *     speech dynamics (RMS thresholding → WPM / pauses) and pitch dynamics
 *     (autocorrelation → rolling standard deviation) entirely on-device.
 *
 * Results are published two ways:
 *   - `frameRef`  — latest frame (landmarks + metrics) for canvas drawing,
 *                   updated every processed frame (no React re-render).
 *   - `telemetry` — throttled React state (~4 Hz) for status badges.
 *
 * All calculations run locally; nothing is uploaded and no model/API tokens
 * are spent.
 */

import * as React from "react";
import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import type {
  FaceLandmarkerResult,
  NormalizedLandmark,
  PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { DualRubricAccumulator } from "@/lib/dual-rubric";
import type { DualRubricDraft } from "@/lib/dual-rubric";
import { PostureModeDetector, resolvePostureMode } from "@/lib/posture-mode";
import { getPosturePreference } from "@/lib/prefs-store";

// ---------------------------------------------------------------------------
// Constants — CDN / model configuration
// ---------------------------------------------------------------------------

/**
 * Self-hosted MediaPipe runtime (P3): the Emscripten glue JS
 * (`vision_wasm_internal.js`) and the `.wasm` binary are copied verbatim
 * from the installed `@mediapipe/tasks-vision` package into
 * `public/mediapipe/wasm`, so first load needs no CDN and the glue/wasm
 * pair always matches the package build (an unversioned CDN `latest` can
 * pair a stale cached glue file with a newer wasm and throw
 * `wasmExports.ud is not a function`).
 * Keep the copy in sync with the `@mediapipe/tasks-vision` version in
 * package.json (`cp -R node_modules/@mediapipe/tasks-vision/wasm public/mediapipe/wasm`).
 */
export const WASM_ROOT = "/mediapipe/wasm";

/** Weights self-hosted in `public/mediapipe/models` (download once at build/clone). */
const POSE_MODEL_URL = "/mediapipe/models/pose_landmarker_full.task";
const FACE_MODEL_URL = "/mediapipe/models/face_landmarker.task";
const HAND_MODEL_URL = "/mediapipe/models/hand_landmarker.task";

/** `WasmFileset` is not exported by the package, so derive it from the API. */
type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

// ---------------------------------------------------------------------------
// Constants — landmark indices (MediaPipe topology)
// ---------------------------------------------------------------------------

/** BlazePose 33-joint indices used by the telemetry maths. */
const POSE_INDEX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

/** Face mesh (478-point model, indices 468–477 are the iris rings). */
const FACE_INDEX = {
  noseTip: 1,
  forehead: 10,
  chin: 152,
  leftFaceEdge: 234,
  rightFaceEdge: 454,
  /** Eye corner pairs (image order is resolved at runtime). */
  eyeA: [33, 133],
  eyeB: [362, 263],
  /** Upper/lower lid points used for eye aperture height. */
  eyeALids: [159, 145],
  eyeBLids: [386, 374],
  /** Iris rings — 5 landmarks each, averaged to the iris centre. */
  irisA: [468, 469, 470, 471, 472],
  irisB: [473, 474, 475, 476, 477],
} as const;

// ---------------------------------------------------------------------------
// Constants — thresholds & calibration
// ---------------------------------------------------------------------------

/** Frames per second of the analysis loop. Kept intentionally low (4 FPS)
 * so ML inference never starves the video preview — the <video> element
 * renders at display rate regardless. */
const TARGET_FPS = 4;
const MIN_FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
/** Run the (heavier) hand model every Nth analysis tick (~1.3 Hz). */
const HAND_ANALYSIS_EVERY = 3;
/** How often React state (`telemetry`) is refreshed. */
const PUBLISH_INTERVAL_MS = 250;

// Gaze -----------------------------------------------------------------
/** Full eye aperture (corner to corner) maps to ±15° of horizontal gaze. */
const EYE_HORIZONTAL_RANGE_DEG = 15;
/** Full eye aperture height maps to ±12° of vertical gaze. */
const EYE_VERTICAL_RANGE_DEG = 12;
/** Off-camera flag threshold (spec: > 12°). */
const GAZE_OFF_CAMERA_DEG = 12;
/** "Turned back to the screen" flag threshold (spec: |yaw| > 25°). */
const HEAD_YAW_SCREEN_DEG = 25;

// Head pose -------------------------------------------------------------
/**
 * Calibration model (see computeHeadPose): the nose tip sits about
 * `NOSE_AXIS_RATIO * faceWidth` in front of the head's rotation axis, so a
 * yaw of θ shifts it sideways by sin(θ) · NOSE_AXIS_RATIO · faceWidth.
 */
const NOSE_AXIS_RATIO = 0.6;
/** Ratio (nose − eye line) / (chin − eye line) on a neutral head. */
const NEUTRAL_PITCH_RATIO = 0.417;
/** Approximate change of that ratio per degree of pitch. */
const PITCH_RATIO_PER_DEG = 0.0045;

// Posture ---------------------------------------------------------------
const MAX_LEAN_DEG = 10;
const MAX_SHOULDER_TILT_DEG = 8;

// Arms ------------------------------------------------------------------
/** A wrist is "crossed" when the opposing shoulder is closer than
 * `ARM_CROSS_RATIO` × its own-shoulder distance (and within one shoulder
 * width of it). */
const ARM_CROSS_RATIO = 0.9;

// Speaker's box ---------------------------------------------------------
/** Box top: shoulder line + 20 % of torso length (upper chest). */
const BOX_TOP_TORSO_RATIO = 0.2;
/** Box bottom: hip line + 5 % of torso length (belt line). */
const BOX_BOTTOM_TORSO_RATIO = 0.05;
/** Horizontal padding beyond the shoulder points. */
const BOX_SIDE_PAD_RATIO = 0.1;
/** A hand counts as "inside" when ≥ 70 % of its 21 landmarks are inside. */
const HAND_INSIDE_FRACTION = 0.7;

// Movement --------------------------------------------------------------
const MOVEMENT_WINDOW_MS = 4000;
const MOVEMENT_MAX_SAMPLES = 60; // 15 s @ 4 FPS (window trims by time)
/** Net lateral shift that counts as a deliberate step. */
const STEP_THRESHOLD = 0.035;
/** Path length needed (with enough direction changes) to call it swaying. */
const SWAY_PATH_THRESHOLD = 0.04;
/** ≥ 6 half-cycles in the 4 s window (~0.75 Hz) = nervous swaying. */
const SWAY_HALF_CYCLES = 6;
/** Per-frame x delta below this is treated as tracking noise. */
const MOTION_DEADBAND = 0.0015;

// Audio -----------------------------------------------------------------
const ANALYSER_FFT_SIZE = 2048;
/** Absolute RMS floor for speech (below typical mic noise). */
const AUDIO_MIN_RMS = 0.01;
/** Noise-floor EMA is only adapted while nobody is speaking. */
const NOISE_FLOOR_ADAPT = 0.03;
const RMS_THRESHOLD_GAIN = 2.5;
const RMS_THRESHOLD_BIAS = 0.004;
const RMS_ENTER_FACTOR = 1.2;
/** ~250 ms of loud audio at 4 FPS before we flip to "speaking". */
const SPEECH_ATTACK_FRAMES = 1;
/** ~500 ms of quiet audio before we flip back to "silent". */
const SPEECH_RELEASE_FRAMES = 2;
/** Average English articulation rate used to estimate word counts. */
const WORDS_PER_SECOND = 2.5;
/** Pauses shorter than this are breaths, longer ones are "breaks". */
const MIN_PAUSE_MS = 300;
const MAX_PAUSE_MS = 10_000;
/** Pitch detection range for speech. */
const PITCH_MIN_HZ = 70;
const PITCH_MAX_HZ = 400;
/** Normalized autocorrelation peak required to trust an F0 estimate. */
const PITCH_MIN_CONFIDENCE = 0.3;
/** Rolling window + minimum voiced frames before reporting a σ. */
const PITCH_WINDOW_MS = 5000;
const PITCH_MIN_SAMPLES = 10;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LandmarkConnection = { start: number; end: number };

export type TelemetryStatus = "idle" | "starting" | "running" | "error";

export type MovementState = "steady" | "stepping" | "swaying";

/** Normalized (0–1) rectangle in video-frame coordinates. */
export interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PostureMetrics {
  /** Positive = leaning image-right, in degrees from vertical. */
  leanDeg: number;
  shoulderTiltDeg: number;
  good: boolean;
}

export interface ArmMetrics {
  crossed: boolean;
  /** Distance to the opposing shoulder divided by shoulder width. */
  ratio: number;
}

export interface HeadPoseMetrics {
  yawDeg: number;
  /** Positive = looking down. */
  pitchDeg: number;
  rollDeg: number;
  facingScreen: boolean;
}

export interface GazeMetrics {
  /** Combined horizontal/vertical iris deviation, in degrees. */
  deviationDeg: number;
  eyeContact: boolean;
}

export interface BoxMetrics {
  rect: BoxRect;
  handsTotal: number;
  handsInside: number;
  /** null when no hands are visible. */
  inside: boolean | null;
}

export interface MovementMetrics {
  state: MovementState;
  netDisplacement: number;
  pathLength: number;
  frequencyHz: number;
}

export interface AudioMetrics {
  available: boolean;
  speaking: boolean;
  rms: number;
  /** Estimated words ÷ elapsed session minutes (pauses included). */
  wpm: number;
  speakingSec: number;
  currentPauseSec: number;
  avgPauseSec: number;
  longestPauseSec: number;
  /** Instantaneous F0 (null when unvoiced). */
  pitchHz: number | null;
  /** Rolling standard deviation of F0 over the last few seconds. */
  pitchStdDevHz: number | null;
}

export interface TelemetryMetrics {
  timestampMs: number;
  fps: number;
  detected: { pose: boolean; face: boolean; hands: number };
  posture: PostureMetrics | null;
  arms: ArmMetrics | null;
  head: HeadPoseMetrics | null;
  gaze: GazeMetrics | null;
  box: BoxMetrics | null;
  movement: MovementMetrics;
  audio: AudioMetrics;
}

/** Frame payload consumed by the canvas renderer (updated every frame). */
export interface TelemetryFrame {
  timestampMs: number;
  pose: NormalizedLandmark[] | null;
  face: NormalizedLandmark[] | null;
  hands: NormalizedLandmark[][];
  metrics: TelemetryMetrics;
}

export interface UseTelemetryOptions {
  /** Flip to true to request camera/mic and start the pipeline. */
  enabled?: boolean;
  /** Set false to skip microphone capture entirely. */
  audio?: boolean;
  /**
   * Starts (and keeps) the microphone track disabled — toggling at runtime
   * only flips `track.enabled`, so the camera session and its session
   * summary are never restarted.
   */
  muted?: boolean;
  /**
   * Hardware calibration — the presenter drives slides/clicks from this
   * device, so keyboard/clicker movements are excluded from posture &
   * fidget scoring in the dual-rubric engine.
   */
  ignoreDeviceInteraction?: boolean;
}

export interface MotionSample {
  t: number;
  x: number;
}

// ---------------------------------------------------------------------------
// Session aggregation (the summary consumed by the evaluation API)
// ---------------------------------------------------------------------------

export type SessionEventKind =
  | "posture_violation"
  | "gaze_off_camera"
  | "turned_away"
  | "arms_crossed"
  | "hands_outside_box"
  | "swaying"
  | "stepping";

/** A timestamped telemetry episode used as evaluation evidence. */
export interface SessionEvent {
  kind: SessionEventKind;
  startMs: number;
  endMs: number;
}

export interface SessionSummary {
  startedAtMs: number;
  durationSec: number;
  totalFrames: number;
  avgFps: number;
  /**
   * Resolved posture mode — explicit user choice or auto-detected from
   * lower-body landmark visibility. "sitting" tells every scorer to skip
   * stance, walking-pacing and leg-movement cues (P2).
   */
  postMode: "sitting" | "standing";
  posture: {
    goodSec: number;
    violationSec: number;
    violationEvents: number;
    avgLeanDeg: number;
    maxAbsLeanDeg: number;
  };
  gaze: {
    onCameraSec: number;
    offCameraSec: number;
    offCameraEvents: number;
    turnedAwaySec: number;
    turnedAwayEvents: number;
    avgDeviationDeg: number | null;
  };
  arms: { crossedSec: number; crossedEvents: number };
  box: {
    insideSec: number;
    outsideSec: number;
    outsideEvents: number;
    visibleSec: number;
  };
  movement: {
    steadySec: number;
    swayingSec: number;
    swayingEvents: number;
    steps: number;
  };
  audio: {
    speakingSec: number;
    speechSegments: number;
    longestPauseSec: number;
    avgPauseSec: number;
    estimatedWpm: number;
    pitchStdDevHz: number | null;
    avgPitchHz: number | null;
  };
  /** Chronological evidence windows (capped for prompt size). */
  events: SessionEvent[];
}

/** Cap on evidence windows kept for prompt assembly. */
const MAX_SESSION_EVENTS = 300;
/** Inactive frames below this gap belong to the same episode. */
const EVENT_CLOSE_GRACE_MS = 1000;
/** Episodes must be at least this far apart to count separately. */
const EVENT_COUNT_DEBOUNCE_MS = 3000;
/** Longest plausible gap between recorded frames (tab switches etc.). */
const MAX_FRAME_GAP_SEC = 0.5;

/**
 * Pure aggregator that folds per-frame {@link TelemetryMetrics} into a
 * session summary: durations, debounced event counts, timestamped evidence
 * windows and audio statistics. Kept free of React/DOM so it can be unit
 * tested; the hook owns one instance per camera session.
 */
export class SessionAccumulator {
  private readonly startedAtMs: number;
  private stoppedAtMs: number | null = null;
  private lastMs: number | null = null;

  private totalFrames = 0;
  private fpsSum = 0;
  private fpsCount = 0;

  private events: SessionEvent[] = [];
  private openEvents = new Map<SessionEventKind, SessionEvent>();
  private activeState = new Map<SessionEventKind, boolean>();
  private pendingClose = new Map<SessionEventKind, number>();
  private lastCountedAt = new Map<SessionEventKind, number>();

  private postureGoodSec = 0;
  private postureViolationSec = 0;
  private postureViolationEvents = 0;
  private leanSum = 0;
  private leanCount = 0;
  private maxAbsLeanDeg = 0;

  private gazeOnSec = 0;
  private gazeOffSec = 0;
  private gazeOffEvents = 0;
  private turnedAwaySec = 0;
  private turnedAwayEvents = 0;
  private devSum = 0;
  private devCount = 0;

  private armsCrossedSec = 0;
  private armsCrossedEvents = 0;

  private boxInsideSec = 0;
  private boxOutsideSec = 0;
  private boxOutsideEvents = 0;
  private boxVisibleSec = 0;

  private steadySec = 0;
  private swayingSec = 0;
  private swayingEvents = 0;
  private steps = 0;

  private speakingSec = 0;
  private speechSegments = 0;
  private lastSegmentStartMs = -Infinity;
  private wasSpeaking = false;
  private longestPauseSec = 0;
  private avgPauseSec = 0;
  private estimatedWpm = 0;
  private pitchStdDevHz: number | null = null;
  private pitchSum = 0;
  private pitchCount = 0;

  constructor(startedAtMs: number) {
    this.startedAtMs = startedAtMs;
  }

  /** Freezes the duration (called when the camera session stops). */
  stop(nowMs: number): void {
    this.stoppedAtMs ??= nowMs;
  }

  /**
   * Tracks a boolean telemetry signal as an evidence window: opens a window
   * on the rising edge (count debounced to 3 s), extends it while active and
   * closes it after a 1 s grace period so one-frame flickers stay one episode.
   */
  private flag(
    kind: SessionEventKind,
    activeNow: boolean,
    nowMs: number,
    countEvents: boolean,
  ): void {
    const wasActive = this.activeState.get(kind) ?? false;
    this.activeState.set(kind, activeNow);
    const open = this.openEvents.get(kind);

    if (activeNow) {
      this.pendingClose.delete(kind);
      if (!open && this.events.length < MAX_SESSION_EVENTS) {
        const event: SessionEvent = { kind, startMs: nowMs, endMs: nowMs };
        this.events.push(event);
        this.openEvents.set(kind, event);
      } else if (open) {
        open.endMs = nowMs;
      }
      const rising = !wasActive;
      if (rising && countEvents) {
        const lastCounted = this.lastCountedAt.get(kind);
        if (
          lastCounted === undefined ||
          nowMs - lastCounted >= EVENT_COUNT_DEBOUNCE_MS
        ) {
          this.lastCountedAt.set(kind, nowMs);
          this.bumpCount(kind);
        }
      }
      return;
    }

    // Falling edge: close after the grace window so micro-flickers merge.
    if (!open) return;
    const closingAt = this.pendingClose.get(kind);
    if (closingAt === undefined) {
      this.pendingClose.set(kind, nowMs);
    } else if (nowMs - closingAt > EVENT_CLOSE_GRACE_MS) {
      this.pendingClose.delete(kind);
      this.openEvents.delete(kind);
    }
  }

  private bumpCount(kind: SessionEventKind): void {
    switch (kind) {
      case "posture_violation":
        this.postureViolationEvents += 1;
        break;
      case "gaze_off_camera":
        this.gazeOffEvents += 1;
        break;
      case "turned_away":
        this.turnedAwayEvents += 1;
        break;
      case "arms_crossed":
        this.armsCrossedEvents += 1;
        break;
      case "hands_outside_box":
        this.boxOutsideEvents += 1;
        break;
      case "swaying":
        this.swayingEvents += 1;
        break;
      case "stepping":
        this.steps += 1;
        break;
    }
  }

  record(metrics: TelemetryMetrics, nowMs: number): void {
    const dt =
      this.lastMs === null
        ? 0
        : Math.min(
            Math.max((nowMs - this.lastMs) / 1000, 0),
            MAX_FRAME_GAP_SEC,
          );
    this.lastMs = nowMs;
    this.totalFrames += 1;
    if (metrics.fps > 0) {
      this.fpsSum += metrics.fps;
      this.fpsCount += 1;
    }

    // Posture ---------------------------------------------------------------
    if (metrics.posture) {
      const { leanDeg, good } = metrics.posture;
      this.leanSum += leanDeg;
      this.leanCount += 1;
      this.maxAbsLeanDeg = Math.max(this.maxAbsLeanDeg, Math.abs(leanDeg));
      if (good) {
        this.postureGoodSec += dt;
        this.flag("posture_violation", false, nowMs, false);
      } else {
        this.postureViolationSec += dt;
        this.flag("posture_violation", true, nowMs, true);
      }
    } else {
      this.flag("posture_violation", false, nowMs, false);
    }

    // Gaze / head orientation ------------------------------------------------
    if (metrics.gaze) {
      const onCamera = metrics.gaze.eyeContact;
      this.devSum += metrics.gaze.deviationDeg;
      this.devCount += 1;
      if (onCamera) {
        this.gazeOnSec += dt;
      } else {
        this.gazeOffSec += dt;
      }
      this.flag("gaze_off_camera", !onCamera, nowMs, true);
    }
    if (metrics.head) {
      const facing = metrics.head.facingScreen;
      if (!facing) this.turnedAwaySec += dt;
      this.flag("turned_away", !facing, nowMs, true);
    }

    // Arms ------------------------------------------------------------------
    if (metrics.arms) {
      if (metrics.arms.crossed) this.armsCrossedSec += dt;
      this.flag("arms_crossed", metrics.arms.crossed, nowMs, true);
    }

    // Speaker's box ---------------------------------------------------------
    if (metrics.box && metrics.box.inside !== null) {
      this.boxVisibleSec += dt;
      if (metrics.box.inside) {
        this.boxInsideSec += dt;
        this.flag("hands_outside_box", false, nowMs, false);
      } else {
        this.boxOutsideSec += dt;
        this.flag("hands_outside_box", true, nowMs, true);
      }
    } else {
      this.flag("hands_outside_box", false, nowMs, false);
    }

    // Movement --------------------------------------------------------------
    const movement = metrics.movement.state;
    if (movement === "steady") this.steadySec += dt;
    if (movement === "swaying") {
      this.swayingSec += dt;
      this.flag("swaying", true, nowMs, true);
    } else {
      this.flag("swaying", false, nowMs, false);
    }
    if (movement === "stepping") {
      // Steps are instantaneous: open then close on the same frame.
      this.flag("stepping", true, nowMs, true);
      this.flag("stepping", false, nowMs, false);
    }

    // Audio -----------------------------------------------------------------
    const audio = metrics.audio;
    if (audio.available) {
      if (audio.speaking) {
        this.speakingSec += dt;
        if (!this.wasSpeaking && nowMs - this.lastSegmentStartMs >= 1500) {
          this.speechSegments += 1;
          this.lastSegmentStartMs = nowMs;
        }
      }
      this.wasSpeaking = audio.speaking;
      this.longestPauseSec = Math.max(
        this.longestPauseSec,
        audio.currentPauseSec,
      );
      this.avgPauseSec = audio.avgPauseSec;
      this.estimatedWpm = audio.wpm;
      if (audio.pitchStdDevHz !== null) {
        this.pitchStdDevHz = audio.pitchStdDevHz;
      }
      if (audio.pitchHz !== null) {
        this.pitchSum += audio.pitchHz;
        this.pitchCount += 1;
      }
    }
  }

  /** Builds an immutable summary; `nowMs` only matters for live sessions. */
  snapshot(nowMs: number): SessionSummary {
    const endMs = this.stoppedAtMs ?? nowMs;
    const durationSec = Math.max(0, (endMs - this.startedAtMs) / 1000);
    return {
      startedAtMs: this.startedAtMs,
      durationSec: round2(durationSec),
      totalFrames: this.totalFrames,
      avgFps: this.fpsCount > 0 ? round1(this.fpsSum / this.fpsCount) : 0,
      // Placeholder — getSessionSummary() overwrites this with the resolved
      // user/auto posture mode from the landmark-visibility detector.
      postMode: "standing",
      posture: {
        goodSec: round2(this.postureGoodSec),
        violationSec: round2(this.postureViolationSec),
        violationEvents: this.postureViolationEvents,
        avgLeanDeg:
          this.leanCount > 0 ? round1(this.leanSum / this.leanCount) : 0,
        maxAbsLeanDeg: round1(this.maxAbsLeanDeg),
      },
      gaze: {
        onCameraSec: round2(this.gazeOnSec),
        offCameraSec: round2(this.gazeOffSec),
        offCameraEvents: this.gazeOffEvents,
        turnedAwaySec: round2(this.turnedAwaySec),
        turnedAwayEvents: this.turnedAwayEvents,
        avgDeviationDeg:
          this.devCount > 0 ? round1(this.devSum / this.devCount) : null,
      },
      arms: {
        crossedSec: round2(this.armsCrossedSec),
        crossedEvents: this.armsCrossedEvents,
      },
      box: {
        insideSec: round2(this.boxInsideSec),
        outsideSec: round2(this.boxOutsideSec),
        outsideEvents: this.boxOutsideEvents,
        visibleSec: round2(this.boxVisibleSec),
      },
      movement: {
        steadySec: round2(this.steadySec),
        swayingSec: round2(this.swayingSec),
        swayingEvents: this.swayingEvents,
        steps: this.steps,
      },
      audio: {
        speakingSec: round2(this.speakingSec),
        speechSegments: this.speechSegments,
        longestPauseSec: round2(this.longestPauseSec),
        avgPauseSec: round2(this.avgPauseSec),
        estimatedWpm: Math.round(this.estimatedWpm),
        pitchStdDevHz:
          this.pitchStdDevHz !== null ? round1(this.pitchStdDevHz) : null,
        avgPitchHz:
          this.pitchCount > 0 ? round1(this.pitchSum / this.pitchCount) : null,
      },
      events: this.events.map((event) => ({ ...event })),
    };
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}





// ---------------------------------------------------------------------------
// Small maths helpers
// ---------------------------------------------------------------------------

function dist2D(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function centroid(points: Array<{ x: number; y: number }>): {
  x: number;
  y: number;
} {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Pose landmarks carry a `visibility` score; face/hand landmarks do not
 * meaningfully use it, so default to fully visible there. */
function visible(landmark: NormalizedLandmark | undefined): boolean {
  return !!landmark && (landmark.visibility ?? 1) >= 0.5;
}

// ---------------------------------------------------------------------------
// Telemetry maths — posture
// ---------------------------------------------------------------------------

/**
 * Torso lean: angle of the shoulder-midpoint → hip-midpoint vector against
 * the vertical axis. Shoulder tilt: angle of the shoulder line itself.
 * Posture is "good" while both stay within their comfort cones.
 */
export function computePosture(
  pose: NormalizedLandmark[] | null,
): PostureMetrics | null {
  if (!pose) return null;
  const ls = pose[POSE_INDEX.leftShoulder];
  const rs = pose[POSE_INDEX.rightShoulder];
  const lh = pose[POSE_INDEX.leftHip];
  const rh = pose[POSE_INDEX.rightHip];
  if (!visible(ls) || !visible(rs) || !visible(lh) || !visible(rh)) return null;

  const shoulderMid = midpoint(ls, rs);
  const hipMid = midpoint(lh, rh);

  const vertical = hipMid.y - shoulderMid.y; // positive (image y grows down)
  if (vertical <= 1e-6) return null;

  const leanDeg = toDeg(
    Math.atan2(shoulderMid.x - hipMid.x, vertical),
  );
  const shoulderTiltDeg = Math.abs(
    toDeg(Math.atan2(rs.y - ls.y, rs.x - ls.x)),
  );

  return {
    leanDeg,
    shoulderTiltDeg,
    good:
      Math.abs(leanDeg) <= MAX_LEAN_DEG &&
      shoulderTiltDeg <= MAX_SHOULDER_TILT_DEG,
  };
}

// ---------------------------------------------------------------------------
// Telemetry maths — arm crossing
// ---------------------------------------------------------------------------

/**
 * Arm crossing: for each visible wrist compare its distance to the *opposing*
 * shoulder against its distance to its *own* shoulder. When the opposing
 * shoulder wins (by a 10 % margin) and is within one shoulder width, the arm
 * has crossed the body midline. `ratio` normalises the closest opposing
 * distance by the shoulder width so the value is view independent.
 */
export function computeArmCrossing(
  pose: NormalizedLandmark[] | null,
): ArmMetrics | null {
  if (!pose) return null;
  const ls = pose[POSE_INDEX.leftShoulder];
  const rs = pose[POSE_INDEX.rightShoulder];
  const lw = pose[POSE_INDEX.leftWrist];
  const rw = pose[POSE_INDEX.rightWrist];
  if (!visible(ls) || !visible(rs)) return null;

  const shoulderWidth = dist2D(ls, rs);
  if (shoulderWidth <= 1e-6) return null;

  const checks: Array<{ own: number; opposite: number }> = [];
  if (visible(lw)) {
    checks.push({ own: dist2D(lw, ls), opposite: dist2D(lw, rs) });
  }
  if (visible(rw)) {
    checks.push({ own: dist2D(rw, rs), opposite: dist2D(rw, ls) });
  }
  if (checks.length === 0) return null;

  let crossed = false;
  let minOpposite = Number.POSITIVE_INFINITY;
  for (const { own, opposite } of checks) {
    if (opposite < own * ARM_CROSS_RATIO && opposite < shoulderWidth) {
      crossed = true;
    }
    minOpposite = Math.min(minOpposite, opposite);
  }

  return { crossed, ratio: minOpposite / shoulderWidth };
}

// ---------------------------------------------------------------------------
// Telemetry maths — head pose (Euler angles) & eye gaze
// ---------------------------------------------------------------------------

/**
 * Head Euler angles estimated from the 478-point face mesh.
 *
 * Yaw: a head yawed by θ projects its nose tip (≈ NOSE_AXIS_RATIO ·
 * faceWidth ahead of the rotation axis) sideways by sin(θ) · ratio ·
 * faceWidth, so θ = asin(noseOffset / (ratio · faceWidth)).
 *
 * Pitch: the (nose − eye line) / (chin − eye line) ratio changes nearly
 * linearly with pitch (~0.0045 / degree around neutral), so pitch is the
 * deviation from the neutral ratio scaled by that constant. Positive =
 * looking down.
 *
 * Roll: angle of the line connecting the two eye centres.
 */
export function computeHeadPose(
  face: NormalizedLandmark[] | null,
): HeadPoseMetrics | null {
  if (!face || face.length <= FACE_INDEX.chin) return null;
  const nose = face[FACE_INDEX.noseTip];
  const chin = face[FACE_INDEX.chin];
  const forehead = face[FACE_INDEX.forehead];
  const edgeL = face[FACE_INDEX.leftFaceEdge];
  const edgeR = face[FACE_INDEX.rightFaceEdge];
  const eyeAC0 = face[FACE_INDEX.eyeA[0]];
  const eyeAC1 = face[FACE_INDEX.eyeA[1]];
  const eyeBC0 = face[FACE_INDEX.eyeB[0]];
  const eyeBC1 = face[FACE_INDEX.eyeB[1]];
  if (!nose || !chin || !forehead || !edgeL || !edgeR) return null;

  const faceWidth = dist2D(edgeL, edgeR);
  if (faceWidth <= 1e-6) return null;

  // Yaw ------------------------------------------------------------------
  const faceMidX = (edgeL.x + edgeR.x) / 2;
  const yawNorm = (nose.x - faceMidX) / faceWidth;
  const yawDeg = toDeg(
    Math.asin(clamp(yawNorm / NOSE_AXIS_RATIO, -1, 1)),
  );

  // Pitch ----------------------------------------------------------------
  const eyeMidY =
    eyeAC0 && eyeAC1 && eyeBC0 && eyeBC1
      ? (eyeAC0.y + eyeAC1.y + eyeBC0.y + eyeBC1.y) / 4
      : forehead.y;
  const eyeToChin = chin.y - eyeMidY;
  const pitchDeg =
    Math.abs(eyeToChin) <= 1e-6
      ? 0
      : clamp(
          ((nose.y - eyeMidY) / eyeToChin - NEUTRAL_PITCH_RATIO) /
            PITCH_RATIO_PER_DEG,
          -60,
          60,
        );

  // Roll -----------------------------------------------------------------
  let rollDeg = 0;
  if (eyeAC0 && eyeAC1 && eyeBC0 && eyeBC1) {
    const eyeA = midpoint(eyeAC0, eyeAC1);
    const eyeB = midpoint(eyeBC0, eyeBC1);
    rollDeg = toDeg(Math.atan2(eyeB.y - eyeA.y, eyeB.x - eyeA.x));
  }

  return {
    yawDeg,
    pitchDeg,
    rollDeg,
    facingScreen: Math.abs(yawDeg) <= HEAD_YAW_SCREEN_DEG,
  };
}

/** Averages the five iris-ring landmarks into the iris centre. */
function irisCentre(
  face: NormalizedLandmark[],
  ring: readonly number[],
): { x: number; y: number } | null {
  const points = ring
    .map((i) => face[i])
    .filter((p): p is NormalizedLandmark => !!p);
  return points.length === ring.length ? centroid(points) : null;
}

/**
 * Gaze estimation from iris position inside the eye aperture.
 *
 * The iris centre is projected onto the eye-corner axis → normalized
 * t ∈ [0, 1] (0.5 = straight ahead) and vertically onto the lid span.
 * A full corner-to-corner sweep corresponds to ±15° horizontally and
 * ±12° vertically, so the combined deviation angle is
 * hypot(h, v). Eye contact is flagged when it stays ≤ 12°.
 */
export function computeGaze(
  face: NormalizedLandmark[] | null,
): GazeMetrics | null {
  if (!face || face.length <= FACE_INDEX.irisB[4]) return null;

  const eyes: Array<{
    corners: [NormalizedLandmark, NormalizedLandmark];
    lids: [NormalizedLandmark, NormalizedLandmark];
    iris: readonly number[];
  }> = [
    {
      corners: [face[FACE_INDEX.eyeA[0]], face[FACE_INDEX.eyeA[1]]],
      lids: [face[FACE_INDEX.eyeALids[0]], face[FACE_INDEX.eyeALids[1]]],
      iris: FACE_INDEX.irisA,
    },
    {
      corners: [face[FACE_INDEX.eyeB[0]], face[FACE_INDEX.eyeB[1]]],
      lids: [face[FACE_INDEX.eyeBLids[0]], face[FACE_INDEX.eyeBLids[1]]],
      iris: FACE_INDEX.irisB,
    },
  ];

  const horizontal: number[] = [];
  const vertical: number[] = [];

  for (const eye of eyes) {
    if (eye.corners.some((c) => !c) || eye.lids.some((l) => !l)) continue;
    // Order corners left→right so both eyes share the same sign convention.
    const [a, b] =
      eye.corners[0].x <= eye.corners[1].x
        ? eye.corners
        : [eye.corners[1], eye.corners[0]];
    const iris = irisCentre(face, eye.iris);
    if (!iris) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 1e-8) continue;

    const t = ((iris.x - a.x) * dx + (iris.y - a.y) * dy) / lenSq;
    horizontal.push((t - 0.5) * 2 * EYE_HORIZONTAL_RANGE_DEG);

    const lidTop = eye.lids[0];
    const lidBottom = eye.lids[1];
    const eyeHeight = Math.abs(lidBottom.y - lidTop.y);
    if (eyeHeight <= 1e-6) continue;
    const lidMidY = (lidTop.y + lidBottom.y) / 2;
    const vNorm = (iris.y - lidMidY) / eyeHeight; // ≈ ±0.5
    vertical.push(vNorm * 2 * EYE_VERTICAL_RANGE_DEG);
  }

  if (horizontal.length === 0) return null;

  const avgH = horizontal.reduce((s, v) => s + v, 0) / horizontal.length;
  const avgV =
    vertical.length > 0
      ? vertical.reduce((s, v) => s + v, 0) / vertical.length
      : 0;
  const deviationDeg = Math.hypot(avgH, avgV);

  return {
    deviationDeg,
    eyeContact: deviationDeg <= GAZE_OFF_CAMERA_DEG,
  };
}

// ---------------------------------------------------------------------------
// Telemetry maths — speaker's box
// ---------------------------------------------------------------------------

/**
 * The "speaker's box" is the zone between the chest line and the belt line
 * (hips) and between the shoulders (plus a little padding). Hands raised
 * above the chest, dropped below the belt or swung outside the shoulders
 * read as fidgeting, so every detected hand is scored by the fraction of
 * its 21 landmarks that fall inside the rectangle.
 */
export function computeSpeakerBox(
  pose: NormalizedLandmark[] | null,
  hands: NormalizedLandmark[][],
): BoxMetrics | null {
  if (!pose) return null;
  const ls = pose[POSE_INDEX.leftShoulder];
  const rs = pose[POSE_INDEX.rightShoulder];
  const lh = pose[POSE_INDEX.leftHip];
  const rh = pose[POSE_INDEX.rightHip];
  if (!visible(ls) || !visible(rs) || !visible(lh) || !visible(rh)) return null;

  const shoulderMid = midpoint(ls, rs);
  const hipMid = midpoint(lh, rh);
  const torsoLength = dist2D(shoulderMid, hipMid);
  const shoulderWidth = dist2D(ls, rs);
  if (torsoLength <= 1e-6 || shoulderWidth <= 1e-6) return null;

  const top = shoulderMid.y + BOX_TOP_TORSO_RATIO * torsoLength;
  const bottom = hipMid.y + BOX_BOTTOM_TORSO_RATIO * torsoLength;
  const pad = BOX_SIDE_PAD_RATIO * shoulderWidth;
  const xMin = Math.min(ls.x, rs.x) - pad;
  const xMax = Math.max(ls.x, rs.x) + pad;

  const rect: BoxRect = {
    x: xMin,
    y: top,
    width: Math.max(0, xMax - xMin),
    height: Math.max(0, bottom - top),
  };

  let handsInside = 0;
  for (const hand of hands) {
    if (hand.length === 0) continue;
    let insideCount = 0;
    for (const p of hand) {
      if (
        p.x >= rect.x &&
        p.x <= rect.x + rect.width &&
        p.y >= rect.y &&
        p.y <= rect.y + rect.height
      ) {
        insideCount += 1;
      }
    }
    if (insideCount / hand.length >= HAND_INSIDE_FRACTION) {
      handsInside += 1;
    }
  }

  const handsTotal = hands.length;
  return {
    rect,
    handsTotal,
    handsInside,
    inside: handsTotal > 0 ? handsInside === handsTotal : null,
  };
}

// ---------------------------------------------------------------------------
// Telemetry maths — intentional movement vs nervous swaying
// ---------------------------------------------------------------------------

/**
 * Classifies lateral movement from a rolling window of hip-midpoint
 * x-samples (normalized frame coordinates):
 *
 *  - "stepping": the average hip position shifted by ≥ STEP_THRESHOLD —
 *    a deliberate lateral step to a new spot.
 *  - "swaying": little net shift but a long travel path with ≥ 6 direction
 *    changes in the 4 s window (~0.75 Hz) — classic nervous weight shifting.
 *  - "steady": everything else.
 *
 * A per-frame deadband keeps MediaPipe jitter from counting as motion.
 */
export function classifyMovement(
  samples: MotionSample[],
  nowMs: number,
): MovementMetrics {
  const windowStart = nowMs - MOVEMENT_WINDOW_MS;
  const inWindow = samples.filter((s) => s.t >= windowStart);
  if (inWindow.length < 2) {
    return { state: "steady", netDisplacement: 0, pathLength: 0, frequencyHz: 0 };
  }

  // Net displacement: mean of the first quarter vs mean of the last quarter.
  const quarter = Math.max(1, Math.floor(inWindow.length / 4));
  const firstSlice = inWindow.slice(0, quarter);
  const lastSlice = inWindow.slice(-quarter);
  const mean = (arr: MotionSample[]) =>
    arr.reduce((s, p) => s + p.x, 0) / arr.length;
  const netDisplacement = Math.abs(mean(lastSlice) - mean(firstSlice));

  // Path length + direction changes with noise deadband.
  let pathLength = 0;
  let halfCycles = 0;
  let lastSign = 0;
  for (let i = 1; i < inWindow.length; i += 1) {
    const delta = inWindow[i].x - inWindow[i - 1].x;
    if (Math.abs(delta) < MOTION_DEADBAND) continue;
    pathLength += Math.abs(delta);
    const sign = Math.sign(delta);
    if (lastSign !== 0 && sign !== lastSign) halfCycles += 1;
    lastSign = sign;
  }

  const spanMs = inWindow[inWindow.length - 1].t - inWindow[0].t;
  const frequencyHz =
    spanMs > 0 ? halfCycles / (2 * (spanMs / 1000)) : 0;

  let state: MovementState = "steady";
  if (netDisplacement >= STEP_THRESHOLD) {
    state = "stepping";
  } else if (pathLength >= SWAY_PATH_THRESHOLD && halfCycles >= SWAY_HALF_CYCLES) {
    state = "swaying";
  }

  return { state, netDisplacement, pathLength, frequencyHz };
}

// ---------------------------------------------------------------------------
// Audio engine part 1 — speech detection (RMS volume dynamics)
// ---------------------------------------------------------------------------

export interface SpeechSnapshot {
  speaking: boolean;
  rms: number;
  wpm: number;
  speakingSec: number;
  currentPauseSec: number;
  avgPauseSec: number;
  longestPauseSec: number;
}

/**
 * Pure speech/silence state machine fed with per-frame RMS values.
 *
 * The threshold adapts to the room: while silent, the noise floor is
 * tracked with an EMA and speech must exceed `gain · floor + bias`
 * (never below AUDIO_MIN_RMS) with attack/release hysteresis so a single
 * loud consonant doesn't flicker the state.
 *
 * Word counts are estimated from voiced duration at the average English
 * articulation rate (2.5 words/s) — WPM is that estimate divided by the
 * whole session time, so long pauses naturally lower the score. Pause
 * durations are measured between speech segments (0.3–10 s window).
 */
export class SpeechDetector {
  private noiseFloor = 0.005;
  private aboveFrames = 0;
  private belowFrames = 0;
  private speaking = false;
  private speechStartMs = 0;
  private pauseStartMs: number | null = null;
  private words = 0;
  private speakingMs = 0;
  private pauses: number[] = [];
  private readonly sessionStartMs: number;

  constructor(sessionStartMs: number) {
    this.sessionStartMs = sessionStartMs;
  }

  feed(rms: number, nowMs: number): void {
    if (!this.speaking) {
      // Adapt the noise floor only to quiet frames.
      this.noiseFloor =
        this.noiseFloor * (1 - NOISE_FLOOR_ADAPT) + rms * NOISE_FLOOR_ADAPT;
    }
    const threshold = Math.max(
      AUDIO_MIN_RMS,
      this.noiseFloor * RMS_THRESHOLD_GAIN + RMS_THRESHOLD_BIAS,
    );
    const loud = rms > threshold * RMS_ENTER_FACTOR;

    if (!this.speaking) {
      if (loud) {
        this.aboveFrames += 1;
        if (this.aboveFrames >= SPEECH_ATTACK_FRAMES) this.start(nowMs);
      } else {
        this.aboveFrames = 0;
      }
    } else if (loud) {
      this.belowFrames = 0;
    } else {
      this.belowFrames += 1;
      if (this.belowFrames >= SPEECH_RELEASE_FRAMES) this.end(nowMs);
    }
  }

  private start(nowMs: number): void {
    this.speaking = true;
    this.aboveFrames = 0;
    this.belowFrames = 0;
    this.speechStartMs = nowMs;
    if (this.pauseStartMs !== null) {
      const pause = nowMs - this.pauseStartMs;
      if (pause >= MIN_PAUSE_MS && pause <= MAX_PAUSE_MS) {
        this.pauses.push(pause);
      }
      this.pauseStartMs = null;
    }
  }

  private end(nowMs: number): void {
    const duration = nowMs - this.speechStartMs;
    this.speaking = false;
    this.aboveFrames = 0;
    this.belowFrames = 0;
    this.speakingMs += duration;
    this.words += (duration / 1000) * WORDS_PER_SECOND;
    this.pauseStartMs = nowMs;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  /** Completed pause durations (ms) — feeds dual-rubric pause scoring. */
  getPauses(): number[] {
    return [...this.pauses];
  }

  snapshot(rms: number, nowMs: number): SpeechSnapshot {
    const elapsedMin = (nowMs - this.sessionStartMs) / 60000;
    const pauses = this.pauses;
    return {
      speaking: this.speaking,
      rms,
      wpm: elapsedMin > 0 ? this.words / elapsedMin : 0,
      speakingSec: this.speakingMs / 1000,
      currentPauseSec:
        this.pauseStartMs !== null ? (nowMs - this.pauseStartMs) / 1000 : 0,
      avgPauseSec:
        pauses.length > 0
          ? pauses.reduce((s, p) => s + p, 0) / pauses.length / 1000
          : 0,
      longestPauseSec:
        pauses.length > 0 ? Math.max(...pauses) / 1000 : 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Audio engine part 2 — pitch tracking (autocorrelation)
// ---------------------------------------------------------------------------

/**
 * Normalized-autocorrelation F0 detector over a time-domain buffer.
 *
 * For every lag between PITCH_MAX_HZ and PITCH_MIN_HZ the correlation of
 * the signal with itself is divided by the energy of both segments
 * (an NSDF-style normalization) so harmonics don't bias the search toward
 * small lags. The best peak is refined with parabolic interpolation and
 * rejected below PITCH_MIN_CONFIDENCE.
 */
export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
): number | null {
  const n = buffer.length;
  if (n < 256) return null;

  // Remove DC offset.
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += buffer[i];
  mean /= n;

  const minLag = Math.max(2, Math.floor(sampleRate / PITCH_MAX_HZ));
  const maxLag = Math.min(
    Math.floor(sampleRate / PITCH_MIN_HZ),
    Math.floor(n / 2),
  );
  if (maxLag <= minLag) return null;

  let bestLag = -1;
  let bestScore = 0;
  const scores = new Float64Array(maxLag + 2);

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    let energyA = 0;
    let energyB = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i += 1) {
      const a = buffer[i] - mean;
      const b = buffer[i + lag] - mean;
      corr += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const denom = Math.sqrt(energyA * energyB);
    const score = denom > 1e-12 ? corr / denom : 0;
    scores[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestScore < PITCH_MIN_CONFIDENCE) return null;

  // Octave-error correction: a periodic signal correlates just as well at
  // 2·T, 3·T … so halve the lag while a peak nearly as strong exists there
  // (this recovers 220 Hz instead of reporting 110 Hz for pure tones).
  let selectedLag = bestLag;
  for (;;) {
    const lo = Math.max(minLag, Math.floor(selectedLag / 2) - 1);
    const hi = Math.min(maxLag, Math.ceil(selectedLag / 2) + 1);
    let halfLag = -1;
    let halfScore = bestScore * 0.9;
    for (let lag = lo; lag <= hi; lag += 1) {
      if (scores[lag] > halfScore) {
        halfScore = scores[lag];
        halfLag = lag;
      }
    }
    if (halfLag > 0 && halfLag < selectedLag) {
      selectedLag = halfLag;
    } else {
      break;
    }
  }

  // Parabolic refinement around the peak for sub-sample accuracy.
  let refinedLag = selectedLag;
  if (selectedLag > minLag && selectedLag < maxLag) {
    const prev = scores[selectedLag - 1];
    const next = scores[selectedLag + 1];
    const denom = prev - 2 * scores[selectedLag] + next;
    if (Math.abs(denom) > 1e-12) {
      refinedLag = selectedLag + (0.5 * (prev - next)) / denom;
    }
  }

  const hz = sampleRate / refinedLag;
  return hz >= PITCH_MIN_HZ && hz <= PITCH_MAX_HZ ? hz : null;
}

/**
 * Keeps the voiced F0 frames of the last few seconds and reports their
 * rolling standard deviation — a zero-cost proxy for vocal variety
 * (low σ ≈ monotone delivery).
 */
export class PitchTracker {
  private samples: Array<{ t: number; hz: number }> = [];

  push(t: number, hz: number): void {
    this.samples.push({ t, hz });
    this.prune(t);
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - PITCH_WINDOW_MS;
    while (this.samples.length > 0 && this.samples[0].t < cutoff) {
      this.samples.shift();
    }
  }

  latest(): number | null {
    return this.samples.length > 0
      ? this.samples[this.samples.length - 1].hz
      : null;
  }

  stdDev(nowMs: number): number | null {
    this.prune(nowMs);
    if (this.samples.length < PITCH_MIN_SAMPLES) return null;
    const mean =
      this.samples.reduce((s, p) => s + p.hz, 0) / this.samples.length;
    const variance =
      this.samples.reduce((s, p) => s + (p.hz - mean) ** 2, 0) /
      this.samples.length;
    return Math.sqrt(variance);
  }
}

// ---------------------------------------------------------------------------
// MediaPipe task loading (cached — wasm + models are fetched once per session)
// ---------------------------------------------------------------------------

let filesetPromise: Promise<WasmFileset> | undefined;
let poseTaskPromise: Promise<PoseLandmarker> | undefined;
let faceTaskPromise: Promise<FaceLandmarker> | undefined;
let handTaskPromise: Promise<HandLandmarker> | undefined;

function getFileset(): Promise<WasmFileset> {
  filesetPromise ??= FilesetResolver.forVisionTasks(WASM_ROOT).catch(
    (err: unknown) => {
      filesetPromise = undefined;
      throw err;
    },
  );
  return filesetPromise;
}

/** 33 body joints. */
function loadPoseLandmarker(): Promise<PoseLandmarker> {
  poseTaskPromise ??= getFileset()
    .then((fileset) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }),
    )
    .catch((err: unknown) => {
      poseTaskPromise = undefined;
      throw err;
    });
  return poseTaskPromise;
}

/** 478 mesh points + 52 blendshapes (eyebrows, eyes, jaw …). */
function loadFaceLandmarker(): Promise<FaceLandmarker> {
  faceTaskPromise ??= getFileset()
    .then((fileset) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: true,
      }),
    )
    .catch((err: unknown) => {
      faceTaskPromise = undefined;
      throw err;
    });
  return faceTaskPromise;
}

/** 21 joints per hand, up to two hands. */
function loadHandLandmarker(): Promise<HandLandmarker> {
  handTaskPromise ??= getFileset()
    .then((fileset) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }),
    )
    .catch((err: unknown) => {
      handTaskPromise = undefined;
      throw err;
    });
  return handTaskPromise;
}

// ---------------------------------------------------------------------------
// Web Audio — capture + per-frame RMS
// ---------------------------------------------------------------------------

export interface AudioEngine {
  /** Reads the current time-domain frame; returns RMS + a pitch estimate
   * (only when the signal is loud enough to be voiced). */
  read(): { rms: number; pitchHz: number | null };
  dispose(): void;
}

async function createAudioEngine(
  stream: MediaStream,
): Promise<AudioEngine> {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) throw new Error("Web Audio API is not supported in this browser.");
  const ctx = new Ctx();
  if (ctx.state === "suspended") await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = ANALYSER_FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  // Monitor-only: never connect to the destination (no feedback loop).
  source.connect(analyser);

  const buffer = new Float32Array(analyser.fftSize);

  return {
    read() {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
      const rms = Math.sqrt(sum / buffer.length);
      const pitchHz =
        rms > AUDIO_MIN_RMS * 1.5
          ? detectPitch(buffer, ctx.sampleRate)
          : null;
      return { rms, pitchHz };
    },
    dispose() {
      source.disconnect();
      analyser.disconnect();
      void ctx.close().catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * Starts camera + microphone (when `enabled`), loads the three MediaPipe
 * tasks and drives the throttled (~4 FPS) telemetry loop.
 *
 * @param videoRef  <video> element the camera stream is attached to.
 * @returns status/error, throttled `telemetry` state and `frameRef`
 *          (per-frame landmarks + metrics) for the canvas renderer.
 */
export function useTelemetry(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: UseTelemetryOptions = {},
): {
  status: TelemetryStatus;
  error: string | null;
  telemetry: TelemetryMetrics | null;
  frameRef: React.RefObject<TelemetryFrame | null>;
  getSessionSummary: () => SessionSummary | null;
  getDualRubricDraft: () => DualRubricDraft | null;
  getRecordingUrl: () => string | null;
} {
  const { enabled = false, audio = true, muted = false, ignoreDeviceInteraction = false } =
    options;
  const [status, setStatus] = React.useState<TelemetryStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [telemetry, setTelemetry] = React.useState<TelemetryMetrics | null>(
    null,
  );
  const frameRef = React.useRef<TelemetryFrame | null>(null);
  /** Session-wide aggregation for the evaluation API (kept after stop). */
  const accumulatorRef = React.useRef<SessionAccumulator | null>(null);
  /** Latest stream + mute state so muting never restarts the pipeline. */
  const streamRef = React.useRef<MediaStream | null>(null);
  const mutedRef = React.useRef(muted);
  /** Latest hardware-calibration choice (read when a session starts). */
  const ignoreDeviceRef = React.useRef(ignoreDeviceInteraction);
  React.useEffect(() => {
    ignoreDeviceRef.current = ignoreDeviceInteraction;
  }, [ignoreDeviceInteraction]);
  /** Dual-rubric engine, live speech detector, and replay recording. */
  const dualRef = React.useRef<DualRubricAccumulator | null>(null);
  /** Lower-body visibility tracker for sitting-mode auto-detection (P2). */
  const postureDetectorRef = React.useRef<PostureModeDetector | null>(null);
  const speechRef = React.useRef<SpeechDetector | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const recordingUrlRef = React.useRef<string | null>(null);

  const getSessionSummary = React.useCallback((): SessionSummary | null => {
    const accumulator = accumulatorRef.current;
    if (!accumulator) return null;
    const summary = accumulator.snapshot(performance.now());
    // User choice wins; otherwise auto-detect from landmark visibility.
    return {
      ...summary,
      postMode: resolvePostureMode(
        getPosturePreference(),
        postureDetectorRef.current,
      ),
    };
  }, []);

  // Apply mute changes to the live audio track (no camera restart).
  React.useEffect(() => {
    mutedRef.current = muted;
    streamRef.current
      ?.getAudioTracks()
      .forEach((track) => (track.enabled = !muted));
  }, [muted]);

  React.useEffect(() => {
    if (!enabled) return;

    // Captured for cleanup — `videoRef.current` may be nulled by React
    // before the cleanup runs.
    const videoEl = videoRef.current;
    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let audioEngine: AudioEngine | null = null;
    let audioAvailable = false;

    void (async () => {
      try {
        setStatus("starting");
        setError(null);

        // 1. Camera (and microphone when possible) ---------------------------
        const videoConstraints: MediaTrackConstraints = {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          aspectRatio: { ideal: 16 / 9 },
          facingMode: "user",
        };
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          audioAvailable = true;
        } catch {
          // Mic denied/unavailable — continue with video only.
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
          });
          audioAvailable = false;
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const video = videoRef.current;
        if (!video) throw new Error("Video element is not available.");
        video.srcObject = stream;
        streamRef.current = stream;
        // Replay recording for the results page (timeline click-to-seek).
        if (recordingUrlRef.current) {
          URL.revokeObjectURL(recordingUrlRef.current);
          recordingUrlRef.current = null;
        }
        try {
          if (typeof MediaRecorder !== "undefined") {
            const mime = [
              "video/webm;codecs=vp9,opus",
              "video/webm;codecs=vp8,opus",
              "video/webm",
            ].find((t) => MediaRecorder.isTypeSupported(t));
            const rec = new MediaRecorder(
              stream,
              mime ? { mimeType: mime } : undefined,
            );
            const chunks: BlobPart[] = [];
            rec.ondataavailable = (e) => {
              if (e.data.size > 0) chunks.push(e.data);
            };
            rec.onstop = () => {
              if (chunks.length === 0) return;
              recordingUrlRef.current = URL.createObjectURL(
                new Blob(chunks, { type: "video/webm" }),
              );
            };
            rec.start(1000);
            recorderRef.current = rec;
          }
        } catch {
          // Recording unsupported — the timeline still works without seek.
          recorderRef.current = null;
        }
        // Honour the current mute state on the fresh stream.
        stream
          .getAudioTracks()
          .forEach((track) => (track.enabled = !mutedRef.current));
        if (video.readyState < 1) {
          await new Promise<void>((resolve) => {
            video.addEventListener("loadedmetadata", () => resolve(), {
              once: true,
            });
          });
        }
        await video.play().catch(() => undefined);
        if (cancelled) return;

        // Show the preview instantly — heavy model loading continues in the
        // background so starting the camera never feels blocked.
        setStatus("running");

        // 2. MediaPipe tasks (loaded in the background, cached module-wide
        //    so only the very first session pays the download cost).
        const modelsPromise = Promise.all([
          loadPoseLandmarker(),
          loadFaceLandmarker(),
          loadHandLandmarker(),
        ]);

        // 3. Web Audio (fast) ------------------------------------------------
        if (audio && audioAvailable && stream) {
          try {
            audioEngine = await createAudioEngine(stream);
          } catch {
            audioAvailable = false;
            audioEngine = null;
          }
        } else {
          audioAvailable = false;
        }

        // Model loading is non-fatal: a wasm failure here (e.g. a missing
        // minified export such as `wasmExports.ud`) must not tear down the
        // camera session — keep the preview running and surface the problem
        // as a banner instead of flipping to the error state.
        let poseLandmarker: PoseLandmarker;
        let faceLandmarker: FaceLandmarker;
        let handLandmarker: HandLandmarker;
        try {
          [poseLandmarker, faceLandmarker, handLandmarker] =
            await modelsPromise;
        } catch (err) {
          if (cancelled) {
            audioEngine?.dispose();
            return;
          }
          console.error("[telemetry] MediaPipe task loading failed:", err);
          setError(
            "I couldn't start pose tracking here. Your camera preview still works.",
          );
          return;
        }
        if (cancelled) {
          audioEngine?.dispose();
          return;
        }

        // 4. Throttled telemetry loop (~4 FPS analysis) ----------------------
        const sessionStart = performance.now();
        accumulatorRef.current = new SessionAccumulator(sessionStart);
        postureDetectorRef.current = new PostureModeDetector();
        dualRef.current = new DualRubricAccumulator(sessionStart, {
          ignoreDeviceInteraction: ignoreDeviceRef.current,
        });
        const speech = new SpeechDetector(sessionStart);
        speechRef.current = speech;
        const pitchTracker = new PitchTracker();
        const motionSamples: MotionSample[] = [];

        let lastInferMs = 0;
        let lastTimestamp = 0;
        let lastPublishMs = 0;
        let analysisTick = -1;
        /** Last known hands — reused on ticks where the hand model is skipped. */
        let lastHands: NormalizedLandmark[][] = [];
        let fpsWindowStart = performance.now();
        let fpsFrames = 0;
        let fps = 0;
        /** Hand-tip slots (wrist + index tip per hand) for kinetic energy. */
        let prevHandTips: Array<[number, number, number, number]> | null = null;

        /**
         * Vision circuit-breaker. `wasmExports` (the Emscripten exports such
         * as `wasmExports["ud"]`) lives inside MediaPipe's module closure and
         * is not reachable from app code, so we guard its public surface
         * (`detectForVideo`) instead: tolerate a few bad frames, then halt
         * analysis only — the camera preview and session keep running.
         */
        const MAX_INFER_FAILURES = 3;
        let inferFailures = 0;
        let visionHalted = false;
        const haltVision = (message: string) => {
          visionHalted = true;
          console.warn(`[telemetry] ${message}`);
          setError(message);
        };

        const tick = () => {
          if (cancelled) return;
          rafId = requestAnimationFrame(tick);
          // After a halt the preview keeps rendering; only analysis stops.
          if (visionHalted) return;

          const now = performance.now();
          // Throttle ML analysis to ~4 FPS; the video preview itself keeps
          // rendering at display rate, so it stays smooth.
          if (now - lastInferMs < MIN_FRAME_INTERVAL_MS - 1) return;
          if (!video || video.readyState < 2 || video.videoWidth === 0) return;
          lastInferMs = now;

          // MediaPipe needs strictly increasing timestamps per task.
          const timestamp = Math.max(lastTimestamp + 1, Math.round(now));
          lastTimestamp = timestamp;

          // Guard — the app-side equivalent of
          // `if (typeof wasmExports?.ud === "function")`: `wasmExports` is
          // private to MediaPipe's Emscripten glue, so verify the public
          // surface it was assigned to (assignWasmExports) before calling in.
          if (
            typeof poseLandmarker.detectForVideo !== "function" ||
            typeof faceLandmarker.detectForVideo !== "function" ||
            typeof handLandmarker.detectForVideo !== "function"
          ) {
            haltVision(
              "Vision tracking paused: the WebAssembly module did not expose the expected functions. Camera preview stays on.",
            );
            return;
          }

          let poseResult: PoseLandmarkerResult;
          let faceResult: FaceLandmarkerResult;
          let kinetic: number | null = null;
          try {
            poseResult = poseLandmarker.detectForVideo(video, timestamp);
            faceResult = faceLandmarker.detectForVideo(video, timestamp);
            // Hands are the heaviest task — only analyze every 3rd tick
            // (~1.3 Hz) and reuse the last result in between.
            analysisTick += 1;
            if (analysisTick % HAND_ANALYSIS_EVERY === 0) {
              const handsResult = handLandmarker.detectForVideo(
                video,
                timestamp,
              );
              lastHands = handsResult.landmarks;
              // Ke = (1/N) Σ (Δwrist² + Δindex_tip²) over normalized coords.
              const tips = handsResult.landmarks.map(
                (h) =>
                  [h[0]!.x, h[0]!.y, h[8]!.x, h[8]!.y] as [
                    number,
                    number,
                    number,
                    number,
                  ],
              );
              if (
                prevHandTips !== null &&
                tips.length > 0 &&
                tips.length === prevHandTips.length
              ) {
                let sum = 0;
                for (let i = 0; i < tips.length; i += 1) {
                  const [wx, wy, ix, iy] = tips[i]!;
                  const [pwx, pwy, pix, piy] = prevHandTips[i]!;
                  sum +=
                    (wx - pwx) ** 2 +
                    (wy - pwy) ** 2 +
                    (ix - pix) ** 2 +
                    (iy - piy) ** 2;
                }
                kinetic = sum / tips.length;
              }
              prevHandTips = tips;
            }
          } catch (err) {
            // Never let a wasm error escape the RAF callback — an uncaught
            // exception here would kill the feed for the whole session.
            inferFailures += 1;
            if (inferFailures >= MAX_INFER_FAILURES) {
              haltVision(
                "Vision tracking paused: the WebAssembly module crashed repeatedly. Camera preview stays on.",
              );
            } else {
              console.warn(
                `[telemetry] inference failed (${inferFailures}/${MAX_INFER_FAILURES})`,
                err,
              );
            }
            return;
          }
          inferFailures = 0;

          const pose = poseResult.landmarks[0] ?? null;
          // Rolling lower-body visibility for sitting-mode auto-detection.
          postureDetectorRef.current?.observe(pose);
          const face = faceResult.faceLandmarks[0] ?? null;
          const hands = lastHands;

          // Blendshapes → affect averages (smile / tension, 0–1).
          const shapeCats = faceResult.faceBlendshapes[0]?.categories;
          const shapeVal = (name: string): number | null =>
            shapeCats?.find((c) => c.categoryName === name)?.score ?? null;
          const smileVals = (
            [shapeVal("mouthSmileLeft"), shapeVal("mouthSmileRight")] as Array<
              number | null
            >
          ).filter((v): v is number => v !== null);
          const tensionVals = (
            [
              shapeVal("browDownLeft"),
              shapeVal("browDownRight"),
              shapeVal("jawClench"),
              shapeVal("mouthPressLeft"),
              shapeVal("mouthPressRight"),
            ] as Array<number | null>
          ).filter((v): v is number => v !== null);
          const smile =
            smileVals.length > 0
              ? smileVals.reduce((s, v) => s + v, 0) / smileVals.length
              : null;
          const tension =
            tensionVals.length > 0
              ? tensionVals.reduce((s, v) => s + v, 0) / tensionVals.length
              : null;

          // Audio: RMS → speech state machine → pitch tracking.
          let rms = 0;
          let pitchHz: number | null = null;
          if (audioEngine) {
            const reading = audioEngine.read();
            rms = reading.rms;
            speech.feed(rms, now);
            if (speech.isSpeaking() && reading.pitchHz !== null) {
              pitchHz = reading.pitchHz;
              pitchTracker.push(now, pitchHz);
            }
          }
          const speechSnapshot = speech.snapshot(rms, now);

          // Hip midpoint history for the movement classifier.
          if (pose) {
            const lh = pose[POSE_INDEX.leftHip];
            const rh = pose[POSE_INDEX.rightHip];
            if (visible(lh) && visible(rh)) {
              motionSamples.push({ t: now, x: (lh.x + rh.x) / 2 });
              if (motionSamples.length > MOVEMENT_MAX_SAMPLES) {
                motionSamples.splice(
                  0,
                  motionSamples.length - MOVEMENT_MAX_SAMPLES,
                );
              }
            }
          }

          // FPS accounting.
          fpsFrames += 1;
          const fpsSpan = now - fpsWindowStart;
          if (fpsSpan >= 1000) {
            fps = (fpsFrames * 1000) / fpsSpan;
            fpsFrames = 0;
            fpsWindowStart = now;
          }

          const metrics: TelemetryMetrics = {
            timestampMs: now,
            fps,
            detected: {
              pose: pose !== null,
              face: face !== null,
              hands: hands.length,
            },
            posture: computePosture(pose),
            arms: computeArmCrossing(pose),
            head: computeHeadPose(face),
            gaze: computeGaze(face),
            box: computeSpeakerBox(pose, hands),
            movement: classifyMovement(motionSamples, now),
            audio: {
              available: audioEngine !== null,
              speaking: speechSnapshot.speaking,
              rms: speechSnapshot.rms,
              wpm: speechSnapshot.wpm,
              speakingSec: speechSnapshot.speakingSec,
              currentPauseSec: speechSnapshot.currentPauseSec,
              avgPauseSec: speechSnapshot.avgPauseSec,
              longestPauseSec: speechSnapshot.longestPauseSec,
              pitchHz,
              pitchStdDevHz: pitchTracker.stdDev(now),
            },
          };

          frameRef.current = { timestampMs: now, pose, face, hands, metrics };
          accumulatorRef.current?.record(metrics, now);
          // Feed the dual-rubric engine (Verbal + Non-Verbal matrices).
          const elapsedMin = Math.max(0, (now - sessionStart) / 60000);
          dualRef.current?.feed({
            tMs: now,
            yawDeg: metrics.head?.yawDeg ?? null,
            pitchDeg: metrics.head?.pitchDeg ?? null,
            shoulderTiltDeg: metrics.posture?.shoulderTiltDeg ?? null,
            leanDeg: metrics.posture?.leanDeg ?? null,
            smile,
            tension,
            kinetic,
            speaking: speechSnapshot.speaking,
            wordsCum: speechSnapshot.wpm * elapsedMin,
            speakingSecCum: speechSnapshot.speakingSec,
          });

          if (now - lastPublishMs >= PUBLISH_INTERVAL_MS) {
            lastPublishMs = now;
            setTelemetry(metrics);
          }
        };

        rafId = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(
          err instanceof Error ? err.message : "Telemetry failed to start.",
        );
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      // Freeze the session summary so it can still be evaluated after stop.
      accumulatorRef.current?.stop(performance.now());
      // Hand the dual-rubric engine the final pause list, then release the
      // live speech detector (the draft stays readable via dualRef).
      if (speechRef.current && dualRef.current) {
        dualRef.current.setPauses(speechRef.current.getPauses());
      }
      speechRef.current = null;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* already stopped */
        }
      }
      streamRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());
      audioEngine?.dispose();
      frameRef.current = null;
      if (videoEl) videoEl.srcObject = null;
      // Reset published state when the session stops (runs on disable,
      // dependency change, or unmount — never synchronously with render).
      setStatus("idle");
      setError(null);
      setTelemetry(null);
      // The MediaPipe tasks stay cached at module level so a restart does
      // not re-download the wasm + model files.
    };
  }, [enabled, audio, videoRef]);

  const getDualRubricDraft = React.useCallback((): DualRubricDraft | null => {
    const acc = dualRef.current;
    if (!acc) return null;
    // Resolve posture mode at read time — auto-detection has seen the whole
    // session's framing by now (P2).
    acc.setPostMode(
      resolvePostureMode(getPosturePreference(), postureDetectorRef.current),
    );
    // Live speech detector wins (session running); cleanup transfers the
    // pause list into the accumulator for reads after stop.
    return acc.finish(speechRef.current?.getPauses());
  }, []);

  const getRecordingUrl = React.useCallback(
    (): string | null => recordingUrlRef.current,
    [],
  );

  return {
    status,
    error,
    telemetry,
    frameRef,
    getSessionSummary,
    getDualRubricDraft,
    getRecordingUrl,
  };
}










