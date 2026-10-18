/**
 * Practice session history — localStorage-backed with typed session
 * records for both tracks (presentation / interview). Each record carries
 * optional per-skill values (0–100) that feed the analytics radar charts.
 * Seeds mock history on first use so the dashboard is populated immediately.
 */

export type PracticeTrack = "presentation" | "interview";

export interface PracticeSessionRecord {
  id: string;
  track: PracticeTrack;
  /** Epoch ms when the session completed. */
  completedAtMs: number;
  /** 0-100 overall score. */
  score: number;
  grade: string;
  /** Short human title, e.g. rubric title or job role. */
  title: string;
  /** One-line summary of the outcome. */
  summary: string;
  /** Top feedback lines shown on expand. */
  highlights: string[];
  /** Per-skill breakdown (0–100) for the skill radar charts. */
  skills?: Record<string, number>;
}

export const STORAGE_KEY = "manestage.session-history.v1";
const MAX_SESSIONS = 100;

/** Radar skill names per track (kept stable so trends line up). */
export const PRESENTATION_SKILLS = [
  "Pace",
  "Eye Contact",
  "Posture",
  "Clarity",
  "Structure",
  "Presence",
] as const;

export const INTERVIEW_SKILLS = [
  "Structured Thinking",
  "STAR / CAR",
  "Impact",
  "Clarity",
  "Ownership",
  "Culture Fit",
] as const;

function skillsOf(keys: readonly string[], values: number[]): Record<string, number> {
  return Object.fromEntries(keys.map((k, i) => [k, values[i] ?? 70]));
}

/** Deterministic mock history so analytics is alive on first visit. */
function mockSessions(): PracticeSessionRecord[] {
  const day = 86_400_000;
  const now = Date.now();
  const seed: Array<
    [PracticeTrack, number, string, string, string, string[], number[]]
  > = [
    ["presentation", 62, "Fair", "Startup pitch — seed round", "Strong content, pacing rushed in the middle third.", ["Slow down after slide 4", "Eye contact dipped at 3:12", "Great opening hook"], [58, 55, 70, 66, 64, 60]],
    ["interview", 71, "Good", "Frontend Engineer @ Nova Labs", "Solid STAR answers; results lacked numbers.", ["Quantify the Result step", "Pause before answering (2–4s)", "Confident, steady tone"], [72, 70, 60, 74, 71, 73]],
    ["presentation", 68, "Fair", "Case study — checkout redesign", "Good structure, monotone delivery stretches.", ["Vary pitch on key metrics", "Add a recap slide", "Strong transitions"], [64, 66, 74, 68, 72, 63]],
    ["interview", 76, "Good", "Product Manager — internal transfer", "Clear narratives, minor rambling on failures.", ["Trim the failure story to 90s", "Bridge to company goals sooner"], [77, 74, 68, 76, 72, 79]],
    ["presentation", 81, "Excellent", "Academic — empirical findings", "Excellent clarity and audience awareness.", ["Confident pace throughout", "Nice demo timing", "Watch the filler words"], [79, 82, 84, 83, 80, 78]],
    ["interview", 84, "Excellent", "Senior PM @ Fintech scale-up", "Compelling answers with strong alignment.", ["Great strategic alignment quotes", "Keep answers under 2 minutes"], [85, 83, 80, 84, 82, 86]],
  ];
  return seed.map(([track, score, grade, title, summary, highlights, values], i) => ({
    id: `mock-${i}`,
    track,
    completedAtMs: now - (seed.length - i) * day * 2.5,
    score,
    grade,
    title,
    summary,
    highlights,
    skills:
      track === "presentation"
        ? skillsOf(PRESENTATION_SKILLS, values)
        : skillsOf(INTERVIEW_SKILLS, values),
  }));
}

function readAll(): PracticeSessionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = mockSessions();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as PracticeSessionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(records: PracticeSessionRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* storage full / unavailable — history is best-effort */
  }
}

/** All sessions, newest first. */
export function loadSessionHistory(
  track?: PracticeTrack,
): PracticeSessionRecord[] {
  const all = readAll().sort((a, b) => b.completedAtMs - a.completedAtMs);
  return track ? all.filter((s) => s.track === track) : all;
}

/** Persists a completed practice session. */
export function savePracticeSession(
  record: Omit<PracticeSessionRecord, "id" | "completedAtMs">,
): PracticeSessionRecord {
  const saved: PracticeSessionRecord = {
    ...record,
    id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    completedAtMs: Date.now(),
  };
  const all = readAll();
  all.push(saved);
  writeAll(all.slice(-MAX_SESSIONS));
  return saved;
}