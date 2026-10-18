"use client";

/**
 * Royal step indicator shared by both coach wizards: numbered gold nodes
 * connected by a line, with completed steps checked and the current step
 * glowing.
 */

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export function StepIndicator({
  steps,
  current,
  className,
}: {
  steps: string[];
  /** Zero-based index of the active step. */
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-2", className)}>
      {steps.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex items-center gap-2.5 rounded-none border px-4 py-1.5 font-display text-sm font-semibold transition-all",
                done && "border-iris-500/60 bg-iris-600 text-white shadow-md shadow-iris-600/25",
                active &&
                  "ink-border bg-iris-700 text-white shadow-[0_0_22px_-4px_rgba(139,90,60,0.65)] ring-2 ring-iris-600/30",
                !done && !active &&
                  "border-iris-900/15 bg-card text-iris-900/70",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-none text-[11px] font-bold tabular-nums",
                  done && "bg-white/20 text-white",
                  active && "bg-white text-iris-700",
                  !done && !active && "bg-iris-900/10 text-iris-900/70",
                )}
              >
                {done ? <Check className="size-3.5" /> : index + 1}
              </span>
              {label}
            </span>
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-0.5 w-8 rounded-none",
                  index < current ? "bg-iris-500" : "bg-iris-900/10",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
