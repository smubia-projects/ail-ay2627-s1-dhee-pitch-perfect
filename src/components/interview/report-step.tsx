"use client";

/**
 * Interview Coach · Step 4 — Report (#24).
 * Aggregated six-skill results from the LLM scorer (null skills show "n/a",
 * never a number), per-answer reviews with evidence quotes, strength,
 * priority fix, rewritten sentence, comparison with the last attempt and
 * Mane's questions (askUser).
 */

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Dumbbell,
  HelpCircle,
  History,
  MessageSquareQuote,
  Quote,
  RotateCcw,
  Sparkles,
  Target,
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
import { Mane } from "@/components/mascot/mane";
import { SpeechBubble } from "@/components/mascot/speech-bubble";
import { DonutScore } from "@/components/ui/donut-score";
import type {
  InterviewFeedback,
  InterviewSkills,
} from "@/lib/interview-feedback-schema";
import type { InterviewContext } from "@/lib/interview-manestage";

const SKILL_LABELS: Record<keyof InterviewSkills, string> = {
  structuredThinking: "Structured Thinking",
  starCar: "STAR / CAR",
  measurableImpact: "Measurable Impact",
  clarityDelivery: "Clarity & Delivery",
  ownership: "Ownership",
  roleFit: "Role Fit",
};

const SKILL_ENTRIES = Object.entries(SKILL_LABELS) as Array<
  [keyof InterviewSkills, string]
>;

export function InterviewReport({
  context,
  feedbacks,
  onPracticeAgain,
  onViewAnalytics,
}: {
  context: InterviewContext;
  feedbacks: InterviewFeedback[];
  onPracticeAgain: () => void;
  onViewAnalytics: () => void;
}) {
  const scored = React.useMemo(
    () =>
      feedbacks.filter(
        (f): f is InterviewFeedback & { overall: number } =>
          f.status === "scored" && f.overall !== null,
      ),
    [feedbacks],
  );
  const insufficientCount = feedbacks.length - scored.length;

  // Overall = mean of the per-answer headlines (null when nothing scored).
  const overall = scored.length
    ? Math.round(scored.reduce((sum, f) => sum + f.overall, 0) / scored.length)
    : null;

  // Per-skill averages across non-null skill scores (n/a when none valid).
  const skillAverages = React.useMemo(() => {
    return SKILL_ENTRIES.map(([key, label]) => {
      const values = scored
        .map((f) => f.skills?.[key].score)
        .filter((v): v is number => typeof v === "number");
      const avg = values.length
        ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        : null;
      return { key, label, avg };
    });
  }, [scored]);

  const grade =
    overall === null
      ? "No answer detected"
      : overall >= 85
        ? "Offer-ready"
        : overall >= 70
          ? "Strong round"
          : overall >= 50
            ? "Getting there"
            : "Keep reps coming";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-5"
    >
      {/* Mane wrap-up + headline score (or the honest no-answer state) */}
      {overall === null ? (
        <div className="flex flex-col items-start gap-4 rounded-none border border-amber-400/40 bg-amber-500/10 p-5 sm:flex-row sm:items-center">
          <Mane attire="interview" size={104} />
          <div className="flex-1">
            <p className="text-lg font-bold text-amber-800">
              No answer detected
            </p>
            <p className="text-sm text-amber-800/80">
              I couldn&apos;t capture a full answer for any question, so there
              are no scores to show
              {insufficientCount > 0
                ? ` (${insufficientCount} answer${insufficientCount === 1 ? "" : "s"} had no detectable speech).`
                : "."}{" "}
              Nothing was saved to analytics. Check your mic and try an answer
              again.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4 rounded-none border border-iris-700/20 bg-card/85 p-5 shadow-[0_18px_50px_-30px_rgba(139,90,60,0.6)] backdrop-blur sm:flex-row sm:items-center">
          <Mane attire="interview" size={104} />
          <div className="flex-1">
            <SpeechBubble
              text={`Interview done for ${context.role || "the role"}. I reviewed ${scored.length} answer${scored.length === 1 ? "" : "s"}${insufficientCount > 0 ? ` (${insufficientCount} had no detectable speech)` : ""}.`}
            />
          </div>
          <div className="flex flex-col items-center gap-2 rounded-none bg-white px-6 py-4 shadow-[0_10px_30px_rgba(139,90,60,0.15)]">
            <DonutScore value={overall} size={132} color="#8b5a3c" label="overall" />
            <Badge className="border-iris-200 bg-iris-100 text-[11px] text-iris-800">
              {grade}
            </Badge>
          </div>
        </div>
      )}

      {/* Six-skill results (n/a never a number) */}
      <Card className="border-iris-700/25">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-base">
            <Sparkles className="size-4 text-iris-700" />
            Your six skills
          </CardTitle>
          <CardDescription>
            Averages across the scored answers. Skills with no verifiable
            evidence show n/a instead of a made-up number.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {skillAverages.map((d) => (
            <div
              key={d.key}
              className="flex flex-col gap-1.5 rounded-none border border-iris-700/15 bg-card p-3"
            >
              <span className="flex items-center justify-between gap-2 text-sm font-semibold text-ink-900">
                {d.label}
                <span className="rounded-none bg-iris-100 px-2 text-sm text-iris-800 tabular-nums">
                  {d.avg ?? "n/a"}
                </span>
              </span>
              {d.avg !== null && (
                <span className="h-2 overflow-hidden rounded-none bg-iris-200">
                  <motion.span
                    initial={{ width: 0 }}
                    animate={{ width: `${d.avg}%` }}
                    transition={{ duration: 0.7, ease: "easeOut" }}
                    className="block h-full rounded-none bg-iris-600"
                  />
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Per-answer reviews */}
      <Card className="border-iris-700/25">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-base">
            <MessageSquareQuote className="size-4 text-iris-700" />
            Answer-by-answer review
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {feedbacks.map((f, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-none border border-iris-700/20 bg-iris-50/60 p-3"
            >
              {f.status === "insufficient_data" ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-none bg-amber-500/20 text-xs font-bold text-amber-800 tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-sm font-semibold text-amber-800">
                      No answer detected
                    </span>
                  </div>
                  <p className="text-sm text-amber-800/80">
                    {f.insufficientReason ??
                      "I couldn't hear a full answer, so there are no scores to show."}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-none bg-iris-500 text-xs font-bold text-[#2a2118] tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-sm font-semibold text-ink-900">
                      {f.overall !== null ? `${f.overall}/100` : "n/a"}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {SKILL_ENTRIES.map(([key, label]) => {
                        const s = f.skills?.[key];
                        if (!s || s.score === null || s.score >= 60) return null;
                        return (
                          <Badge
                            key={key}
                            variant="outline"
                            className="border-iris-700/50 bg-card text-[11px] text-iris-900"
                          >
                            {label} · {s.score}
                          </Badge>
                        );
                      })}
                    </span>
                  </div>

                  {f.skills && (
                    <div className="flex flex-wrap gap-1.5">
                      {SKILL_ENTRIES.map(([key]) => {
                        const s = f.skills?.[key];
                        if (!s?.evidenceQuote) return null;
                        return (
                          <span
                            key={key}
                            className="rounded bg-card px-1.5 py-0.5 text-[11px] italic text-ink-700"
                          >
                            “{s.evidenceQuote}”
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {f.feedback && (
                    <ul className="flex flex-col gap-1 text-sm text-ink-900/80">
                      <li className="flex gap-2">
                        <Target className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                        <span>
                          <span className="font-semibold">Strength:</span>{" "}
                          {f.feedback.strength.text}
                        </span>
                      </li>
                      <li className="flex gap-2">
                        <Target className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                        <span>
                          <span className="font-semibold">Priority fix:</span>{" "}
                          {f.feedback.priorityFix.text}
                        </span>
                      </li>
                      {f.feedback.priorityFix.drill && (
                        <li className="flex gap-2 rounded-none border border-iris-700/30 bg-iris-100/60 p-2.5">
                          <Dumbbell className="mt-0.5 size-3.5 shrink-0 text-iris-700" />
                          <span className="flex flex-col gap-1">
                            <span className="font-semibold text-ink-900">
                              Drill: {f.feedback.priorityFix.drill.title}
                              <span className="ml-2 text-xs font-normal text-ink-700">
                                ≈ {f.feedback.priorityFix.drill.minutes} min
                              </span>
                            </span>
                            <ol className="flex list-decimal flex-col gap-0.5 pl-4 text-[13px] text-ink-800">
                              {f.feedback.priorityFix.drill.steps.map(
                                (step, i) => <li key={i}>{step}</li>,
                              )}
                            </ol>
                          </span>
                        </li>
                      )}
                      {f.feedback.rewrittenSentence.improved && (
                        <li className="flex gap-2">
                          <Quote className="mt-0.5 size-3.5 shrink-0 text-iris-700" />
                          <span>
                            <span className="font-semibold">Rewrite:</span>{" "}
                            “{f.feedback.rewrittenSentence.improved}”
                          </span>
                        </li>
                      )}
                      {f.feedback.vsLastAttempt && (
                        <li className="flex gap-2">
                          <History className="mt-0.5 size-3.5 shrink-0 text-iris-700" />
                          <span>{f.feedback.vsLastAttempt}</span>
                        </li>
                      )}
                      {f.feedback.askUser && (
                        <li className="flex gap-2 rounded-none border border-sky-400/40 bg-sky-500/10 p-2 text-sky-900">
                          <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-sky-700" />
                          <span>{f.feedback.askUser}</span>
                        </li>
                      )}
                    </ul>
                  )}
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onPracticeAgain}>
          <RotateCcw className="size-4" />
          Practice another role
        </Button>
        <Button size="lg" onClick={onViewAnalytics}>
          See my progress
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </motion.div>
  );
}
