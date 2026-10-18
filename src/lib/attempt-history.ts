/**
 * Per-question attempt history — localStorage-backed. Each scored interview
 * answer is stored (transcript, result, timestamp, question id) so the NEXT
 * call for the same question can compare against it (#25). Insufficient-data
 * runs are never stored.
 */

import type { InterviewFeedback } from "@/lib/interview-feedback-schema";
import type { PreviousAttempt } from "@/lib/interview-scorer";

export interface StoredAttempt {
  questionId: string;
  /** Epoch ms. */
  at: number;
  transcript: string;
  result: InterviewFeedback;
}

const STORAGE_KEY = "manestage.interview-attempts.v1";
const MAX_ATTEMPTS_PER_QUESTION = 5;

function readAll(): StoredAttempt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredAttempt[]) : [];
  } catch {
    return [];
  }
}

function writeAll(attempts: StoredAttempt[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(attempts));
  } catch {
    /* storage full / unavailable — history is best-effort */
  }
}

/** Persists a scored answer (#25: insufficient_data runs are not stored). */
export function saveAttempt(
  questionId: string,
  transcript: string,
  result: InterviewFeedback,
): void {
  if (result.status !== "scored") return;
  const all = readAll().filter((a) => a.questionId !== questionId);
  all.push({ questionId, at: Date.now(), transcript, result });
  const trimmedByQuestion = new Map<string, StoredAttempt[]>();
  for (const attempt of all) {
    const list = trimmedByQuestion.get(attempt.questionId) ?? [];
    list.push(attempt);
    trimmedByQuestion.set(attempt.questionId, list);
  }
  const kept: StoredAttempt[] = [];
  for (const list of trimmedByQuestion.values()) {
    kept.push(...list.slice(-MAX_ATTEMPTS_PER_QUESTION));
  }
  kept.sort((a, b) => a.at - b.at);
  writeAll(kept);
}

/** Earlier attempts for one question, oldest → newest (excludes the last). */
export function loadPreviousAttempts(
  questionId: string,
  limit = 2,
): PreviousAttempt[] {
  return readAll()
    .filter((a) => a.questionId === questionId)
    .sort((a, b) => a.at - b.at)
    .slice(-limit)
    .map((a) => ({
      questionId: a.questionId,
      at: a.at,
      overall: a.result.overall,
      strength: a.result.feedback?.strength.text ?? null,
      askUser: a.result.feedback?.askUser ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Presentation runs (#28/#25) — same pattern, keyed globally per run type
// ---------------------------------------------------------------------------

export interface StoredPresentationRun {
  /** Epoch ms. */
  at: number;
  overall: number | null;
  strength: string | null;
}

const PRES_KEY = "manestage.presentation-runs.v1";
const MAX_PRESENTATION_RUNS = 10;

function readPresentationRuns(): StoredPresentationRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PRES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredPresentationRun[]) : [];
  } catch {
    return [];
  }
}

/** Persists a scored presentation run (#25: insufficient runs are not stored). */
export function savePresentationRun(run: {
  overall: number | null;
  strength: string | null;
}): void {
  if (run.overall === null) return;
  const all = readPresentationRuns();
  all.push({ at: Date.now(), overall: run.overall, strength: run.strength });
  writePresentationRuns(all.slice(-MAX_PRESENTATION_RUNS));
}

function writePresentationRuns(runs: StoredPresentationRun[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRES_KEY, JSON.stringify(runs));
  } catch {
    /* storage full / unavailable — history is best-effort */
  }
}

/** The most recent earlier presentation runs (for "compared with last time"). */
export function loadPreviousPresentationRuns(
  limit = 2,
): StoredPresentationRun[] {
  return readPresentationRuns().slice(-limit);
}