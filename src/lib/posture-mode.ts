/**
 * Sitting-mode detection (P2) — pure, DOM-free, and MediaPipe-free at
 * runtime (the landmark type is type-only) so it can be unit tested in Node.
 *
 * Auto-detection asks one question: are the legs in frame? When hips AND
 * knees are rarely visible — the usual laptop-camera framing while seated —
 * the session is treated as sitting; a clearly visible lower body means
 * standing. An explicit user choice (prefs-store) always wins upstream.
 */

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

/** Effective posture mode for a session. */
export type PostureMode = "sitting" | "standing";
/** User preference feeding the mode; "auto" defers to landmark visibility. */
export type PosturePreference = "auto" | PostureMode;
/** Visibility-based guess before the preference is applied. */
export type PostureModeGuess = PostureMode | "unknown";

/** BlazePose landmark indices for the lower body. */
const LOWER_BODY_INDEX = {
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
} as const;

/** Fewer frames than this are too noisy to call anything. */
const MIN_FRAMES = 15;
/** Lower body visible in fewer than 40 % of frames → legs out of shot. */
const SITTING_FRACTION = 0.4;
/** Lower body visible in more than 70 % of frames → confidently standing. */
const STANDING_FRACTION = 0.7;

/** Pose landmarks carry a `visibility` score (face/hand landmarks don't). */
function visible(landmark: NormalizedLandmark | undefined): boolean {
  return !!landmark && (landmark.visibility ?? 1) >= 0.5;
}

/**
 * Rolling lower-body visibility tracker. Feed one pose per analysed frame;
 * `guess()` reports "sitting" / "standing" / "unknown" once enough frames
 * have been seen.
 */
export class PostureModeDetector {
  private frames = 0;
  private lowerInFrame = 0;

  observe(pose: NormalizedLandmark[] | null): void {
    if (!pose) return;
    const hipsVisible =
      visible(pose[LOWER_BODY_INDEX.leftHip]) &&
      visible(pose[LOWER_BODY_INDEX.rightHip]);
    const kneesVisible =
      visible(pose[LOWER_BODY_INDEX.leftKnee]) ||
      visible(pose[LOWER_BODY_INDEX.rightKnee]);
    this.frames += 1;
    if (hipsVisible && kneesVisible) this.lowerInFrame += 1;
  }

  /** Best guess from visibility alone; "unknown" until enough frames. */
  guess(): PostureModeGuess {
    if (this.frames < MIN_FRAMES) return "unknown";
    const fraction = this.lowerInFrame / this.frames;
    if (fraction < SITTING_FRACTION) return "sitting";
    if (fraction > STANDING_FRACTION) return "standing";
    return "unknown";
  }
}

/**
 * Resolves the session's posture mode: an explicit user choice wins,
 * otherwise the visibility-based guess applies ("unknown" → standing, so
 * nothing is excluded unless we're confident or the user said so).
 */
export function resolvePostureMode(
  preference: PosturePreference,
  detector: { guess(): PostureModeGuess } | null,
): PostureMode {
  if (preference === "sitting" || preference === "standing") return preference;
  return detector?.guess() === "sitting" ? "sitting" : "standing";
}

/** Rubric telemetry metrics that are stance/leg-based (excluded when sitting). */
export const STANCE_METRICS: ReadonlySet<string> = new Set([
  "sway_seconds",
  "sway_frequency_hz",
  "steps",
]);
