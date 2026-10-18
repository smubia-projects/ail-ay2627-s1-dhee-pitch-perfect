"use client";

/**
 * Skill radar chart — pure SVG spider chart comparing two sessions across
 * the same skill axes (current session solid vs previous session dashed),
 * so longitudinal skill improvement reads at a glance.
 */

import * as React from "react";

import { cn } from "@/lib/utils";

const SIZE = 320;
const C = SIZE / 2;
const R = SIZE / 2 - 42;

function pointAt(index: number, total: number, value: number) {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  const r = (Math.max(0, Math.min(100, value)) / 100) * R;
  return { x: C + Math.cos(angle) * r, y: C + Math.sin(angle) * r };
}

export function SkillRadar({
  labels,
  current,
  previous,
  currentLabel = "Latest",
  previousLabel = "Previous",
  className,
}: {
  labels: string[];
  /** Values aligned with `labels` (0–100). */
  current: number[];
  /** Previous session values, aligned with `labels` (optional). */
  previous?: number[] | null;
  currentLabel?: string;
  previousLabel?: string;
  className?: string;
}) {
  const n = labels.length;
  if (n < 3) return null;

  const rings = [25, 50, 75, 100];
  const polygon = (values: number[]) =>
    values
      .map((v, i) => {
        const p = pointAt(i, n, v);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-md"
        role="img"
        aria-label="Skill radar comparing current and previous sessions"
      >
        {/* Rings */}
        {rings.map((ring) => (
          <polygon
            key={ring}
            points={polygon(labels.map(() => ring))}
            fill="none"
            stroke="rgba(139,90,60,0.25)"
            strokeDasharray={ring === 100 ? undefined : "3 4"}
          />
        ))}
        {/* Axes + labels */}
        {labels.map((label, i) => {
          const outer = pointAt(i, n, 100);
          const textPos = pointAt(i, n, 124);
          return (
            <g key={label}>
              <line
                x1={C}
                y1={C}
                x2={outer.x}
                y2={outer.y}
                stroke="rgba(139,90,60,0.3)"
                strokeWidth={1}
              />
              <text
                x={textPos.x}
                y={textPos.y}
                fontSize={10}
                fontWeight={600}
                textAnchor={
                  textPos.x > C + 6 ? "start" : textPos.x < C - 6 ? "end" : "middle"
                }
                dominantBaseline="middle"
                fill="#2a2118"
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Previous session (dashed) */}
        {previous && previous.length === n && (
          <polygon
            points={polygon(previous)}
            fill="rgba(201,138,94,0.18)"
            stroke="#c98a5e"
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        )}

        {/* Current session (solid) */}
        <polygon
          points={polygon(current.slice(0, n))}
          fill="rgba(139,90,60,0.25)"
          stroke="#8b5a3c"
          strokeWidth={2.5}
        />
        {current.slice(0, n).map((v, i) => {
          const p = pointAt(i, n, v);
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={3.5}
              fill="#8b5a3c"
              stroke="#FFFFFF"
              strokeWidth={1.5}
            />
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-ink-900/70">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-6 rounded-none bg-iris-700" />
          {currentLabel}
        </span>
        {previous && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-6 rounded-none"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg,#c98a5e 0 5px,transparent 5px 9px)",
              }}
            />
            {previousLabel}
          </span>
        )}
      </div>
    </div>
  );
}