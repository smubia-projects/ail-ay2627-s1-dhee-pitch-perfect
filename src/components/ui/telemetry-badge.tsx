"use client";

/**
 * 21st.dev-style telemetry overlay primitives for the camera frame:
 * glow status badges (iris / amber / indigo / rose), an animated WPM
 * gauge pill, and a live audio spectrum indicator. Designed for dark
 * glassmorphic surfaces — every badge floats on a translucent black pill.
 */

import * as React from "react";
import { motion } from "framer-motion";
import { Box, Eye, Gauge, MoveHorizontal, Music } from "lucide-react";

import { cn } from "@/lib/utils";

export type GlowTone = "iris" | "amber" | "indigo" | "rose";

interface ToneStyles {
  /** Text + background + ring classes. */
  solid: string;
  /** Box-shadow glow color (rgba). */
  glow: string;
}

const TONE_STYLES: Record<GlowTone, ToneStyles> = {
  iris: {
    solid:
      "border-iris-400/40 bg-iris-500/15 text-iris-200 shadow-[0_0_16px_-4px_rgba(16,185,129,0.7)]",
    glow: "rgba(16,185,129,0.7)",
  },
  amber: {
    solid:
      "border-amber-400/40 bg-amber-500/15 text-amber-200 shadow-[0_0_16px_-4px_rgba(245,158,11,0.7)]",
    glow: "rgba(245,158,11,0.7)",
  },
  indigo: {
    solid:
      "border-orange-400/40 bg-orange-500/20 text-orange-200 shadow-[0_0_16px_-4px_rgba(249,115,22,0.7)]",
    glow: "rgba(249,115,22,0.7)",
  },
  rose: {
    solid:
      "border-rose-400/40 bg-rose-500/15 text-rose-200 shadow-[0_0_16px_-4px_rgba(244,63,94,0.7)]",
    glow: "rgba(244,63,94,0.7)",
  },
};

const DIM_STYLE =
  "border-white/10 bg-black/40 text-white/55 shadow-none";

/**
 * Floating glass pill with a colored glow. `active = false` renders a
 * dimmed (unlit) pill; `pulse` breathes the glow for alert states.
 */
export function TelemetryGlowBadge({
  tone,
  icon: Icon,
  active = true,
  pulse = false,
  children,
  className,
}: {
  tone: GlowTone;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  pulse?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <motion.span
      initial={{ opacity: 0, x: -8, scale: 0.92 }}
      animate={{
        opacity: 1,
        x: 0,
        scale: 1,
        ...(pulse && active
          ? {
              boxShadow: [
                `0 0 10px -4px ${styles.glow}`,
                `0 0 22px -2px ${styles.glow}`,
                `0 0 10px -4px ${styles.glow}`,
              ],
            }
          : {}),
      }}
      exit={{ opacity: 0, x: -8, scale: 0.92 }}
      transition={
        pulse && active
          ? {
              opacity: { duration: 0.25 },
              x: { duration: 0.25 },
              scale: { duration: 0.25 },
              boxShadow: { duration: 1.6, repeat: Infinity, ease: "easeInOut" },
            }
          : { duration: 0.25 }
      }
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-none border px-2.5 text-[11px] font-medium backdrop-blur-md",
        "transition-colors duration-300",
        active ? styles.solid : DIM_STYLE,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" />
      {children}
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// Named glow badges
// ---------------------------------------------------------------------------

/** Emerald "Eyes Forward" (rose + deviation when glancing away from the lens). */
export function EyeContactBadge({
  ok,
  deviationDeg,
}: {
  ok: boolean;
  deviationDeg?: number;
}) {
  return (
    <TelemetryGlowBadge
      tone={ok ? "iris" : "rose"}
      icon={Eye}
      active={ok}
      pulse={!ok}
    >
      {ok
        ? "Eyes Forward"
        : `Glancing Away${deviationDeg != null ? ` ${deviationDeg.toFixed(0)}°` : ""}`}
    </TelemetryGlowBadge>
  );
}

/** Amber glow while arms are crossed; dim "Arms Open" otherwise. */
export function ArmsCrossedBadge({ crossed }: { crossed: boolean }) {
  return (
    <TelemetryGlowBadge tone="amber" icon={MoveHorizontal} active={crossed} pulse={crossed}>
      {crossed ? "Arms Crossed" : "Arms Open"}
    </TelemetryGlowBadge>
  );
}

/** Indigo glow inside the speaker's box; rose when outside. Null = no hands. */
export function SpeakersBoxBadge({
  inside,
}: {
  inside: boolean | null;
}) {
  if (inside === null) return null;
  return (
    <TelemetryGlowBadge tone={inside ? "indigo" : "rose"} icon={Box} active pulse={!inside}>
      {inside ? "Inside Speaker's Box" : "Outside Speaker's Box"}
    </TelemetryGlowBadge>
  );
}

/** Rose pulsing alert when pitch variation collapses (monotone delivery). */
export function MonotoneAlertBadge({
  pitchStdDevHz,
  threshold = 15,
}: {
  pitchStdDevHz: number | null;
  threshold?: number;
}) {
  if (pitchStdDevHz === null || pitchStdDevHz >= threshold) return null;
  return (
    <TelemetryGlowBadge tone="rose" icon={Music} active pulse>
      Monotone Alert · σ {pitchStdDevHz.toFixed(0)} Hz
    </TelemetryGlowBadge>
  );
}

// ---------------------------------------------------------------------------
// Animated audio indicators
// ---------------------------------------------------------------------------

const PILL_STYLE =
  "inline-flex items-center gap-1.5 rounded-none border border-white/10 bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md";

/**
 * Animated WPM pill with a mini gauge band (130–160 wpm target).
 * The number flips on every change and the band fill springs to position.
 */
export function WpmGaugePill({
  wpm,
  min = 130,
  max = 160,
}: {
  wpm: number;
  min?: number;
  max?: number;
}) {
  const inBand = wpm >= min && wpm <= max;
  const pct = Math.max(0, Math.min(100, ((wpm - min) / (max - min)) * 100));
  return (
    <span className={cn(PILL_STYLE, "gap-2 tabular-nums")}>
      <Gauge className={cn("size-3", inBand ? "text-iris-400" : "text-amber-400")} />
      <motion.span
        key={wpm}
        initial={{ y: 6, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="font-semibold"
      >
        {Math.round(wpm)}
      </motion.span>
      <span className="text-white/50">WPM</span>
      <span className="relative h-1.5 w-14 overflow-hidden rounded-none bg-white/15">
        <span className="absolute inset-y-0 left-[36%] w-[28%] rounded-none bg-iris-400/30" />
        <motion.span
          className={cn(
            "absolute inset-y-0 w-1.5 rounded-none",
            inBand ? "bg-iris-400" : "bg-amber-400",
          )}
          initial={false}
          animate={{ left: `${pct}%` }}
          transition={{ type: "spring", stiffness: 220, damping: 26 }}
        />
      </span>
    </span>
  );
}

const SPECTRUM_BARS = 9;

/**
 * Live audio spectrum: bars loop a staggered waveform while the whole
 * column scales with the current RMS level (smoothed via CSS transition).
 */
export function AudioSpectrum({
  level,
  active,
  className,
}: {
  /** Normalized loudness 0–1 (e.g. min(rms * 6, 1)). */
  level: number;
  active: boolean;
  className?: string;
}) {
  const scale = active ? 0.35 + Math.min(Math.max(level, 0), 1) * 0.65 : 0.2;
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-6 items-end gap-[3px] transition-transform duration-150 ease-out",
        active ? "opacity-100" : "opacity-45",
        className,
      )}
      style={{ transform: `scaleY(${scale})` }}
    >
      {Array.from({ length: SPECTRUM_BARS }, (_, index) => (
        <motion.span
          key={index}
          className={cn(
            "w-1 origin-bottom rounded-none",
            active ? "bg-iris-400" : "bg-white/40",
          )}
          style={{ height: "100%" }}
          animate={
            active
              ? { scaleY: [0.25, 1, 0.4, 0.85, 0.3, 0.7, 0.25] }
              : { scaleY: 0.18 }
          }
          transition={
            active
              ? {
                  duration: 0.9 + (index % 4) * 0.18,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: index * 0.05,
                }
              : { duration: 0.3 }
          }
        />
      ))}
    </span>
  );
}

/** Shared glass pill used by camera overlays for secondary stats. */
export function StatPill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn(PILL_STYLE, "tabular-nums", className)}>{children}</span>;
}


