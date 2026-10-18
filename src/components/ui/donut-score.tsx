"use client";

/**
 * Donut score — a big bold number inside a progress ring, like the
 * reference app's balance cards. Pure presentational: the ring draws
 * itself in on mount and the number sits centered in Plus Jakarta Sans.
 */

import * as React from "react";

import { cn } from "@/lib/utils";

export function DonutScore({
  value,
  size = 128,
  color = "var(--primary)",
  track = "var(--primary-soft)",
  strokeWidth = 11,
  label,
  sub,
  className,
}: {
  /** 0–100 (clamped). */
  value: number;
  /** Outer size in px. */
  size?: number;
  /** Ring color (indigo, lilac, peach…). */
  color?: string;
  /** Ring background color. */
  track?: string;
  strokeWidth?: number;
  /** Small label under the number (inside the ring). */
  label?: string;
  /** Tiny caption under the donut (outside). */
  sub?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct);

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${Math.round(value)} out of 100`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={track}
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="donut-ring"
            style={{ "--donut-length": circumference } as React.CSSProperties}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="score-big" style={{ fontSize: size * 0.27 }}>
            {Math.round(value)}
          </span>
          {label && (
            <span className="text-[10px] font-bold tracking-widest text-ink-500 uppercase">
              {label}
            </span>
          )}
        </div>
      </div>
      {sub && <p className="text-xs font-medium text-ink-500">{sub}</p>}
    </div>
  );
}