"use client";

/**
 * Mane — Manestage's cute, round pastel lion mascot. Pure inline SVG (no
 * image assets) with three attire variants:
 *   - "plain"     soft peach lion with a terracotta collar ruff
 *   - "presenter" cream tux with a pastel bow tie
 *   - "interview" warm blazer with a peach tie
 * Animations: gentle float (CSS), blinking eyes (CSS), and a framer-motion
 * pop-in entrance when `pop` is true.
 */

import * as React from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

export type ManeAttire = "plain" | "presenter" | "interview";

/* Pastel palette shared across all variants. */
const MANE_LIGHT = "#FFD2B2";
const MANE = "#FFB380";
const MANE_DEEP = "#F09A6B";
const FACE = "#FFF3E3";
const MUZZLE = "#FFFFFF";
const BLUSH = "#FFC9B0";
const INK = "#2a2118";
const NOSE = "#78350f";
const SHIRT = "#FFFFFF";
/** Golden-yellow attire: light lapels, mid blazer, deep accents. */
const TERRACOTTA = "#facc15";
const RUST = "#eab308";
const DEEP = "#ca8a04";

export function Mane({
  attire = "plain",
  size = 160,
  pop = false,
  tapping = false,
  className,
}: {
  attire?: ManeAttire;
  /** Rendered width in px (height follows the 200×220 viewBox). */
  size?: number;
  /** Play a bouncy pop-in entrance. */
  pop?: boolean;
  /** Play the tap bounce (direct-interaction feedback). */
  tapping?: boolean;
  className?: string;
}) {
  return (
    <motion.div
      className={cn(
        "mascot-float select-none",
        tapping && "mascot-tap",
        className,
      )}
      initial={pop ? { scale: 0.3, y: 40, opacity: 0, rotate: -8 } : false}
      animate={{ scale: 1, y: 0, opacity: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 16 }}
      style={{ lineHeight: 0 }}
    >
      <ManeSvg attire={attire} size={size} />
    </motion.div>
  );
}

/**
 * Mini Mane badge — a round cream coin holding a tiny Mane, used in the
 * Manestage header/brand lockups.
 */
export function ManeBadge({
  size = 34,
  label,
  className,
}: {
  /** Badge diameter in px. */
  size?: number;
  /** Optional text rendered next to the coin. */
  label?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-none border border-iris-700/30 bg-card p-0.5 pr-3 shadow-[0_4px_14px_-6px_rgba(139,90,60,0.7)]",
        className,
      )}
    >
      <span
        className="flex items-center justify-center overflow-hidden rounded-none bg-iris-100"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <Mane attire="plain" size={Math.round(size * 1.35)} />
      </span>
      {label && (
        <span className="font-display text-xs font-semibold tracking-wide text-ink-800">
          {label}
        </span>
      )}
    </span>
  );
}

function ManeSvg({
  attire,
  size,
}: {
  attire: ManeAttire;
  size: number;
}) {
  return (
    <svg
      viewBox="0 0 200 220"
      width={size}
      height={(size * 220) / 200}
      role="img"
      aria-label={`Mane the pastel lion mascot in ${attire} attire`}
    >
      <defs>
        <radialGradient id="maneFluff" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor={MANE_LIGHT} />
          <stop offset="100%" stopColor={MANE_DEEP} />
        </radialGradient>
        <radialGradient id="faceGrad" cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#FFF9EF" />
          <stop offset="100%" stopColor={FACE} />
        </radialGradient>
        <linearGradient id="tieGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={MANE} />
          <stop offset="100%" stopColor={RUST} />
        </linearGradient>
      </defs>

      {/* Round fluffy mane: soft petal circles + inner disc */}
      <g>
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i / 12) * Math.PI * 2;
          const cx = 100 + Math.cos(angle) * 63;
          const cy = 90 + Math.sin(angle) * 63;
          return (
            <circle key={i} cx={cx} cy={cy} r={24} fill="url(#maneFluff)" />
          );
        })}
        <circle cx={100} cy={90} r={66} fill="url(#maneFluff)" />
        <circle
          cx={100}
          cy={90}
          r={58}
          fill="none"
          stroke={MANE}
          strokeWidth={3}
          strokeDasharray="2 7"
          strokeLinecap="round"
          opacity={0.7}
        />
      </g>

      {/* Ears peeking above the mane */}
      <circle cx={64} cy={40} r={15} fill={FACE} stroke={MANE_DEEP} strokeWidth={3} />
      <circle cx={136} cy={40} r={15} fill={FACE} stroke={MANE_DEEP} strokeWidth={3} />
      <circle cx={64} cy={41} r={7} fill={BLUSH} />
      <circle cx={136} cy={41} r={7} fill={BLUSH} />

      {/* Round face */}
      <ellipse cx={100} cy={94} rx={51} ry={48} fill="url(#faceGrad)" />

      {/* Eyes (blink via CSS class) */}
      <g className="lion-eyes">
        <ellipse cx={81} cy={86} rx={8} ry={10} fill={SHIRT} />
        <ellipse cx={119} cy={86} rx={8} ry={10} fill={SHIRT} />
        <circle cx={83} cy={88} r={4.6} fill={INK} />
        <circle cx={121} cy={88} r={4.6} fill={INK} />
        <circle cx={84.6} cy={86.4} r={1.6} fill={SHIRT} />
        <circle cx={122.6} cy={86.4} r={1.6} fill={SHIRT} />
      </g>

      {/* Soft brows */}
      <path d="M71 74 Q81 68 91 73" stroke={MANE_DEEP} strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M109 73 Q119 68 129 74" stroke={MANE_DEEP} strokeWidth={3} fill="none" strokeLinecap="round" />

      {/* Blush cheeks */}
      <ellipse cx={64} cy={106} rx={9} ry={6} fill={BLUSH} opacity={0.85} />
      <ellipse cx={136} cy={106} rx={9} ry={6} fill={BLUSH} opacity={0.85} />

      {/* Muzzle + nose + smile */}
      <ellipse cx={100} cy={112} rx={26} ry={18} fill={MUZZLE} />
      <path d="M92 104 L108 104 L100 113 Z" fill={NOSE} />
      <path d="M100 113 L100 119" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M89 121 Q100 131 111 121" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" />

      {/* Whiskers */}
      <g stroke={MANE_DEEP} strokeWidth={1.5} strokeLinecap="round" opacity={0.75}>
        <line x1={60} y1={108} x2={75} y2={111} />
        <line x1={60} y1={118} x2={75} y2={118} />
        <line x1={140} y1={108} x2={125} y2={111} />
        <line x1={140} y1={118} x2={125} y2={118} />
      </g>

      {/* Attire */}
      {attire === "presenter" && (
        <g>
          {/* Tux shirt V */}
          <path d="M68 168 L100 152 L132 168 L132 200 L68 200 Z" fill={SHIRT} />
          {/* Terracotta lapels */}
          <path d="M68 168 L100 152 L86 200 L68 200 Z" fill={TERRACOTTA} />
          <path d="M132 168 L100 152 L114 200 L132 200 Z" fill={TERRACOTTA} />
          {/* Pastel bow tie */}
          <path d="M100 158 L84 150 L84 166 Z" fill="url(#tieGrad)" />
          <path d="M100 158 L116 150 L116 166 Z" fill="url(#tieGrad)" />
          <circle cx={100} cy={158} r={5} fill={RUST} />
          {/* Studs */}
          <circle cx={100} cy={176} r={2.5} fill={MANE} />
          <circle cx={100} cy={188} r={2.5} fill={MANE} />
        </g>
      )}

      {attire === "interview" && (
        <g>
          {/* White shirt */}
          <path d="M72 170 L100 156 L128 170 L128 200 L72 200 Z" fill={SHIRT} />
          {/* Warm blazer */}
          <path d="M60 176 L72 170 L100 186 L128 170 L140 176 L140 200 L60 200 Z" fill={RUST} />
          {/* Lapels */}
          <path d="M72 170 L100 186 L88 200 L72 200 Z" fill={DEEP} />
          <path d="M128 170 L100 186 L112 200 L128 200 Z" fill={DEEP} />
          {/* Peach tie */}
          <path d="M100 168 L93 176 L100 198 L107 176 Z" fill="url(#tieGrad)" />
          {/* Pocket square */}
          <path d="M126 188 L134 184 L134 190 Z" fill={SHIRT} />
        </g>
      )}

      {attire === "plain" && (
        <g>
          {/* Shoulders with pastel collar ruff */}
          <path d="M64 178 Q100 158 136 178 L136 200 L64 200 Z" fill={MANE_LIGHT} />
          <path d="M78 172 Q100 186 122 172" stroke={TERRACOTTA} strokeWidth={4} fill="none" strokeLinecap="round" />
          <circle cx={100} cy={182} r={4} fill={TERRACOTTA} />
        </g>
      )}
    </svg>
  );
}