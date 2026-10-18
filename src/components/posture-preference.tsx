"use client";

/**
 * "Are you sitting or standing?" — the posture-mode question shared by both
 * setup flows (Presentation → Slides and setup, Interview → Industry &
 * context). Writes the shared preference in prefs-store; telemetry resolves
 * it with auto-detection (landmark visibility) and the scorers exclude
 * stance/leg cues in sitting mode.
 */

import * as React from "react";
import { Armchair, PersonStanding, Radar } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  PREFS_CHANGED_EVENT,
  getPosturePreference,
  setPosturePreference,
  type PosturePreference,
} from "@/lib/prefs-store";

const OPTIONS = [
  { id: "sitting", label: "Sitting", icon: Armchair },
  { id: "standing", label: "Standing", icon: PersonStanding },
  { id: "auto", label: "Auto-detect", icon: Radar },
] as const;

export function PosturePreference({ className }: { className?: string }) {
  const [pref, setPref] = React.useState<PosturePreference>("auto");

  React.useEffect(() => {
    const sync = () => setPref(getPosturePreference());
    sync();
    window.addEventListener(PREFS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PREFS_CHANGED_EVENT, sync);
  }, []);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-sm font-medium text-ink-900">
        Are you sitting or standing?
      </p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => {
          const active = pref === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => setPosturePreference(option.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-none border px-4 py-3 text-sm font-semibold transition-colors",
                active
                  ? "border-iris-600 bg-iris-500 text-iris-900 ring-2 ring-iris-500/40"
                  : "border-iris-700/25 bg-card text-ink-800 hover:border-iris-700/50",
              )}
            >
              <option.icon className="size-4" />
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {pref === "sitting"
          ? "Sitting mode — stance, pacing and leg cues are excluded from your scores."
          : pref === "standing"
            ? "Standing mode — full-body cues (stance, pacing, legs) count."
            : "Mane checks whether your hips and knees are in frame; pick either option to override."}
      </p>
    </div>
  );
}
