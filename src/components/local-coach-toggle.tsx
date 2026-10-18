"use client";

/**
 * Privacy-mode toggle for the navbar. OFF = cloud AI scoring (default);
 * ON = Local coach — every AI step runs on-device in the offline engine,
 * so no transcript, context or history leaves the browser.
 */

import { Cloud, CloudOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLocalCoach } from "@/hooks/use-local-coach";
import { cn } from "@/lib/utils";

export function LocalCoachToggle({ className }: { className?: string }) {
  const [on, setOn] = useLocalCoach();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={on}
      title={
        on
          ? "Local coach is ON — scoring, questions and rubric parsing all stay on this device"
          : "Cloud AI coaching — your transcript is scored by Gemini. Toggle ON to keep everything on-device"
      }
      onClick={() => setOn(!on)}
      className={cn(
        "gap-1.5",
        on &&
          "border border-iris-700/40 bg-iris-200 text-iris-900 hover:bg-iris-300 hover:text-iris-900",
        className,
      )}
    >
      {on ? <CloudOff className="size-4" /> : <Cloud className="size-4" />}
      <span className="hidden text-xs font-semibold md:inline">
        {on ? "Local coach" : "Cloud coach"}
      </span>
      <span className="sr-only">
        {on ? "Local coach on" : "Cloud coach on"}
      </span>
    </Button>
  );
}
