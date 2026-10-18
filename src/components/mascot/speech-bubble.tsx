"use client";

/**
 * Speech bubble for Mane the mascot — a cream (#FFFFFF) rounded bubble with
 * a terracotta tail and an optional typewriter reveal for a friendly,
 * animated feel.
 */

import * as React from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

export function SpeechBubble({
  text,
  typewriter = false,
  /** Milliseconds per character when typewriter is on. */
  speedMs = 28,
  className,
}: {
  text: string;
  /** Reveal the text one character at a time. */
  typewriter?: boolean;
  speedMs?: number;
  className?: string;
}) {
  // Track the last text so we can reset the reveal counter during render
  // (React's recommended pattern — avoids an effect-driven cascade).
  const [state, setState] = React.useState({
    text,
    revealed: typewriter ? 0 : text.length,
  });
  if (state.text !== text) {
    setState({ text, revealed: typewriter ? 0 : text.length });
  }
  const revealed = state.revealed;

  React.useEffect(() => {
    if (!typewriter || revealed >= text.length) return;
    let index = revealed;
    const timer = window.setInterval(() => {
      index += 1;
      setState((s) => (s.text === text ? { ...s, revealed: index } : s));
      if (index >= text.length) window.clearInterval(timer);
    }, speedMs);
    return () => window.clearInterval(timer);
  }, [text, typewriter, speedMs, revealed]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={cn("relative", className)}
    >
      <div className="card-fresh ink-border px-4 py-3 font-display text-sm font-medium text-ink-900 shadow-md">
        {typewriter ? (
          <>
            {text.slice(0, revealed)}
            {revealed < text.length && (
              <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-iris-700" />
            )}
          </>
        ) : (
          text
        )}
      </div>
      {/* Tail pointing down-left toward the mascot */}
      <div
        aria-hidden
        className="absolute -bottom-2 left-8 size-4 rotate-45 border-r border-b border-iris-700/35 bg-card"
      />
    </motion.div>
  );
}
