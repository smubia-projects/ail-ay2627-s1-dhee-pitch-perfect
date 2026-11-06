"use client";

/**
 * Interview Coach — 4-step ManeStage wizard:
 *   1. Industry & context input (raffle wheel + open-ended context box)
 *   2. Question set calibration (AI-generated, editable, custom additions)
 *   3. Live AI interview stage (TTS questions, camera, six-dimension
 *      per-question feedback)
 *   4. Report (aggregated dimensions + answer-by-answer review)
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Briefcase } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/ui/step-indicator";
import { ContextStep } from "@/components/interview/context-step";
import { QuestionStep } from "@/components/interview/question-step";
import { InterviewLiveStage } from "@/components/interview/live-stage";
import { InterviewReport } from "@/components/interview/report-step";
import type { GeneratedQuestion, GeneratedQuestions } from "@/lib/interview";
import { generateQuestionsLocally } from "@/lib/interview";
import { isLocalCoach } from "@/lib/prefs-store";
import { savePracticeSession } from "@/lib/session-history";
import { apiJson, isHandledApiError } from "@/lib/api";
import type { InterviewFeedback } from "@/lib/interview-feedback-schema";
import {
  DEFAULT_INTERVIEW_CONTEXT,
  INDUSTRY_NEWS_HOOKS,
  industryLabel,
  type InterviewContext,
} from "@/lib/interview-manestage";

const STEPS = ["Industry & context", "Questions", "Live stage", "Report"];

function gradeFor(score: number): string {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  return "needs_work";
}

export default function InterviewCoachPage() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);

  // Step 1 — context
  const [context, setContext] = React.useState<InterviewContext>(
    DEFAULT_INTERVIEW_CONTEXT,
  );
  // Step 2 — question set
  const [questions, setQuestions] = React.useState<GeneratedQuestion[]>([]);
  const [generating, setGenerating] = React.useState(false);
  const [genError, setGenError] = React.useState<string | null>(null);
  const [engine, setEngine] = React.useState<"gemini" | "local" | null>(null);
  // Step 3 → 4
  const [feedbacks, setFeedbacks] = React.useState<InterviewFeedback[]>([]);

  // Deep links: ?step=questions | practice
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const param = new URLSearchParams(window.location.search).get("step");
      if (param === "configure") setStep(0);
      else if (param === "practice") setStep(2);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  /** AI question generation — Gemini route with a deterministic fallback. */
  async function handleGenerate(): Promise<void> {
    setGenerating(true);
    setGenError(null);
    const industry = industryLabel(context);
    const contextSummary = [
      `Role: ${context.role}`,
      `Industry: ${industry}`,
      context.howFound ? `Found via: ${context.howFound}` : null,
      `Commitment: ${context.commitment || "unspecified"}`,
      `Candidate desire: ${context.desireRating}/5`,
      context.contextNotes ? `Background: ${context.contextNotes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      let result: GeneratedQuestions | null = null;
      // Local coach mode never calls the cloud — straight to the local generator below.
      if (!isLocalCoach()) {
        try {
          result = await apiJson<GeneratedQuestions>(
            "/api/interview/generate-questions",
            {
              targetRole: `${context.role} (${industry})`,
              jobDescription: contextSummary,
              resume: context.contextNotes,
              companyNews: INDUSTRY_NEWS_HOOKS[industry] ?? "",
            },
            "Question generation failed",
          );
        } catch (err) {
          // Over the AI limit or paused: the CTA / notice is shown and generation stops (no local questions in its place).
          if (isHandledApiError(err)) return;
          /* offline / no key → local generator below */
        }
      }

      if (result && result.questions.length > 0) {
        setQuestions(result.questions);
        setEngine("gemini");
      } else {
        setQuestions(
          generateQuestionsLocally({
            targetRole: `${context.role} (${industry})`,
            jobDescription: contextSummary,
            resume: context.contextNotes,
            companyNews: INDUSTRY_NEWS_HOOKS[industry] ?? "",
          }).questions,
        );
        setEngine("local");
      }
    } finally {
      setGenerating(false);
    }
  }

  function handleContextContinue(): void {
    setStep(1);
    void handleGenerate();
  }

  /** Live stage finished → persist history + open the report (#24/#25).
      #13/#14: sessions with no scorable answer are never saved. */
  function handleStageFinished(next: InterviewFeedback[]): void {
    setFeedbacks(next);
    const scored = next.filter(
      (f): f is InterviewFeedback & { overall: number } =>
        f.status === "scored" && f.overall !== null,
    );
    if (scored.length === 0) {
      setStep(3);
      return;
    }

    const overall = Math.round(
      scored.reduce((sum, f) => sum + f.overall, 0) / scored.length,
    );
    // Radar skills: per-skill averages, labelled like the analytics history.
    const SKILL_KEYS = [
      "structuredThinking",
      "starCar",
      "measurableImpact",
      "clarityDelivery",
      "ownership",
      "roleFit",
    ] as const;
    const LABELS = [
      "Structured Thinking",
      "STAR / CAR",
      "Impact",
      "Clarity",
      "Ownership",
      "Culture Fit",
    ];
    const skills: Record<string, number> = {};
    SKILL_KEYS.forEach((key, i) => {
      const values = scored
        .map((f) => f.skills?.[key].score)
        .filter((v): v is number => typeof v === "number");
      if (values.length > 0) {
        skills[LABELS[i]] = Math.round(
          values.reduce((a, b) => a + b, 0) / values.length,
        );
      }
    });
    const entries = Object.entries(skills);
    const strongest = [...entries].sort((a, b) => b[1] - a[1])[0];
    const weakest = [...entries].sort((a, b) => a[1] - b[1])[0];
    const insufficient = next.length - scored.length;

    savePracticeSession({
      track: "interview",
      score: overall,
      grade: gradeFor(overall),
      title: `${context.role || "Interview"} in ${industryLabel(context)}`,
      summary: `${scored.length} answer${scored.length === 1 ? "" : "s"} scored across six skills${insufficient > 0 ? `; ${insufficient} had no detectable speech` : ""}. Strongest: ${strongest?.[0] ?? "none"}; needs work: ${weakest?.[0] ?? "none"}.`,
      highlights: [
        ...new Set(
          scored
            .map((f) => f.feedback?.strength.text)
            .filter((t): t is string => Boolean(t)),
        ),
      ].slice(0, 3),
      skills,
    });
    setStep(3);
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-10">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="w-fit border-iris-700/40 bg-iris-200 text-iris-900 backdrop-blur">
            <Briefcase />
            Interview Coach
          </Badge>
          <span className="text-xs font-medium text-ink-600">
            Questions read out loud. Answers scored on six skills.
          </span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">
          Reps make the offer
        </h1>
        <p className="max-w-2xl font-medium text-ink-700">
          Pick your industry, shape your questions, then answer out loud while
          Mane listens. I score six skills: structure, STAR, impact, clarity,
          ownership, and culture fit.
        </p>
        <StepIndicator steps={STEPS} current={step} className="mt-2" />
      </motion.div>

      {/* STEP 1 — Industry & context */}
      {step === 0 && (
        <ContextStep
          value={context}
          onChange={setContext}
          onContinue={handleContextContinue}
        />
      )}

      {/* STEP 2 — Question calibration */}
      {step === 1 && (
        <>
          <QuestionStep
            context={context}
            questions={questions}
            onQuestionsChange={setQuestions}
            generating={generating}
            error={genError}
            engine={engine}
            onGenerate={() => void handleGenerate()}
            onContinue={() => setStep(2)}
          />
          <div className="flex justify-start">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ArrowLeft className="size-4" />
              Back to context
            </Button>
          </div>
        </>
      )}

      {/* STEP 3 — Live AI interview stage */}
      {step === 2 && questions.length > 0 && (
        <>
          <InterviewLiveStage
            questions={questions}
            context={context}
            onFinished={handleStageFinished}
          />
          <div className="flex justify-start">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft className="size-4" />
              Back to questions
            </Button>
          </div>
        </>
      )}

      {/* STEP 4 — Report */}
      {step === 3 && (
        <InterviewReport
          context={context}
          feedbacks={feedbacks}
          onPracticeAgain={() => {
            setFeedbacks([]);
            setStep(0);
          }}
          onViewAnalytics={() => router.push("/analytics")}
        />
      )}
    </div>
  );
}