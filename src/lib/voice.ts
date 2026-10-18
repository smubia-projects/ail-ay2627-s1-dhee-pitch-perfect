/**
 * Audio speech synthesis (Text-to-Speech) — lets Mane read interview
 * questions aloud. Thin wrapper over the browser SpeechSynthesis API with a
 * graceful no-op stub for browsers/contexts where TTS is unavailable, so
 * the live stage never breaks in a demo.
 */

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Cancel any utterance currently being spoken. */
export function stopSpeaking(): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* best-effort */
  }
}

/**
 * Speak `text` aloud. Returns false when TTS is unavailable (the caller
 * should keep a visible "read it yourself" fallback in the UI).
 */
export function speak(
  text: string,
  options: { rate?: number; pitch?: number; onEnd?: () => void } = {},
): boolean {
  if (!speechSupported() || !text.trim()) {
    options.onEnd?.();
    return false;
  }
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate ?? 0.98;
    utterance.pitch = options.pitch ?? 1.02;
    utterance.lang = "en-US";
    if (options.onEnd) utterance.onend = options.onEnd;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    options.onEnd?.();
    return false;
  }
}