"use client";

/**
 * Dual-rubric report view — Verbal Delivery (/50) and Non-Verbal
 * Communication (/50) in dedicated cards, the aggregated 0–100 score, and a
 * click-to-seek quality timeline (peak / dip / recovery / steady) synced to
 * the session replay video.
 *
 * All badges show EARNED points (e.g. `15 / 15`), never negative totals.
 */

import * as React from "react";
import { motion, type Variants } from "framer-motion";
import {
  Activity,
  Mic,
  PersonStanding,
  Video,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  DualRubricReport,
  QualitySegment,
  RubricResult,
  SegmentStatus,
} from "@/lib/dual-rubric";

const SEGMENT_STYLE: Record<SegmentStatus, { color: string; label: string }> = {
  peak: { color: "#8b5a3c", label: "Peak" },
  dip: { color: "#E0575B", label: "Dip" },
  recovery: { color: "#65a30d", label: "Recovery" },
  steady: { color: "#d3c0a8", label: "Steady" },
};

const listContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const rowVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

/** Earned-points badge: iris when a row is maxed, outline otherwise. */
function EarnedBadge({ earned, max }: { earned: number; max: number }) {
  const full = earned >= max;
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 tabular-nums",
        full && "border-iris-500/50 text-iris-600 dark:text-iris-400",
        !full && earned === 0 && "border-rose-400/40 text-rose-500",
      )}
    >
      {earned} / {max}
    </Badge>
  );
}

function RubricCard({
  title,
  icon,
  result,
}: {
  title: string;
  icon: React.ReactNode;
  result: RubricResult;
}) {
  const skipped = result.status === "SKIPPED" || result.score === null;
  return (
    <Card className="border-iris-700/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            {icon}
            {title}
          </span>
          <span
            className={cn(
              "text-2xl font-black tabular-nums",
              skipped ? "text-muted-foreground" : "text-iris-700",
            )}
          >
            {skipped ? "n/a" : result.score}
            <span className="ml-0.5 text-sm font-medium text-muted-foreground">
              / {result.max}
            </span>
          </span>
        </CardTitle>
        {skipped && result.message && (
          <CardDescription className="rounded-none border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-amber-700">
            {result.message}
          </CardDescription>
        )}
      </CardHeader>
      {!skipped && (
        <CardContent className="flex flex-col gap-3">
          <motion.ul
            className="flex flex-col gap-2"
            variants={listContainer}
            initial="hidden"
            animate="show"
          >
            {result.rows.map((row) => (
              <motion.li
                key={row.id}
                variants={rowVariants}
                className="flex items-center justify-between gap-3 rounded-none border border-border px-3 py-2 text-sm"
              >
                <span className="text-ink-900/80">{row.label}</span>
                <EarnedBadge earned={row.earned} max={row.max} />
              </motion.li>
            ))}
          </motion.ul>
          {result.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {result.flags.map((flag) => (
                <span
                  key={flag.label}
                  className={cn(
                    "rounded-none border px-2 py-0.5 text-[11px]",
                    flag.penalty > 0
                      ? "border-rose-400/40 bg-rose-500/10 text-rose-600"
                      : "border-iris-600/30 bg-iris-500/10 text-iris-700",
                  )}
                >
                  {flag.label}
                  {flag.penalty > 0 && ` · −${flag.penalty}`}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Quality timeline — pure SVG, click a segment to seek the replay video
// ---------------------------------------------------------------------------

const CHART_W = 640;
const CHART_H = 170;
const PAD = { top: 18, right: 16, bottom: 30, left: 34 };

function QualityTimeline({
  segments,
  selected,
  onSelect,
}: {
  segments: QualitySegment[];
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const n = segments.length;
  const xFor = (i: number) =>
    PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yFor = (score: number) =>
    PAD.top + innerH - (Math.max(0, Math.min(100, score)) / 100) * innerH;

  const line = segments
    .map(
      (s, i) =>
        `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(s.score).toFixed(1)}`,
    )
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="w-full"
      role="img"
      aria-label="Quality timeline"
    >
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={CHART_W - PAD.right}
            y1={yFor(v)}
            y2={yFor(v)}
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeDasharray={v === 50 ? "4 4" : undefined}
          />
          <text
            x={PAD.left - 6}
            y={yFor(v) + 3}
            textAnchor="end"
            className="fill-current text-[9px] opacity-60"
          >
            {v}
          </text>
        </g>
      ))}

      <path d={line} fill="none" stroke="#8b5a3c" strokeWidth={2} />

      {segments.map((seg, i) => {
        const x = xFor(i);
        const y = yFor(seg.score);
        const style = SEGMENT_STYLE[seg.status];
        const isSel = selected === i;
        const half = innerW / Math.max(n, 1) / 2;
        return (
          <g
            key={`${seg.timestamp}-${i}`}
            className="cursor-pointer"
            onClick={() => onSelect(i)}
            role="button"
            tabIndex={0}
            aria-label={`${seg.timestamp} ${seg.status} score ${seg.score}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect(i);
            }}
          >
            <title>{`${seg.timestamp} · ${seg.status} · ${seg.score}/100: ${seg.title}`}</title>
            <rect
              x={x - half}
              y={PAD.top}
              width={half * 2}
              height={innerH}
              fill="#8b5a3c"
              fillOpacity={isSel ? 0.08 : 0}
            />
            {isSel && (
              <line
                x1={x}
                x2={x}
                y1={PAD.top}
                y2={CHART_H - PAD.bottom}
                stroke="#8b5a3c"
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
            )}
            <circle
              cx={x}
              cy={y}
              r={isSel ? 7 : 5.5}
              fill={style.color}
              stroke="#fff"
              strokeWidth={1.5}
            />
            <text
              x={x}
              y={CHART_H - PAD.bottom + 14}
              textAnchor="middle"
              className="fill-current text-[9px] opacity-70"
            >
              {seg.timestamp}
            </text>
            <text
              x={x}
              y={y - 10}
              textAnchor="middle"
              className="fill-current text-[9px] font-semibold"
            >
              {seg.score}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function DualRubricView({
  report,
  videoUrl,
}: {
  report: DualRubricReport;
  /** Object URL of the session replay (null when recording unsupported). */
  videoUrl: string | null;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [selected, setSelected] = React.useState<number | null>(null);
  const activeSegment =
    selected !== null ? report.timeline[selected] ?? null : null;

  const selectSegment = (index: number) => {
    setSelected(index);
    const video = videoRef.current;
    const seg = report.timeline[index];
    if (video && seg && Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.min(
        seg.atSec,
        Math.max(0, video.duration - 0.25),
      );
      void video.play().catch(() => undefined);
    }
  };

  const legend: SegmentStatus[] = ["peak", "recovery", "steady", "dip"];

  return (
    <div className="flex flex-col gap-6">
      {/* Aggregated score — only when both engines had input (#11) */}
      {report.finalScore === null ? (
        <div className="flex flex-wrap items-center gap-4 rounded-none border border-amber-400/40 bg-amber-500/10 p-5">
          <div className="flex flex-col">
            <span className="text-lg font-bold text-amber-800">
              Not enough data to score
            </span>
            <span className="max-w-xl text-sm text-amber-800/80">
              {report.insufficientReason ??
                "Speech and camera signals were both missing, so there is nothing to score."}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-5 rounded-none border border-iris-700/25 bg-iris-50/70 p-5">
          <div className="flex flex-col items-center">
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="text-4xl font-black tabular-nums text-ink-900"
            >
              {report.finalScore}
            </motion.span>
            <span className="text-[10px] uppercase tracking-widest text-ink-900/60">
              Dual-rubric score
            </span>
          </div>
          <div className="h-10 w-px bg-ink-900/15" />
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-semibold text-ink-900">
              Verbal {report.verbal.score ?? "n/a"}
              <span className="text-muted-foreground"> / 50</span> · Non-verbal{" "}
              {report.nonVerbal.score ?? "n/a"}
              <span className="text-muted-foreground"> / 50</span>
            </p>
            <p className="max-w-md text-xs text-ink-900/60">
              Both engines added up: speaking plus body, out of 100.
            </p>
          </div>
        </div>
      )}

      {/* Separate rubric cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <RubricCard
          title="Verbal Delivery"
          icon={<Mic className="size-4 text-iris-700" />}
          result={report.verbal}
        />
        <RubricCard
          title="Non-Verbal Communication"
          icon={<PersonStanding className="size-4 text-iris-700" />}
          result={report.nonVerbal}
        />
      </div>

      {/* Replay + quality timeline */}
      {report.timeline.length > 0 && (
        <Card className="border-iris-700/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-iris-700" />
              Quality timeline
            </CardTitle>
            <CardDescription>
              Good stretches and rough ones, like fast pacing or looking
              down. Click a point to jump the replay.
              <span className="ml-1 inline-flex flex-wrap gap-2 align-middle">
                {legend.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1">
                    <span
                      className="inline-block size-2 rounded-none"
                      style={{ backgroundColor: SEGMENT_STYLE[t].color }}
                    />
                    {SEGMENT_STYLE[t].label}
                  </span>
                ))}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="rounded-none border border-border bg-white/60 p-2 text-ink-900">
              <QualityTimeline
                segments={report.timeline}
                selected={selected}
                onSelect={selectSegment}
              />
            </div>

            {activeSegment && (
              <motion.div
                key={selected}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3 rounded-none border border-border p-3 text-sm"
              >
                <Badge
                  variant="outline"
                  className="shrink-0 tabular-nums"
                  style={{
                    borderColor: `${SEGMENT_STYLE[activeSegment.status].color}66`,
                    color: SEGMENT_STYLE[activeSegment.status].color,
                  }}
                >
                  {activeSegment.timestamp}
                </Badge>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    {activeSegment.title}{" "}
                    <span className="text-muted-foreground">
                      · {activeSegment.score}/100
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {activeSegment.analysis}
                  </span>
                </div>
              </motion.div>
            )}

            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                playsInline
                preload="metadata"
                className="aspect-video w-full rounded-none border border-border bg-black"
              />
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Video className="size-3.5 shrink-0" />
                I couldn&apos;t save a replay in this browser. Your timeline
                still works.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}



