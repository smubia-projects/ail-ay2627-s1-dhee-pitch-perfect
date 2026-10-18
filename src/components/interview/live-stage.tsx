"use client";

/**
 * Interview Coach · Step 3 — Live AI Interview Stage (#24).
 * Mane asks each question aloud (Text-to-Speech), live video/audio + Web
 * Speech captions capture the answer, and every finished answer is scored by
 * the LLM scorer (/api/score) across six skills with evidence quotes,
 * strength, priority fix, rewritten sentence, comparison with the last
 * attempt and any question for the user. Falls back to the deterministic
 * coach when the scorer is unreachable.
 */

import * as React from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock,
  Gauge,
  HelpCircle,
  History,
  LoaderCircle,
  Play,
  Quote,
  RefreshCcw,
  Square,
  Target,
  Volume2,
  VolumeX,
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
import { Textarea } from "@/components/ui/textarea";
import { CameraFeed } from "@/components/camera-feed";
import { Mane } from "@/components/mascot/mane";
import { SpeechBubble } from "@/components/mascot/speech-bubble";
import { useLiveCaptions } from "@/hooks/use-live-captions";
import type { GeneratedQuestion } from "@/lib/interview";
import type {
  DimensionId,
  InterviewContext,
  QuestionReview,
} from "@/lib/interview-manestage";
import { evaluateAnswer, industryLabel } from "@/lib/interview-manestage";
import { computeInterviewMeasured } from "@/lib/interview-scorer";
import { loadPreviousAttempts, saveAttempt } from "@/lib/attempt-history";
import { loadSessionHistory } from "@/lib/session-history";
import { ScoreRequestError, scoreInterviewAnswer } from "@/lib/score-client";
import { isLocalCoach } from "@/lib/prefs-store";
import type {
  InterviewFeedback,
  InterviewSkills,
} from "@/lib/interview-feedback-schema";
import { cn } from "@/lib/utils";
import { speak, speechSupported, stopSpeaking } from "@/lib/voice";

const MIN_ANSWER_WORDS = 30;

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

/** Offline fallback: map the deterministic review into the feedback shape. */
function feedbackFromLocalReview(review: QuestionReview): InterviewFeedback {
  if (review.insufficient) {
    return {
      status: "insufficient_data",
      insufficientReason: review.insufficient,
      skills: null,
      overall: null,
      feedback: null,
      confidence: "low",
    };
  }
  const byId = new Map(review.dimensions.map((d) => [d.id, d]));
  const skill = (id: DimensionId) => {
    const d = byId.get(id);
    return {
      score: d?.score ?? null,
      evidenceQuote: null,
      reason: d?.note ?? "Not scored by the offline coach.",
    };
  };
  return {
    status: "scored",
    insufficientReason: null,
    skills: {
      structuredThinking: skill("structured"),
      starCar: skill("framework"),
      measurableImpact: skill("impact"),
      clarityDelivery: skill("clarity"),
      ownership: skill("ownership"),
      roleFit: skill("culture"),
    },
    overall: review.score,
    feedback: {
      strength: {
        text: review.feedback[0] ?? "Clean pass — keep this shape.",
        quote: "",
        atSec: null,
      },
      priorityFix: {
        text:
          review.feedback[1] ??
          "Tighten the final sentence into a crisp takeaway.",
        quote: "",
        atSec: null,
        drill: null,
      },
      rewrittenSentence: { original: "", improved: "" },
      vsLastAttempt: null,
      askUser: null,
    },
    confidence: "low",
  };
}

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function InterviewLiveStage({
  questions,
  context,
  onFinished,
}: {
  questions: GeneratedQuestion[];
  context: InterviewContext;
  onFinished: (feedbacks: InterviewFeedback[]) => void;
}) {
  const [index, setIndex] = React.useState(0);
  const [answering, setAnswering] = React.useState(false);
  const [elapsedSec, setElapsedSec] = React.useState(0);
  const [transcripts, setTranscripts] = React.useState<Record<string, string>>({});
  const [feedbacks, setFeedbacks] = React.useState<Record<string, InterviewFeedback>>({});
  /** Question id currently being scored by the LLM scorer. */
  const [scoringId, setScoringId] = React.useState<string | null>(null);
  const [scoreError, setScoreError] = React.useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = React.useState(true);

  const captions = useLiveCaptions(answering);
  const ttsAvailable = React.useMemo(() => speechSupported(), []);

  const question = questions[Math.min(index, Math.max(questions.length - 1, 0))];
  const answerId = question?.id ?? "";
  const committedTranscript = transcripts[answerId] ?? "";
  const feedback = feedbacks[answerId];
  const answeredCount = Object.keys(feedbacks).length;

  // Answer timer (committed seconds + current segment).
  const sessionSecondsRef = React.useRef(0);
  const startRef = React.useRef<number | null>(null);
  const elapsedRef = React.useRef(0);
  React.useEffect(() => {
    if (!answering) return;
    startRef.current = performance.now();
    const id = window.setInterval(() => {
      if (startRef.current !== null) {
        const value =
          sessionSecondsRef.current +
          (performance.now() - startRef.current) / 1000;
        elapsedRef.current = value;
        setElapsedSec(value);
      }
    }, 400);
    return () => {
      window.clearInterval(id);
      if (startRef.current !== null) {
        sessionSecondsRef.current += (performance.now() - startRef.current) / 1000;
        startRef.current = null;
        elapsedRef.current = sessionSecondsRef.current;
        setElapsedSec(sessionSecondsRef.current);
      }
    };
  }, [answering]);

  // Mane reads the current question aloud whenever we land on it.
  React.useEffect(() => {
    if (!question) return;
    if (ttsEnabled && ttsAvailable) {
      speak(question.question, { rate: 0.97 });
    }
    return () => stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, question?.id, ttsEnabled, ttsAvailable]);

  React.useEffect(() => () => stopSpeaking(), []);

  function hearQuestion(): void {
    if (question) speak(question.question, { rate: 0.97 });
  }

  function startAnswer(): void {
    captions.reset();
    sessionSecondsRef.current = 0;
    elapsedRef.current = 0;
    setElapsedSec(0);
    stopSpeaking();
    setAnswering(true);
  }

  /** Calls the LLM scorer, with a deterministic offline fallback (#23). */
  async function scoreAnswer(
    q: GeneratedQuestion,
    transcript: string,
    durationSec: number,
  ): Promise<void> {
    setScoreError(null);
    const words = transcript.trim()
      ? transcript.trim().split(/\s+/).filter(Boolean).length
      : 0;
    if (words < MIN_ANSWER_WORDS) {
      // Local "No answer detected" — no API call, no scores (#13/#24).
      setFeedbacks((prev) => ({
        ...prev,
        [q.id]: {
          status: "insufficient_data",
          insufficientReason: `No answer detected: ${words} word${words === 1 ? "" : "s"} captured — at least ${MIN_ANSWER_WORDS} are needed to score an answer.`,
          skills: null,
          overall: null,
          feedback: null,
          confidence: "low",
        },
      }));
      return;
    }
    setScoringId(q.id);
    try {
      // Local coach mode never calls the cloud — falls to the offline review below.
      if (isLocalCoach()) {
        throw new ScoreRequestError("Local coach mode", 0);
      }
      const result = await scoreInterviewAnswer({
        type: "interview",
        transcript,
        question: q.question,
        role: context.role,
        industry: industryLabel(context),
        projects: context.contextNotes,
        // The answer's stakes/priorities — was hardcoded empty before.
        objective: [
          q.competency ? `Practice the "${q.competency}" competency` : null,
          context.commitment ? `${context.commitment} role` : null,
          `Candidate desire ${context.desireRating}/5`,
        ]
          .filter(Boolean)
          .join(". "),
        previousAttempts: loadPreviousAttempts(q.id),
        /** The user's own interview baseline for comparison + the fix. */
        recentSessions: loadSessionHistory("interview")
          .slice(0, 3)
          .map((s) => ({
            at: s.completedAtMs,
            overall: s.score,
            skills: s.skills,
            title: s.title,
          })),
        measured: computeInterviewMeasured(transcript, durationSec),
      });
      setFeedbacks((prev) => ({ ...prev, [q.id]: result }));
      saveAttempt(q.id, transcript, result);
    } catch (err) {
      // Offline fallback keeps the flow usable without a valid API key.
      const review = evaluateAnswer({
        question: q,
        transcript,
        context,
        telemetry: { avgWpm: null, initiationDelaySec: null },
      });
      const local = feedbackFromLocalReview(review);
      setFeedbacks((prev) => ({ ...prev, [q.id]: local }));
      if (local.status === "scored") saveAttempt(q.id, transcript, local);
      const hint =
        err instanceof ScoreRequestError
          ? err.message
          : "Mane is busy, try again in a moment";
      setScoreError(`Scored with the offline coach (${hint}).`);
    } finally {
      setScoringId(null);
    }
  }

  function finishAnswer(): void {
    if (!question) return;
    const transcript = captions.transcript.trim() || committedTranscript;
    const duration = elapsedRef.current;
    setAnswering(false);
    setTranscripts((prev) => ({ ...prev, [question.id]: transcript }));
    void scoreAnswer(question, transcript, duration);
  }

  function recheck(id: string): void {
    const q = questions.find((x) => x.id === id);
    if (!q || scoringId) return;
    void scoreAnswer(q, transcripts[id] ?? "", 0);
  }

  function goTo(next: number): void {
    if (answering || !questions.length) return;
    setIndex(Math.max(0, Math.min(questions.length - 1, next)));
  }

  function handleFinish(): void {
    stopSpeaking();
    onFinished(
      questions
        .map((q) => feedbacks[q.id])
        .filter((f): f is InterviewFeedback => Boolean(f)),
    );
  }

  const allDone = answeredCount >= questions.length && questions.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid gap-5 lg:grid-cols-3"
    >
      {/* Left — question, answer controls, live feedback */}
      <div className="flex flex-col gap-4 lg:col-span-2">
        {/* Mane asks aloud */}
        <div className="flex items-start gap-3 rounded-none border border-iris-700/20 bg-iris-100/70 p-4">
          <Mane attire="interview" size={96} />
          <div className="mt-1 flex-1">
            <SpeechBubble
              text={
                question
                  ? `Question ${index + 1} of ${questions.length}: ${question.question}`
                  : "No questions here yet. Add one in the last step."
              }
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-iris-700/40 bg-card text-iris-900"
                disabled={!question || !ttsAvailable}
                onClick={hearQuestion}
                title={ttsAvailable ? "Play the question aloud" : "TTS unavailable"}
              >
                <Volume2 className="size-4" />
                Hear it again
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={ttsEnabled}
                disabled={!ttsAvailable}
                onClick={() => setTtsEnabled((v) => !v)}
              >
                {ttsEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                {ttsEnabled ? "Auto-speak on" : "Auto-speak off"}
              </Button>
              {!ttsAvailable && (
                <span className="text-xs text-ink-900/60">
                  Audio isn&apos;t available here. Just read the question out
                  loud.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Answer controls */}
        <div className="flex flex-wrap items-center gap-3 rounded-none border border-iris-700/20 bg-card/85 px-4 py-3 shadow-sm backdrop-blur">
          {!answering ? (
            <Button onClick={startAnswer} disabled={!question}>
              <Play className="size-4" />
              Start Answer
            </Button>
          ) : (
            <Button variant="destructive" onClick={finishAnswer}>
              <Square className="size-4" />
              Finish Answer
            </Button>
          )}
          <span className="flex items-center gap-1.5 text-sm text-ink-900/70 tabular-nums">
            <Clock className="size-4 text-iris-700" />
            {mmss(elapsedSec)}
          </span>
          <Badge
            variant="outline"
            className="border-iris-700/30 bg-card text-ink-800"
          >
            {answeredCount}/{questions.length} answered
          </Badge>
          {scoreError && (
            <span className="text-xs text-amber-700">{scoreError}</span>
          )}
        </div>

        {/* Transcript capture */}
        <Card className="border-iris-700/25">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-display text-sm">
              <Quote className="size-4 text-iris-700" />
              Your answer
            </CardTitle>
            <CardDescription>
              What you say becomes the transcript Mane scores — evidence
              quotes are checked against it word for word.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {answering ? (
              <p
                aria-live="polite"
                className="min-h-24 rounded-none border border-iris-700/15 bg-iris-50/70 p-3 text-sm text-ink-900/80"
              >
                {captions.transcript || "Listening for your words…"}
              </p>
            ) : (
              <Textarea
                aria-label="Answer transcript"
                rows={5}
                value={committedTranscript}
                placeholder="Press Start Answer and speak — your words land here. You can edit them before re-checking."
                onChange={(e) =>
                  setTranscripts((prev) => ({
                    ...prev,
                    [answerId]: e.target.value,
                  }))
                }
              />
            )}
          </CardContent>
        </Card>

        {/* Scoring in progress */}
        {scoringId && scoringId === answerId && (
          <Card className="border-iris-600/40 bg-iris-50/60">
            <CardContent className="flex items-center gap-3 py-5">
              <LoaderCircle className="size-5 animate-spin text-iris-700" />
              <p className="text-sm font-medium text-ink-900">
                Mane is scoring your answer…
              </p>
            </CardContent>
          </Card>
        )}

        {/* Insufficient data — "No answer detected" (#24) */}
        {feedback && !scoringId && feedback.status === "insufficient_data" && (
          <Card className="border-amber-400/40 bg-amber-500/10">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 font-display text-sm text-amber-800">
                <CircleDashed className="size-4 text-amber-700" />
                No answer detected
              </CardTitle>
              <CardDescription className="text-amber-800/80">
                {feedback.insufficientReason ??
                  "I couldn't hear a full answer, so there are no scores to show."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" variant="ghost" onClick={() => recheck(answerId)}>
                <RefreshCcw className="size-4" />
                Re-check after editing
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Scored feedback — skills + quotes + strength/fix/rewrite/compare (#24) */}
        {feedback && !scoringId && feedback.status === "scored" && (
          <Card className="border-iris-600/40 bg-iris-50/60">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 font-display text-sm">
                <CheckCircle2 className="size-4 text-iris-700" />
                Question {index + 1} score
                <span className="ml-auto rounded-none bg-iris-500 px-2 py-0.5 text-sm font-bold text-[#2a2118] tabular-nums">
                  {feedback.overall !== null ? `${feedback.overall}/100` : "n/a"}
                </span>
              </CardTitle>
              <CardDescription>
                Six skills with the words that earned them.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {SKILL_ENTRIES.map(([key, label]) => {
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

              {feedback.feedback && (
                <div className="flex flex-col gap-2 text-sm">
                  <p className="flex gap-2 text-ink-900">
                    <Target className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <span>
                      <span className="font-semibold">Strength:</span>{" "}
                      {feedback.feedback.strength.text}
                    </span>
                  </p>
                  <p className="flex gap-2 text-ink-900">
                    <Target className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <span>
                      <span className="font-semibold">Priority fix:</span>{" "}
                      {feedback.feedback.priorityFix.text}
                    </span>
                  </p>
                  {feedback.feedback.rewrittenSentence.improved && (
                    <p className="flex gap-2 rounded-none border border-iris-700/20 bg-card p-2.5 text-ink-800">
                      <Quote className="mt-0.5 size-4 shrink-0 text-iris-700" />
                      <span>
                        <span className="font-semibold">Say it like this:</span>{" "}
                        “{feedback.feedback.rewrittenSentence.improved}”
                      </span>
                    </p>
                  )}
                  {feedback.feedback.vsLastAttempt && (
                    <p className="flex gap-2 text-ink-900">
                      <History className="mt-0.5 size-4 shrink-0 text-iris-700" />
                      <span>{feedback.feedback.vsLastAttempt}</span>
                    </p>
                  )}
                  {feedback.feedback.askUser && (
                    <p className="flex gap-2 rounded-none border border-sky-400/40 bg-sky-500/10 p-2.5 text-sky-900">
                      <HelpCircle className="mt-0.5 size-4 shrink-0 text-sky-700" />
                      <span>{feedback.feedback.askUser}</span>
                    </p>
                  )}
                </div>
              )}

              <Button
                size="sm"
                variant="ghost"
                onClick={() => recheck(answerId)}
                disabled={Boolean(scoringId)}
              >
                <RefreshCcw className="size-4" />
                Re-check after editing
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right — camera + navigator */}
      <div className="flex flex-col gap-4">
        <CameraFeed active={answering} onActiveChange={setAnswering} />

        {/* Question navigator */}
        <Card className="border-iris-700/25">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-display text-sm">
              <Gauge className="size-4 text-iris-700" />
              Navigator
            </CardTitle>
            <CardDescription>
              Jump between questions. Finished ones keep their scores.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {questions.map((q, i) => {
                const done = Boolean(feedbacks[q.id]);
                return (
                  <button
                    key={q.id}
                    type="button"
                    aria-label={`Go to question ${i + 1}`}
                    aria-current={i === index}
                    disabled={answering}
                    onClick={() => goTo(i)}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-none text-xs font-bold tabular-nums transition-colors",
                      i === index
                        ? "bg-iris-600 text-[#FFFFFF] ring-2 ring-iris-500/40"
                        : done
                          ? "bg-iris-200 text-iris-900"
                          : "bg-ink-100 text-ink-700",
                    )}
                  >
                    {done ? <CheckCircle2 className="size-4" /> : i + 1}
                  </button>
                );
              })}
              {questions.length === 0 && (
                <CircleDashed className="size-5 text-ink-400" />
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={answering || index === 0}
                onClick={() => goTo(index - 1)}
              >
                <ChevronLeft className="size-4" />
                Prev
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={answering || index >= questions.length - 1}
                onClick={() => goTo(index + 1)}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Finish */}
        <Button
          size="lg"
          disabled={answering || answeredCount === 0 || Boolean(scoringId)}
          onClick={handleFinish}
          className="w-full bg-iris-500 text-[#2a2118] hover:bg-iris-400"
        >
          {allDone
            ? "Finish interview and see my report"
            : `End interview (${answeredCount}/${questions.length} answered)`}
        </Button>
      </div>
    </motion.div>
  );
}

