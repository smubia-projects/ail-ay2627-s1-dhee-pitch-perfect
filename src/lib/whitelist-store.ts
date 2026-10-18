/**
 * Whitelist for flagged unconventional moves/phrases — habits the user
 * marked as "Intentional" are remembered here (localStorage) and ignored
 * by the evaluator in future practice runs.
 */

const STORAGE_KEY = "ai-lodge.flag-whitelist.v1";

/** Normalizes a phrase into a stable whitelist key. */
export function habitKey(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readAll(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(keys: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    /* best-effort */
  }
}

export function loadWhitelist(): string[] {
  return readAll();
}

export function isWhitelisted(phrase: string): boolean {
  const key = habitKey(phrase);
  return readAll().includes(key);
}

/** Adds a phrase to the whitelist; returns the updated list. */
export function addToWhitelist(phrase: string): string[] {
  const key = habitKey(phrase);
  const all = readAll();
  if (!all.includes(key)) all.push(key);
  writeAll(all);
  return all;
}

/** Removes a phrase from the whitelist; returns the updated list. */
export function removeFromWhitelist(phrase: string): string[] {
  const key = habitKey(phrase);
  const all = readAll().filter((k) => k !== key);
  writeAll(all);
  return all;
}

/** Filters out phrases the user marked as intentional. */
export function filterWhitelisted(phrases: string[]): string[] {
  const whitelist = new Set(readAll());
  return phrases.filter((p) => !whitelist.has(habitKey(p)));
}
