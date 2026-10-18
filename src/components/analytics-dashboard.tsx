"use client";

/**
 * Dual-tab analytics dashboard — Presentation Practice History (tab 1)
 * and Interview Practice History (tab 2), each with a timeline
 * visualizer plus expandable per-session feedback cards.
 */

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Briefcase,
  ChevronDown,
  Info,
  Minus,
  Presentation,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TimelineChart } from "@/components/timeline-chart";
import { SkillRadar } from "@/components/skill-radar";
import { DonutScore } from "@/components/ui/donut-score";
import { cn } from "@/lib/utils";
import {
  STORAGE_KEY,
  loadSessionHistory,
  type PracticeSessionRecord,
  type PracticeTrack,
} from "@/lib/session-history";

const TABS: Array<{
  track: PracticeTrack;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}> = [
  {
    track: "presentation",
    label: "Presentation Analytics",
    icon: Presentation,
    accent: "#8b5a3c",
  },
  {
    track: "interview",
    label: "Interview Analytics",
    icon: Briefcase,
    accent: "#c98a5e",
  },
];

const GRADE_STYLE: Record<string, string> = {
  excellent:
    "border-iris-400/50 bg-iris-500/15 text-iris-700 dark:text-iris-300",
  good: "border-emerald-400/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  fair: "border-amber-400/50 bg-amber-50 text-amber-700 dark:text-amber-300",
  needs_work:
    "border-rose-400/50 bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

function SessionCard({ session }: { session: PracticeSessionRecord }) {
  const [open, setOpen] = React.useState(false);
  return (
    <motion.li layout className="rounded-none border border-iris-700/15 bg-white p-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-none bg-iris-100 font-bold tabular-nums text-iris-800">
            {session.score}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-900">
              {session.title}
            </p>
            <p className="text-xs text-ink-900/55">
              {new Date(session.completedAtMs).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn("shrink-0", GRADE_STYLE[session.grade] ?? "")}
          >
            {session.grade}
          </Badge>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-ink-900/55 transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-col gap-1.5 border-t border-iris-700/15 pt-2 text-sm">
              <p className="text-ink-900/70">{session.summary}</p>
              <ul className="mt-1 flex flex-col gap-1">
                {session.highlights.map((line, i) => (
                  <li key={i} className="text-xs text-iris-800/90">
                    · {line}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export function AnalyticsDashboard() {
  const [track, setTrack] = React.useState<PracticeTrack>("presentation");
  const [clearOpen, setClearOpen] = React.useState(false);
  // Load lazily on the client (localStorage is browser-only). Deferred one
  // frame so SSR/hydration renders the empty state first.
  const [all, setAll] = React.useState<PracticeSessionRecord[]>([]);
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setAll(loadSessionHistory()));
    return () => cancelAnimationFrame(frame);
  }, []);

  const sessions = React.useMemo(
    () =>
      all
        .filter((s) => s.track === track)
        .sort((a, b) => a.completedAtMs - b.completedAtMs),
    [all, track],
  );
  const newestFirst = React.useMemo(() => [...sessions].reverse(), [sessions]);

  const avg =
    sessions.length > 0
      ? Math.round(sessions.reduce((s, x) => s + x.score, 0) / sessions.length)
      : 0;
  const trend =
    sessions.length >= 2
      ? sessions[sessions.length - 1].score - sessions[0].score
      : 0;
  const best = sessions.reduce((m, s) => Math.max(m, s.score), 0);

  // Skill radar — latest vs previous session that recorded skill values.
  const withSkills = sessions.filter(
    (s) => s.skills && Object.keys(s.skills).length > 0,
  );
  const latestSkills = withSkills[withSkills.length - 1];
  const previousSkills = withSkills[withSkills.length - 2];
  const skillLabels = latestSkills ? Object.keys(latestSkills.skills ?? {}) : [];
  const currentValues = skillLabels.map(
    (k) => latestSkills?.skills?.[k] ?? 0,
  );
  const previousValues = previousSkills
    ? skillLabels.map((k) => previousSkills.skills?.[k] ?? 0)
    : null;
  const shortDate = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="flex flex-col gap-6">
      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={track}
          onValueChange={(value) => setTrack(value as PracticeTrack)}
        >
          <TabsList className="h-auto gap-1 border border-iris-700/20 bg-white p-1">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.track}
                value={tab.track}
                className={cn(
                  "gap-2 rounded-none px-4 py-2 text-sm font-medium data-[state=active]:text-white",
                  track === tab.track &&
                    "bg-iris-700 shadow-[0_0_20px_-6px_rgba(139,90,60,0.6)]",
                )}
              >
                <tab.icon className="size-4" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Clear history (shadcn Dialog) */}
        <Dialog open={clearOpen} onOpenChange={setClearOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="text-ink-900/55 hover:bg-white/10 hover:text-rose-300"
            >
              Clear history
            </Button>
          </DialogTrigger>
          <DialogContent className="border-iris-700/20">
            <DialogHeader>
              <DialogTitle>Clear all practice history?</DialogTitle>
              <DialogDescription>
                This deletes every saved session from this browser. You
                can&apos;t undo it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setClearOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  try {
                    window.localStorage.removeItem(STORAGE_KEY);
                  } catch {
                    /* best-effort */
                  }
                  setAll([]);
                  setClearOpen(false);
                }}
              >
                Clear everything
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stat strip: small white cards, big numbers, average donut */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col items-center justify-center gap-1 rounded-none bg-white p-4 text-center shadow-[0_10px_30px_rgba(139,90,60,0.15)]">
          <p className="score-big text-3xl text-iris-700">
            {sessions.length}
          </p>
          <p className="text-xs font-semibold text-ink-500">Sessions</p>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-none bg-white p-4 shadow-[0_10px_30px_rgba(139,90,60,0.15)]">
          <DonutScore
            value={sessions.length ? avg : 0}
            size={92}
            color="#8b5a3c"
            label="avg"
          />
          <p className="text-xs font-semibold text-ink-500">Average score</p>
        </div>
        {/* #14 — trend vs the last valid session of the SAME type, with a
            tooltip explaining the calculation. Invalid (insufficient-data)
            sessions are never saved, so they can't appear here. */}
        <div className="flex flex-col items-center justify-center gap-1 rounded-none bg-white p-4 text-center shadow-[0_10px_30px_rgba(139,90,60,0.15)]">
          <p
            className={cn(
              "score-big flex items-center gap-1 text-3xl",
              sessions.length < 2
                ? "text-ink-300"
                : trend > 0
                  ? "text-emerald-600"
                  : trend < 0
                    ? "text-rose-600"
                    : "text-ink-500",
            )}
          >
            {sessions.length >= 2 ? (
              <>
                {trend > 0 ? (
                  <TrendingUp className="size-6" aria-label="Improved" />
                ) : trend < 0 ? (
                  <TrendingDown className="size-6" aria-label="Declined" />
                ) : (
                  <Minus className="size-6" aria-label="Unchanged" />
                )}
                {trend >= 0 ? "+" : ""}
                {trend}
              </>
            ) : (
              "n/a"
            )}
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="flex items-center gap-1 text-xs font-semibold text-ink-500">
                Change since last session
                <Info className="size-3 text-ink-400" aria-hidden />
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-60 text-xs leading-snug">
              Latest valid score minus the previous valid session of this same
              type. Runs without enough speech or camera data are excluded from
              this comparison, the average, and the radar.
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Skill radar — latest vs previous session */}
      {latestSkills && skillLabels.length >= 3 && (
        <div className="rounded-none border border-iris-700/20 bg-white p-4">
          <p className="mb-1 text-sm font-semibold text-ink-900">
            How your skills changed
          </p>
          <SkillRadar
            labels={skillLabels}
            current={currentValues}
            previous={previousValues}
            currentLabel={`Latest · ${shortDate(latestSkills.completedAtMs)}`}
            previousLabel={
              previousSkills
                ? `Previous · ${shortDate(previousSkills.completedAtMs)}`
                : "Previous"
            }
          />
        </div>
      )}

      {/* Timeline */}
      <div className="rounded-none border border-iris-700/20 bg-iris-50/70 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <TrendingUp className="size-4 text-iris-700" />
          Performance over time
          {best > 0 && (
            <span className="ml-auto text-xs font-normal text-ink-900/55">
              Best: {best}
            </span>
          )}
        </p>
        <TimelineChart
          sessions={sessions}
          accent={TABS.find((t) => t.track === track)?.accent}
        />
      </div>

      {/* Session list */}
      <div className="rounded-none border border-iris-700/15 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-ink-900">
          Practice history &amp; feedback
        </p>
        {newestFirst.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-900/55">
            Nothing here yet. Finish a session and it shows up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {newestFirst.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

