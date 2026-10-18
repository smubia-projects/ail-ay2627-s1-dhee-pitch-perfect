"use client";

/**
 * Welcome / Home screen: the Manestage brand header (Plus Jakarta Sans +
 * mini Mane badge), Mane holding a speech bubble with the hero greeting,
 * and the two fully-clickable coach option cards with soft hover lifts.
 */

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Briefcase, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Mane, ManeBadge } from "@/components/mascot/mane";
import { SpeechBubble } from "@/components/mascot/speech-bubble";

const GREETING = "Welcome to Manestage! What are we practicing today?";

/** Lines Mane says when you tap him. */
const LION_LINES = [
  GREETING,
  "Tap a card below and I'll trot right along with you!",
  "Presenting or interviewing, either way we'll practice together.",
  "Deep breath. Practice makes progress!",
];

export default function HomePage() {
  const [greeted, setGreeted] = React.useState(false);
  /** Index into LION_LINES — advanced each time Mane is tapped. */
  const [lineIndex, setLineIndex] = React.useState(0);
  /** Plays the tap-bounce animation briefly. */
  const [tapping, setTapping] = React.useState(false);

  React.useEffect(() => {
    const t = window.setTimeout(() => setGreeted(true), 250);
    return () => window.clearTimeout(t);
  }, []);

  function handleManeTap(): void {
    setLineIndex((i) => (i + 1) % LION_LINES.length);
    setTapping(true);
    window.setTimeout(() => setTapping(false), 600);
  }

  return (
    <div className="flex flex-1 flex-col gap-8 p-6 md:p-10">
      {/* Brand header: bold wordmark + mini Mane badge, in dark brown over the pastel page */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <ManeBadge size={40} />
          <div className="flex flex-col">
            <h1 className="text-3xl leading-none font-extrabold tracking-tight text-ink-900">
              Manestage
            </h1>
            <span className="text-xs font-medium text-ink-600">
              Mane&apos;s practice studio
            </span>
          </div>
        </div>
        <Badge
          variant="secondary"
          className="border-iris-700/40 bg-iris-200 text-iris-900 backdrop-blur"
        >
          <Sparkles className="size-3" />
          Practice that feels real
        </Badge>
      </motion.header>

      {/* Hero: Mane holding his speech bubble */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex flex-col items-center gap-4 rounded-none border border-iris-700/15 bg-iris-200 px-6 py-10 text-center shadow-[0_18px_50px_-30px_rgba(139,90,60,0.55)] backdrop-blur"
      >
        <AnimatePresence>
          {greeted && (
            <motion.div
              initial={{ opacity: 0, scale: 0.4, y: 60 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 14 }}
              className="flex flex-col items-center gap-3"
            >
              <button
                type="button"
                onClick={handleManeTap}
                aria-label="Tap Mane the lion coach"
                title="Tap me!"
                className="cursor-pointer rounded-none outline-none focus-visible:ring-2 focus-visible:ring-iris-600/60"
              >
                <Mane attire="plain" size={180} tapping={tapping} />
              </button>
              <div className="max-w-md">
                <SpeechBubble
                  key={lineIndex}
                  text={LION_LINES[lineIndex]}
                  typewriter
                  className="text-left"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {/* Two option cards */}
      <section
        aria-label="Choose a coach"
        className="grid gap-6 sm:grid-cols-2"
      >
        {/* Presentation Coach */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12, ease: "easeOut" }}
          className="option-card group relative flex flex-col overflow-hidden rounded-none border border-iris-700/20 bg-card shadow-[0_18px_50px_-30px_rgba(139,90,60,0.5)]"
        >
          <Link
            href="/presentation"
            className="absolute inset-0 z-10"
            aria-label="Open Presentation Coach"
          />
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 z-0 h-1 bg-gradient-to-r from-transparent via-iris-500 to-transparent opacity-70 transition-opacity group-hover:opacity-100"
          />

          <div className="pointer-events-none relative z-0 flex flex-col items-center gap-3 px-6 pt-8">
            <Mane attire="presenter" size={130} />
            <div className="max-w-sm">
              <SpeechBubble
                text="Let's ace this presentation today!"
                className="text-left"
              />
            </div>
            <h2 className="mt-1 text-xl font-semibold text-ink-900">
              Presentation Coach
            </h2>
            <p className="text-center text-sm text-ink-600">
              Pick your purpose, choose what matters, add your slides, then
              present live. You get scores and a timeline of your best and
              worst moments.
            </p>
            <ul className="text-left text-sm text-ink-600">
              <li className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-1.5 size-1.5 shrink-0 rounded-none bg-iris-600"
                />
                Pick your objective, add your slides and rubrics to supplement,
                and Mane will gauge!
              </li>
            </ul>
          </div>

          <div className="pointer-events-none relative z-20 mt-auto flex flex-wrap items-center justify-center gap-2 p-6 pt-4">
            <span className="inline-flex items-center gap-2 rounded-none bg-iris-700 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_rgba(139,90,60,0.3)] transition-all group-hover:bg-iris-800">
              Start rehearsing
              <ArrowRight className="size-4" />
            </span>
          </div>
        </motion.div>

        {/* Interview Coach */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.22, ease: "easeOut" }}
          className="option-card group relative flex flex-col overflow-hidden rounded-none border border-iris-700/20 bg-card shadow-[0_18px_50px_-30px_rgba(139,90,60,0.5)]"
        >
          <Link
            href="/interview"
            className="absolute inset-0 z-10"
            aria-label="Open Interview Coach"
          />
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 z-0 h-1 bg-gradient-to-r from-transparent via-iris-600 to-transparent opacity-70 transition-opacity group-hover:opacity-100"
          />

          <div className="pointer-events-none relative z-0 flex flex-col items-center gap-3 px-6 pt-8">
            <Mane attire="interview" size={130} />
            <div className="max-w-sm">
              <SpeechBubble
                text="We are getting this job!"
                className="text-left"
              />
            </div>
            <h2 className="mt-1 text-xl font-semibold text-ink-900">
              Interview Coach
            </h2>
            <p className="text-center text-sm text-ink-600">
              Pick an industry, shape the questions, answer out loud, then
              get a report on six skills.
            </p>
          </div>

          <div className="pointer-events-none relative z-20 mt-auto flex flex-wrap items-center justify-center gap-2 p-6 pt-4">
            <span className="inline-flex items-center gap-2 rounded-none bg-iris-700 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_rgba(139,90,60,0.3)] transition-all group-hover:bg-iris-800">
              <Briefcase className="size-4" />
              Start interviewing
            </span>
          </div>
        </motion.div>
      </section>

      <p className="text-center text-xs font-medium text-ink-700/80">
        Your camera feed and history stay on this device. Live captions use
        your browser&apos;s speech service, and Mane&apos;s AI scoring runs in
        the cloud — turn on Local coach in the navbar to keep everything
        on-device.
      </p>
    </div>
  );
}