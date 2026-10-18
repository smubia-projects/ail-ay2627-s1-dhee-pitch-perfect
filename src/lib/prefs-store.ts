/**
 * User preferences persisted in localStorage — best-effort, same pattern as
 * whitelist-store. Kept separate so privacy / posture settings can evolve
 * independently of the intentional-phrase whitelist.
 */

/** Sitting/standing preference feeding the telemetry posture mode (P2). */
export type PosturePreference = "auto" | "sitting" | "standing";

const LOCAL_COACH_KEY = "manestage.local-coach.v1";
const POSTURE_KEY = "manestage.posture-preference.v1";

/** Fired on `window` whenever any preference changes in this tab. */
export const PREFS_CHANGED_EVENT = "manestage:prefs-changed";

function readRaw(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — preference is best-effort */
  }
}

function notify(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(PREFS_CHANGED_EVENT));
  } catch {
    /* non-critical */
  }
}

/**
 * Local coach mode: when ON, no request leaves the device — scoring,
 * question generation and rubric parsing all run in the offline engine.
 */
export function isLocalCoach(): boolean {
  return readRaw(LOCAL_COACH_KEY) === "1";
}

export function setLocalCoach(on: boolean): void {
  writeRaw(LOCAL_COACH_KEY, on ? "1" : null);
  notify();
}

/** How the user says they're practising; "auto" lets telemetry detect it. */
export function getPosturePreference(): PosturePreference {
  const raw = readRaw(POSTURE_KEY);
  return raw === "sitting" || raw === "standing" ? raw : "auto";
}

export function setPosturePreference(pref: PosturePreference): void {
  writeRaw(POSTURE_KEY, pref === "auto" ? null : pref);
  notify();
}
