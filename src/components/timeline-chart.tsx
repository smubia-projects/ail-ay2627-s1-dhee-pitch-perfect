"use client";

/**
 * Timeline visualizer — a pure-SVG score-over-time chart with a navy
 * grid, gold trend line, and hover tooltips. No chart libraries needed.
 */

import * as React from "react";

import { cn } from "@/lib/utils";
import type { PracticeSessionRecord } from "@/lib/session-history";

const VIEW_W = 640;
const VIEW_H = 220;
const PAD = { top: 16, right: 20, bottom: 34, left: 36 };

export function TimelineChart({
  sessions,
  accent = "#8b5a3c",
  className,
}: {
  /** Sessions sorted oldest → newest. */
  sessions: PracticeSessionRecord[];
  /** Line/point color (warm orange by default). */
  accent?: string;
  className?: string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);

  if (sessions.length === 0) {
    return (
      <div
        className={cn(
          "flex h-48 items-center justify-center rounded-none border border-dashed border-iris-700/20 text-sm text-ink-900/50",
          className,
        )}
      >
        No sessions yet. Do one run and your timeline lights up.
      </div>
    );
  }

  const innerW = VIEW_W - PAD.left - PAD.right;
  const innerH = VIEW_H - PAD.top - PAD.bottom;
  const n = sessions.length;

  const xFor = (i: number) =>
    PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yFor = (score: number) =>
    PAD.top + innerH - (Math.max(0, Math.min(100, score)) / 100) * innerH;

  const points = sessions.map((s, i) => ({
    x: xFor(i),
    y: yFor(s.score),
    session: s,
  }));
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath = n > 1
    ? `${linePath} L${points[n - 1].x.toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${points[0].x.toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`
    : "";

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full"
        role="img"
        aria-label="Score timeline"
      >
        <defs>
          <linearGradient id="timelineArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid + y labels */}
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line
                x1={PAD.left}
                y1={y}
                x2={VIEW_W - PAD.right}
                y2={y}
                stroke="rgba(139,90,60,0.14)"
                strokeDasharray={tick === 0 ? undefined : "4 5"}
              />
              <text
                x={PAD.left - 8}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="rgba(60,42,30,0.6)"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Area + line */}
        {areaPath && <path d={areaPath} fill="url(#timelineArea)" />}
        <path
          d={linePath}
          fill="none"
          stroke={accent}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Points + hit targets */}
        {points.map((p, i) => (
          <g key={p.session.id}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hover === i ? 6.5 : 4.5}
              fill="#ffffff"
              stroke={accent}
              strokeWidth={hover === i ? 3 : 2}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={14}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((c) => (c === i ? null : c))}
            />
            {/* X label: date */}
            <text
              x={p.x}
              y={VIEW_H - 12}
              textAnchor="middle"
              fontSize="9"
              fill="rgba(60,42,30,0.5)"
            >
              {new Date(p.session.completedAtMs).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </text>
          </g>
        ))}
      </svg>

      {/* Hover tooltip */}
      {hover !== null && points[hover] && (
        <div
          className="pointer-events-none absolute z-10 max-w-[240px] rounded-none border border-iris-700/20 bg-white px-3 py-2 text-xs text-ink-900 shadow-lg"
          style={{
            left: `${(points[hover].x / VIEW_W) * 100}%`,
            top: `${(points[hover].y / VIEW_H) * 100}%`,
            transform: "translate(-50%, -130%)",
          }}
        >
          <p className="font-semibold text-iris-800">
            {points[hover].session.score}: {points[hover].session.title}
          </p>
          <p className="mt-0.5 line-clamp-2 text-ink-900/60">
            {points[hover].session.summary}
          </p>
        </div>
      )}
    </div>
  );
}
