"use client";

/**
 * Live captions via the Web Speech API — shared by the Presentation live
 * room and the Interview stage. Chrome pauses continuous recognition after
 * silence, so we restart until the caller stops the session. When the API
 * is unavailable (Firefox/Safari) `supported` is false and callers fall
 * back to scripts/pasted transcripts (a graceful stub for the demo).
 */

import * as React from "react";

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((event: SpeechRecognitionEventLike) => void)
    | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

function createSpeechRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export interface LiveCaptions {
  /** Interim + final text captured so far (finalized words survive restarts). */
  transcript: string;
  /** Web Speech API available in this browser. */
  supported: boolean;
  /** Clear finalized words (new take). */
  reset: () => void;
}

export function useLiveCaptions(active: boolean): LiveCaptions {
  const [transcript, setTranscript] = React.useState("");
  /** Committed (finalized) captions carried across recognition restarts. */
  const capturedRef = React.useRef("");
  const supported = React.useMemo(() => createSpeechRecognition() !== null, []);

  React.useEffect(() => {
    if (!active || !supported) return;
    const recognition = createSpeechRecognition();
    if (!recognition) return;
    let sessionFinals = "";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      sessionFinals = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) sessionFinals += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      setTranscript(
        `${capturedRef.current}${sessionFinals}${interim}`.trim(),
      );
    };
    recognition.onerror = () => {
      /* Mic denied or unsupported: scripts cover it. */
    };
    recognition.onend = () => {
      capturedRef.current = (capturedRef.current + sessionFinals).trim();
      sessionFinals = "";
      try {
        recognition.start();
      } catch {
        /* already running */
      }
    };
    try {
      recognition.start();
    } catch {
      /* already running */
    }
    return () => {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
      // Commit whatever the last segment produced before unmounting.
      capturedRef.current = (capturedRef.current + sessionFinals).trim();
      sessionFinals = "";
    };
  }, [active, supported]);

  const reset = React.useCallback(() => {
    capturedRef.current = "";
    setTranscript("");
  }, []);

  return { transcript, supported, reset };
}