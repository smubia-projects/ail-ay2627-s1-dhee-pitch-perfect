"use client";

/**
 * Presentation Coach · Step 5 — Post-Presentation Analytics.
 * Score badges (Non-Verbal Cue / Verbal Cue / composite Overall), contextual
 * AI feedback that internalizes the purpose & CTA, weighted-rubric emphasis,
 * the interactive quality timeline with peak/dip breakdown cards, and the
 * session actions [Save Video Presentation] / [Discard Video].
 */

import * as React from "react";
import { motion } from "framer-motion";
import {
  Brain,
  Disc,
  Dumbbell,
  FileText,
  ListChecks,
  LoaderCircle,
  PersonStanding,
  RotateCcw,
  Save,
  Sparkles,
  Target,
  Video,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DualRubricView } from "@/components/dual-rubric-view";
import { DonutScore } from "@/components/ui/donut-score";
import { Mane } from "@/components/mascot/mane";
import { SpeechBubble } from "@/components/mascot/speech-bubble";
import type { DualRubricReport } from "@/lib/dual-rubric";
import type { Scorecard } from "@/lib/presentation";
import type { PresentationFeedback } from "@/lib/presentation-feedback-schema";
import { cn } from "@/lib/utils";
import {
  buildContextualFeedback,
  normalizeWeights,
  type PurposeSelection,
  type RubricCriterion,
} from "@/lib/manestage";

export type VideoState = "pending" | "saved" | "discarded";

/** One pastel tone per cue: amber, peach, and the bold orange overall. */
const TONE: Record<
  "primary" | "verbal" | "overall",
  { ring: string; tile: string }
> = {
  primary: { ring: "#c98a5e", tile: "bg-iris-100 text-iris-700" },
  verbal: { ring: "#e8a878", tile: "bg-iris-300 text-iris-900" },
  overall: { ring: "#8b5a3c", tile: "bg-iris-700 text-white" },
};

function ScoreBadge({
  label,
  icon,
  value,
  tone,
  delay,
}: {
  label: string;
  icon: React.ReactNode;
  /** 0–100, or null when the stream was unavailable. */
  value: number | null;
  tone: "primary" | "verbal" | "overall";
  delay: number;
}) {
  const style = TONE[tone];
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 15, delay }}
      className="flex flex-col items-center gap-3 rounded-none bg-white px-6 py-5 shadow-[0_10px_30px_rgba(139,90,60,0.15)]"
    >
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-none px-3 py-1 text-[11px] font-bold tracking-wide uppercase",
          style.tile,
        )}
      >
        {icon}
        {label}
      </span>
      {value === null ? (
        <div className="flex size-32 flex-col items-center justify-center rounded-none bg-iris-100">
          <span className="score-big text-4xl text-ink-400">n/a</span>
          <span className="text-[10px] font-bold tracking-widest text-ink-500 uppercase">
            not measured
          </span>
        </div>
      ) : (
        <DonutScore value={value} size={128} color={style.ring} label="of 100" />
      )}
    </motion.div>
  );
}

/** LLM scorer skill labels for the presentation feedback card (#28). */
const FEEDBACK_SKILLS: Array<[keyof NonNullable<PresentationFeedback["skills"]>, string]> = [
  ["pace", "Pace"],
  ["clarity", "Clarity"],
  ["structure", "Structure"],
  ["presence", "Presence"],
  ["eyeContact", "Eye Contact"],
  ["posture", "Posture"],
];

/** Formats an `atSec` evidence timestamp as m:ss (e.g. "1:07"). */
function fmtAt(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function PresentationResults({
  purpose,
  criteria,
  scorecard,
  report,
  replayUrl,
  evaluating,
  evalError,
  videoState,
  onSaveVideo,
  onDiscardVideo,
  onRetry,
  onNewSetup,
  criteriaTouched,
  feedback,
  feedbackError,
  feedbackRetryable,
  onFeedbackRetry,
  previousOverall,
}: {
  purpose: PurposeSelection;
  criteria: RubricCriterion[];
  scorecard: Scorecard | null;
  report: DualRubricReport | null;
  replayUrl: string | null;
  evaluating: boolean;
  evalError: string | null;
  videoState: VideoState;
  onSaveVideo: () => void;
  onDiscardVideo: () => void;
  onRetry: () => void;
  onNewSetup: () => void;
  /** True when the user actually edited the rubric weights in step 2 (#10). */
  criteriaTouched: boolean;
  /** LLM scorer output for this run (#28) — null while pending. */
  feedback: PresentationFeedback | null;
  /** Friendly note when the offline coach had to take over. */
  feedbackError: string | null;
  /** True when a Retry could plausibly fix the scorer failure. */
  feedbackRetryable?: boolean;
  /** Re-run the LLM scorer for this run. */
  onFeedbackRetry?: () => void;
  /** Headline of the run just before this one — feeds the "vs last run" delta. */
  previousOverall: number | null;
}) {
  const verbal =
    report && report.verbal.score !== null
      ? Math.round((report.verbal.score / report.verbal.max) * 100)
      : null;
  const nonVerbal =
    report && report.nonVerbal.score !== null
      ? Math.round((report.nonVerbal.score / report.nonVerbal.max) * 100)
      : null;
  // #11 — when a telemetry report exists its verdict is authoritative: never
  // fall back to a rescaled offline score. No report → offline engine only.
  const overall = report ? report.finalScore : (scorecard?.overallScore ?? null);
  const insufficientReason = report?.insufficientReason ?? null;

  const contextual = React.useMemo(() => {
    if (overall === null) return null;
    return buildContextualFeedback({
      purpose,
      criteria,
      weightsKnown: criteriaTouched,
      overall,
      verbal,
      nonVerbal,
      report,
      scorecard,
    });
  }, [overall, purpose, criteria, criteriaTouched, verbal, nonVerbal, report, scorecard]);

  const shares = React.useMemo(
    () => normalizeWeights(criteria).filter((c) => c.share > 0),
    [criteria],
  );

  if (evaluating) {
    return (
      <Card className="border-iris-700/25">
        <CardContent className="flex items-center gap-3 py-8">
          <LoaderCircle className="size-5 animate-spin text-iris-700" />
          <p className="text-sm text-ink-700">
            Scoring your run now. One sec.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {evalError && (
        <p className="rounded-none border border-iris-700/30 bg-iris-100 px-4 py-3 text-sm text-iris-900">
          {evalError}
        </p>
      )}

      {/* Mane wrap-up + score badges */}
      <div className="flex flex-col gap-4 rounded-none border border-iris-700/20 bg-card/85 p-5 shadow-[0_18px_50px_-30px_rgba(139,90,60,0.6)] backdrop-blur sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <Mane attire="presenter" size={96} />
          <SpeechBubble
            className="mt-2"
            text={
              overall === null
                ? `I can't score this run honestly${insufficientReason ? ` — ${insufficientReason}` : "."}`
                : `Nice run. Overall ${overall}/100. Here's the breakdown.`
            }
          />
        </div>
        <div className="flex flex-1 flex-wrap items-stretch justify-end gap-3">
          <ScoreBadge
            label="Non-Verbal Cue"
            icon={<PersonStanding className="size-3" />}
            value={nonVerbal}
            tone="primary"
            delay={0.05}
          />
          <ScoreBadge
            label="Verbal Cue"
            icon={<Sparkles className="size-3" />}
            value={verbal}
            tone="verbal"
            delay={0.15}
          />
          <ScoreBadge
            label="Overall"
            icon={<Target className="size-3" />}
            value={overall}
            tone="overall"
            delay={0.25}
          />
        </div>
      </div>

      {/* LLM scorecard (#28) — skills with evidence, strength, fix, rewrite */}
      {feedbackError && !feedback && (
        <div className="flex flex-col gap-2 rounded-none border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          <p>{feedbackError}</p>
          {feedbackRetryable && onFeedbackRetry && (
            <Button
              size="sm"
              variant="outline"
              onClick={onFeedbackRetry}
              className="w-fit border-amber-500/50 text-amber-900 hover:bg-amber-500/20"
            >
              <RotateCcw className="size-3.5" />
              Retry AI scoring
            </Button>
          )}
        </div>
      )}
      {!feedback && !feedbackError && (
        <p className="rounded-none border border-iris-700/20 bg-iris-50/70 px-4 py-3 text-sm text-ink-900/70">
          Mane is scoring this run with the LLM scorer…
        </p>
      )}
      {feedback && feedback.status === "insufficient_data" && (
        <Card className="border-amber-400/40 bg-amber-500/10">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-display text-sm text-amber-800">
              Not enough data to score
            </CardTitle>
            <CardDescription className="text-amber-800/80">
              {feedback.insufficientReason ??
                "There was no speech to score, so this run was not saved to analytics."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {feedback && feedback.status === "scored" && (
        <Card className="border-iris-600/40 bg-iris-50/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-display text-sm">
              <Sparkles className="size-4 text-iris-700" />
              Mane&apos;s scorecard
              {feedbackError && (
                <span className="ml-auto text-xs font-normal text-amber-700">
                  {feedbackError}
                </span>
              )}
              {feedback.overall !== null && previousOverall !== null && (
                <span
                  className={`rounded-none px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                    feedback.overall >= previousOverall
                      ? "bg-emerald-500/15 text-emerald-700"
                      : "bg-amber-500/15 text-amber-700"
                  }`}
                >
                  {feedback.overall >= previousOverall ? "↑" : "↓"}{" "}
                  {Math.abs(feedback.overall - previousOverall)} vs last run
                </span>
              )}
              <span className="ml-auto rounded-none bg-iris-500 px-2 py-0.5 text-sm font-bold text-[#2a2118] tabular-nums">
                {feedback.overall !== null ? `${feedback.overall}/100` : "n/a"}
              </span>
            </CardTitle>
            <CardDescription>
              Six skills, each backed by your words or a measured number.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {FEEDBACK_SKILLS.map(([key, label]) => {
                const s = feedback.skills?.[key] ?? null;
                return (
                  <div
                    key={key}
                    className="flex flex-col gap-1 rounded-none border border-iris-700/15 bg-card p-2.5"
                  >
                    <span className="flex items-center justify-between gap-2 text-xs font-semibold text-ink-800">
                      {label}
                      <span className="tabular-nums text-iris-800">
                        {s?.score ?? "n/a"}
                      </span>
                    </span>
                    {s?.evidenceQuote && (
                      <span className="rounded bg-iris-50 px-1.5 py-0.5 text-[11px] italic text-ink-700">
                        “{s.evidenceQuote}”
                      </span>
                    )}
                    <span className="text-[11px] text-ink-900/60">
                      {s?.reason ?? "Not scored."}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Script adherence (#28b) — what of the intended script arrived */}
            {feedback.scriptAdherence && (
              <div className="flex flex-col gap-1.5 rounded-none border border-iris-700/15 bg-iris-50/50 p-2.5">
                <p className="flex items-center gap-2 text-xs font-semibold text-ink-900">
                  <FileText className="size-3.5 text-iris-700" />
                  Script adherence
                  {feedback.scriptAdherence.coveragePct !== null && (
                    <span className="ml-auto rounded-none bg-iris-200 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-iris-900">
                      {feedback.scriptAdherence.coveragePct}% delivered
                    </span>
                  )}
                </p>
                {feedback.scriptAdherence.skipped.length > 0 && (
                  <p className="text-[11px] text-amber-800">
                    <span className="font-semibold">Never arrived: </span>
                    {feedback.scriptAdherence.skipped.join("; ")}
                  </p>
                )}
                {feedback.scriptAdherence.addedOffScript.length > 0 && (
                  <p className="text-[11px] text-ink-800">
                    <span className="font-semibold">Off-script: </span>
                    {feedback.scriptAdherence.addedOffScript.map((q, i) => (
                      <span key={i} className="italic">“{q}”{i < feedback.scriptAdherence!.addedOffScript.length - 1 ? "; " : ""}</span>
                    ))}
                  </p>
                )}
                {feedback.scriptAdherence.reason && (
                  <p className="text-[11px] text-ink-900/60">
                    {feedback.scriptAdherence.reason}
                  </p>
                )}
              </div>
            )}

            {/* Per-criterion results (#28b) — the user's OWN rubric, with evidence */}
            {feedback.criteriaResults.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="flex items-center gap-2 text-xs font-semibold text-ink-900">
                  <ListChecks className="size-3.5 text-iris-700" />
                  Your criteria
                </p>
                <div className="flex flex-col gap-1.5">
                  {feedback.criteriaResults.map((c, i) => (
                    <div
                      key={`${c.label}-${i}`}
                      className="flex flex-col gap-0.5 rounded-none border border-iris-700/15 bg-card p-2.5"
                    >
                      <span className="flex items-center justify-between gap-2 text-xs font-semibold text-ink-800">
                        {c.label}
                        <span
                          className={cn(
                            "rounded-none px-1.5 py-0.5 text-[10px] font-bold uppercase",
                            c.verdict === "met"
                              ? "bg-emerald-500/15 text-emerald-700"
                              : c.verdict === "partially_met"
                                ? "bg-amber-500/15 text-amber-700"
                                : "bg-rose-500/15 text-rose-700",
                          )}
                        >
                          {c.verdict.replace(/_/g, " ")}
                        </span>
                      </span>
                      {c.evidenceQuote && (
                        <span className="rounded bg-iris-50 px-1.5 py-0.5 text-[11px] italic text-ink-700">
                          “{c.evidenceQuote}”
                        </span>
                      )}
                      {c.fix && (
                        <span className="text-[11px] text-ink-900/70">{c.fix}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top fixes (#28b) — concrete, timestamp-tied */}
            {feedback.top3Fixes.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="flex items-center gap-2 text-xs font-semibold text-ink-900">
                  <Wrench className="size-3.5 text-iris-700" />
                  Top {feedback.top3Fixes.length} fixes
                </p>
                <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] text-ink-800">
                  {feedback.top3Fixes.map((f, i) => (
                    <li key={i}>
                      {f.text}
                      {f.atSec !== null && (
                        <span className="ml-1.5 rounded-none bg-iris-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-iris-800">
                          at {fmtAt(f.atSec)}
                        </span>
                      )}
                      {f.evidenceQuote && (
                        <span className="mt-0.5 block text-[11px] italic text-ink-700">
                          “{f.evidenceQuote}”
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {feedback.feedback && (
              <div className="flex flex-col gap-2 text-sm">
                <p className="flex gap-2 text-ink-900">
                  <span className="mt-0.5 size-4 shrink-0 text-emerald-600">●</span>
                  <span>
                    <span className="font-semibold">Strength:</span>{" "}
                    {feedback.feedback.strength.text}
                    {feedback.feedback.strength.atSec !== null && (
                      <span className="ml-1.5 rounded-none bg-iris-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-iris-800">
                        at {fmtAt(feedback.feedback.strength.atSec)}
                      </span>
                    )}
                  </span>
                </p>
                <p className="flex gap-2 text-ink-900">
                  <span className="mt-0.5 size-4 shrink-0 text-amber-600">●</span>
                  <span>
                    <span className="font-semibold">Priority fix:</span>{" "}
                    {feedback.feedback.priorityFix.text}
                    {feedback.feedback.priorityFix.atSec !== null && (
                      <span className="ml-1.5 rounded-none bg-iris-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-iris-800">
                        at {fmtAt(feedback.feedback.priorityFix.atSec)}
                      </span>
                    )}
                  </span>
                </p>
                {feedback.feedback.priorityFix.drill && (
                  <div className="rounded-none border border-iris-700/30 bg-iris-100/60 p-2.5">
                    <p className="flex items-center gap-2 font-semibold text-ink-900">
                      <Dumbbell className="size-3.5 shrink-0 text-iris-700" />
                      {feedback.feedback.priorityFix.drill.title}
                      <span className="ml-auto rounded-none bg-iris-200 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-iris-900">
                        ≈ {feedback.feedback.priorityFix.drill.minutes} min
                      </span>
                    </p>
                    <ol className="mt-1 flex list-decimal flex-col gap-0.5 pl-5 text-[13px] text-ink-800">
                      {feedback.feedback.priorityFix.drill.steps.map(
                        (step, i) => (
                          <li key={i}>{step}</li>
                        ),
                      )}
                    </ol>
                  </div>
                )}
                {feedback.feedback.rewrittenSentence.improved && (
                  <p className="rounded-none border border-iris-700/20 bg-card p-2.5 text-ink-800">
                    <span className="font-semibold">Say it like this:</span>{" "}
                    “{feedback.feedback.rewrittenSentence.improved}”
                  </p>
                )}
                {feedback.feedback.vsLastAttempt && (
                  <p className="text-ink-900">
                    <span className="font-semibold">Compared with last time:</span>{" "}
                    {feedback.feedback.vsLastAttempt}
                  </p>
                )}
                {feedback.feedback.askUser && (
                  <p className="rounded-none border border-sky-400/40 bg-sky-500/10 p-2.5 text-sky-900">
                    <span className="font-semibold">Mane asks:</span>{" "}
                    {feedback.feedback.askUser}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* #11 — honest state instead of a rescaled headline */}
      {overall === null && report && (
        <Card className="border-amber-400/40 bg-amber-500/10">
          <CardContent className="flex flex-col gap-1 py-5">
            <p className="text-lg font-bold text-amber-800">
              Not enough data to score
            </p>
            <p className="text-sm text-amber-800/80">
              {insufficientReason ??
                "Speech and camera signals were both missing, so there is nothing to score."}{" "}
              This run was not saved to your analytics.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Contextual AI feedback — internalizes purpose & CTA */}
      {contextual && (
        <Card className="border-iris-700/25">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Brain className="size-4 text-iris-700" />
              What I noticed
              <Badge
                variant="outline"
                className="ml-auto border-iris-600/50 bg-iris-100 text-iris-800"
              >
                about your goal
              </Badge>
            </CardTitle>
            <CardDescription>
              I reread your scores against your goal, your key takeaway, and
              your call to action.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="font-display text-lg font-semibold text-ink-900">
              {contextual.headline}
            </p>
            <ul className="flex flex-col gap-2">
              {contextual.bullets.map((bullet, i) => (
                <li
                  key={i}
                  className="flex gap-2.5 rounded-none border border-iris-700/15 bg-iris-50/70 px-3 py-2 text-sm text-ink-900/85"
                >
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-none bg-iris-600" />
                  {bullet}
                </li>
              ))}
            </ul>
            <p className="flex items-center gap-2 rounded-none bg-iris-500/15 px-3 py-2.5 text-sm font-semibold text-iris-900">
              <Target className="size-4 shrink-0 text-iris-700" />
              {contextual.focusNext}
            </p>

            {/* Rubric emphasis chips — only when the USER set the weights
                (#10: never display preset weights as if they were theirs) */}
            {criteriaTouched && shares.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs font-semibold text-ink-900/60">
                  What I scored:
                </span>
              {shares.map((c) => (
                <span
                  key={c.id}
                  title={c.description}
                  className="rounded-none border border-iris-700/30 bg-card px-2.5 py-1 text-xs text-ink-800"
                >
                  {c.label}{" "}
                  <span className="font-bold text-iris-800">
                    {c.share}%
                  </span>
                </span>
              ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {/* Rubric rows + interactive quality timeline + replay */}
      {report && <DualRubricView report={report} videoUrl={replayUrl} />}
      {/* Session actions — save or discard the recording */}
      <Card className="border-iris-700/25 bg-iris-50/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-base">
            <Video className="size-4 text-iris-700" />
            Session actions
          </CardTitle>
          <CardDescription>
            Your run was recorded right here. Keep the video or throw it
            away. Your scores stay either way.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {replayUrl ? (
            <>
              <Button
                onClick={onSaveVideo}
                disabled={videoState === "discarded"}
                className="bg-iris-500 text-[#2a2118] hover:bg-iris-400"
              >
                <Save className="size-4" />
                Save Video Presentation
              </Button>
              <Button
                variant="outline"
                onClick={onDiscardVideo}
                disabled={videoState === "saved"}
                className="border-iris-700/40 text-iris-900"
              >
                <Disc className="size-4" />
                Discard Video
              </Button>
            </>
          ) : (
            <p className="text-sm text-ink-900/60">
              I couldn&apos;t save a replay in this browser. Your timeline
              still works.
            </p>
          )}
          {videoState === "saved" && (
            <Badge className="border-iris-600/50 bg-iris-100 text-iris-800">
              Video saved to your downloads
            </Badge>
          )}
          {videoState === "discarded" && (
            <Badge
              variant="outline"
              className="border-ink-300 bg-ink-50 text-ink-700"
            >
              Video discarded from memory
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Next actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onNewSetup}>
          Change my setup
        </Button>
        <Button size="lg" onClick={onRetry}>
          <RotateCcw className="size-4" />
          Run it again
        </Button>
      </div>
    </div>
  );
}