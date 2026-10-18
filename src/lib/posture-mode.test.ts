import { describe, expect, it } from "vitest";

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

import {
  PostureModeDetector,
  resolvePostureMode,
} from "@/lib/posture-mode";

/**
 * Sitting-mode auto-detection (P2): hips+knees out of frame → sitting,
 * lower body clearly visible → standing, explicit preference always wins.
 */

const POSE_SIZE = 33;

/** A pose with the given landmark indices visible (visibility 0.9). */
function poseWith(indices: number[]): NormalizedLandmark[] {
  const pose: NormalizedLandmark[] = Array.from({ length: POSE_SIZE }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0.1,
  }));
  for (const i of indices) pose[i] = { x: 0.5, y: 0.5, z: 0, visibility: 0.9 };
  return pose;
}

const LEGS_IN_FRAME = poseWith([23, 24, 25, 26]); // hips + knees
const LEGS_OUT_OF_FRAME = poseWith([]); // nothing below the torso visible

function feed(detector: PostureModeDetector, pose: NormalizedLandmark[], n: number) {
  for (let i = 0; i < n; i += 1) detector.observe(pose);
}

describe("PostureModeDetector", () => {
  it("stays unknown until enough frames are seen", () => {
    const detector = new PostureModeDetector();
    feed(detector, LEGS_OUT_OF_FRAME, 5);
    expect(detector.guess()).toBe("unknown");
  });

  it("guesses sitting when hips and knees are rarely in frame", () => {
    const detector = new PostureModeDetector();
    feed(detector, LEGS_OUT_OF_FRAME, 30);
    expect(detector.guess()).toBe("sitting");
  });

  it("guesses standing when the lower body is clearly visible", () => {
    const detector = new PostureModeDetector();
    feed(detector, LEGS_IN_FRAME, 30);
    expect(detector.guess()).toBe("standing");
  });

  it("ignores frames where pose detection failed entirely", () => {
    const detector = new PostureModeDetector();
    feed(detector, LEGS_OUT_OF_FRAME, 30);
    detector.observe(null); // dropped — not a frame
    expect(detector.guess()).toBe("sitting");
  });

  it("counts hips without knees as out of frame (cropped laptop shot)", () => {
    const detector = new PostureModeDetector();
    // Hips visible, knees cut off — typical seated desk framing.
    feed(detector, poseWith([23, 24]), 30);
    expect(detector.guess()).toBe("sitting");
  });
});

describe("resolvePostureMode", () => {
  it("lets an explicit preference win over detection", () => {
    expect(
      resolvePostureMode("sitting", { guess: () => "standing" }),
    ).toBe("sitting");
    expect(resolvePostureMode("standing", { guess: () => "sitting" })).toBe(
      "standing",
    );
  });

  it("uses the auto-detection when the preference is auto", () => {
    expect(resolvePostureMode("auto", { guess: () => "sitting" })).toBe(
      "sitting",
    );
    expect(resolvePostureMode("auto", { guess: () => "standing" })).toBe(
      "standing",
    );
  });

  it("falls back to standing when nothing is known", () => {
    expect(resolvePostureMode("auto", { guess: () => "unknown" })).toBe(
      "standing",
    );
    expect(resolvePostureMode("auto", null)).toBe("standing");
  });
});
