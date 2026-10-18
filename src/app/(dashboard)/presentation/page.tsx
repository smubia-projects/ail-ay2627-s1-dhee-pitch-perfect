"use client";

/**
 * Presentation Coach — 5-step Manestage wizard:
 *   1. Purpose selection (3 curated purposes + custom questionnaire)
 *   2. Rubric customization (curated criteria, weight sliders, custom rules)
 *   3. Deck & hardware calibration (PDF/PPTX upload, script, device switch)
 *   4. Live presentation room (webcam + MediaPipe + Web Speech captions)
 *   5. Post-presentation analytics (cue badges, contextual feedback,
 *      interactive quality timeline, save/discard video)
 */

import * as React from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Presentation as PresentationIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/ui/step-indicator";
import { PurposeStep } from "@/components/presentation/purpose-step";
import { RubricStep } from "@/components/presentation/rubric-step";
import { CalibrationStep } from "@/components/presentation/calibration-step";
import {
  PresentationLiveRoom,
  type LiveRoomResult,
} from "@/components/presentation/live-room";
import {
  PresentationResults,
  type VideoState,
} from "@/components/presentation/results-panel";
import type { Scorecard } from "@/lib/presentation";
import { MAX_TRANSCRIPT_CHARS, scriptCoveragePct } from "@/lib/presentation";
import { finalizeDualRubric, type DualRubricReport } from "@/lib/dual-rubric";
import { localEvaluatePresentation } from "@/lib/offline-engine";
import { isLocalCoach } from "@/lib/prefs-store";
import { useLocalCoach } from "@/hooks/use-local-coach";
import { loadWhitelist } from "@/lib/whitelist-store";
import { savePracticeSession, loadSessionHistory } from "@/lib/session-history";
import type { PresentationFeedback } from "@/lib/presentation-feedback-schema";
import { ScoreRequestError, scorePresentationRun } from "@/lib/score-client";
import {
  loadPreviousPresentationRuns,
  savePresentationRun,
} from "@/lib/attempt-history";
import {
  RUBRIC_PRESETS,
  buildRubricFromCriteria,
  describePurpose,
  type DeckCalibration,
  type PurposeSelection,
  type RubricCriterion,
} from "@/lib/manestage";

const STEPS = ["Purpose", "What matters", "Slides and setup", "Live room", "Results"];

/** Convert a report row (earned/max) into a 0–100 skill value. */
function rowPct(
  rows: Array<{ id: string; earned: number; max: number }> | undefined,
  id: string,
  fallback: number,
): number {
  const row = rows?.find((r) => r.id === id);
  if (!row || row.max === 0) return fallback;
  return Math.max(0, Math.min(100, Math.round((row.earned / row.max) * 100)));
}

export default function PresentationCoachPage() {
  const [step, setStep] = React.useState(0);
  /** Reflects the navbar privacy toggle in the header copy. */
  const [localCoach] = useLocalCoach();

  // Step 1 — purpose (incl. custom questionnaire)
  const [purpose, setPurpose] = React.useState<PurposeSelection>({
    id: "case-study",
    custom: null,
  });
  // Step 2 — weighted rubric criteria
  const [criteria, setCriteria] = React.useState<RubricCriterion[]>(
    RUBRIC_PRESETS["case-study"].map((c) => ({ ...c })),
  );
  /** True once the user edits the weights themselves (#10: preset weights
      are never presented as the user's own choices). */
  const [criteriaTouched, setCriteriaTouched] = React.useState(false);
  // Step 3 — deck & hardware calibration
  const [calibration, setCalibration] = React.useState<DeckCalibration>({
    deckFileName: null,
    slideText: "",
    scriptText: "",
    usingDeviceForSlides: true,
  });

  // Step 4 → 5 — live session + evaluation
  const [scorecard, setScorecard] = React.useState<Scorecard | null>(null);
  const [report, setReport] = React.useState<DualRubricReport | null>(null);
  const [replayUrl, setReplayUrl] = React.useState<string | null>(null);
  const [evaluating, setEvaluating] = React.useState(false);
  const [evalError, setEvalError] = React.useState<string | null>(null);
  const [videoState, setVideoState] = React.useState<VideoState>("pending");
  /** LLM scorer output for this run (#28) — null until it resolves. */
  const [scoreFeedback, setScoreFeedback] =
    React.useState<PresentationFeedback | null>(null);
  const [feedbackError, setFeedbackError] = React.useState<string | null>(null);
  /** True when the LLM scorer failed for a reason a Retry could fix. */
  const [feedbackRetryable, setFeedbackRetryable] = React.useState(false);
  /** Re-run handleEvaluate with the same result when the user hits Retry. */
  const lastResultRef = React.useRef<LiveRoomResult | null>(null);
  /** Overall of the run just before this one — feeds the "vs last run" delta. */
  const [previousOverall, setPreviousOverall] = React.useState<number | null>(
    null,
  );

  // Deep links from the home cards: ?step=rubrics | practice
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const param = new URLSearchParams(window.location.search).get("step");
      if (param === "rubrics") setStep(1);
      else if (param === "practice") setStep(3);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Step transitions ---------------------------------------------------------
  function handlePurposeContinue(next: PurposeSelection): void {
    setPurpose(next);
    setCriteria(RUBRIC_PRESETS[next.id].map((c) => ({ ...c })));
    setCriteriaTouched(false);
    setStep(1);
  }

  function handleLiveFinished(result: LiveRoomResult): void {
    setScoreFeedback(null);
    setFeedbackError(null);
    setFeedbackRetryable(false);
    lastResultRef.current = result;
    setStep(4);
    void handleEvaluate(result);
  }

  /** Re-run only the LLM scorer for the last run (#28) — used by the Retry button. */
  function handleFeedbackRetry(): void {
    const result = lastResultRef.current;
    if (!result) return;
    setScoreFeedback(null);
    setFeedbackError(null);
    setFeedbackRetryable(false);
    void handleEvaluate(result);
  }

  // Step 5 — evaluation ------------------------------------------------------
  async function handleEvaluate(result: LiveRoomResult): Promise<void> {
    setEvaluating(true);
    setEvalError(null);
    setVideoState("pending");
    setReplayUrl((prev) => {
      if (prev && prev !== result.recordingUrl) URL.revokeObjectURL(prev);
      return result.recordingUrl;
    });
    try {
      // Script wins as the written transcript; live captions otherwise.
      const words = (result.transcript || calibration.scriptText).trim();
      if (!words) {
        setEvalError(
          "I couldn't hear any words. Turn on the mic or paste your script and try again. Your body scores below still count.",
        );
      }
      const reportDraft = result.dualDraft
        ? finalizeDualRubric(result.dualDraft, words.slice(0, MAX_TRANSCRIPT_CHARS))
        : null;
      setReport(reportDraft);

      // Real WPM straight from the captions ÷ elapsed minutes.
      const spokenWords = result.transcript.trim()
        ? result.transcript.trim().split(/\s+/).length
        : 0;
      const spokenWpm =
        spokenWords > 0 && result.elapsedSec >= 3
          ? Math.round((spokenWords / Math.max(result.elapsedSec, 1)) * 60)
          : 0;
      const summary = result.summary
        ? {
            ...result.summary,
            audio: { ...result.summary.audio, estimatedWpm: spokenWpm },
          }
        : null;

      const rubric = buildRubricFromCriteria(purpose, criteria);

      // Optional Gemini route first; local engine always ready as fallback.
      // Local coach mode never calls the cloud — straight to the local engine.
      let resultCard: Scorecard | null = null;
      if (words && !isLocalCoach()) {
        try {
          const response = await fetch("/api/presentation/evaluate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcript: words,
              slideText: calibration.slideText,
              rubric,
              telemetry: summary,
            }),
          });
          if (response.ok) {
            const data = (await response.json()) as Scorecard;
            if (typeof data.overallScore === "number") resultCard = data;
          }
        } catch {
          /* network/key unavailable → local engine below */
        }
      }
      if (!resultCard) {
        resultCard = localEvaluatePresentation({
          transcript: words,
          slideText: calibration.slideText,
          rubric,
          telemetry: summary,
          whitelisted: loadWhitelist(),
          recentOveralls: loadSessionHistory("presentation")
            .slice(0, 3)
            .map((s) => s.score),
        });
      }
      setScorecard(resultCard);

      // #28 — LLM scorer runs alongside the offline card; it owns history
      // persistence (invalid runs are never saved, #11/#14/#25).
      void scoreWithLlm(words, result, reportDraft, resultCard, rubric.title);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : "Evaluation failed.");
    } finally {
      setEvaluating(false);
    }
  }

  /** Filler words measured in CODE — never asked of the model (#28). */
  function countFillers(transcript: string): { count: number; list: string[] } {
    const re = /\b(um+|uh+|erm+|hmm+|like|you know|i mean)\b/gi;
    const matches = transcript.match(re) ?? [];
    return {
      count: matches.length,
      list: [...new Set(matches.map((m) => m.toLowerCase()))],
    };
  }

  /**
   * Scores the run with the LLM scorer (/api/score, presentation type) and
   * persists history. Falls back to the offline-engine save when the scorer
   * is unreachable; insufficient-data runs are never saved (#11/#14/#25).
   */
  async function scoreWithLlm(
    transcript: string,
    result: LiveRoomResult,
    reportDraft: DualRubricReport | null,
    resultCard: Scorecard,
    rubricTitle: string,
  ): Promise<void> {
    setFeedbackError(null);
    const summary = result.summary;
    const cameraOn = reportDraft?.nonVerbal.status === "ok";
    const words = transcript.trim()
      ? transcript.trim().split(/\s+/).filter(Boolean)
      : [];
    const fillers = countFillers(transcript);
    const gazeDen = summary
      ? summary.gaze.onCameraSec + summary.gaze.offCameraSec
      : 0;
    const postureDen = summary
      ? summary.posture.goodSec + summary.posture.violationSec
      : 0;
    const custom = purpose.id === "custom" ? purpose.custom : null;
    const objective = custom
      ? custom.objectiveText.trim()
      : describePurpose(purpose);

    /** Persist history from the local scorecard when the LLM scorer didn't run. */
    function saveOfflineScore(hint: string): void {
      setFeedbackError(`Scored with the offline coach (${hint}).`);
      const overall = reportDraft
        ? reportDraft.finalScore
        : resultCard.overallScore;
      const scorable =
        overall !== null &&
        (reportDraft !== null || transcript.trim().length > 0);
      if (scorable && overall !== null) {
        const nonVerbalRows = reportDraft?.nonVerbal.rows;
        const verbalRows = reportDraft?.verbal.rows;
        const posture = rowPct(nonVerbalRows, "posture", overall);
        const presence = rowPct(nonVerbalRows, "kinetic", overall);
        savePracticeSession({
          track: "presentation",
          score: overall,
          grade: resultCard.grade,
          title: rubricTitle,
          summary: resultCard.summary,
          highlights: resultCard.improvements.slice(0, 3),
          skills: {
            Pace: rowPct(verbalRows, "pacing", overall),
            "Eye Contact": rowPct(nonVerbalRows, "gaze", overall),
            Posture: posture,
            Clarity: rowPct(verbalRows, "clarity", overall),
            Structure: rowPct(verbalRows, "structure", overall),
            Presence: Math.round((posture + presence) / 2),
          },
        });
      }
    }

    // Local coach mode never calls the cloud — score and save on-device only.
    if (isLocalCoach()) {
      saveOfflineScore("local coach mode");
      return;
    }

    try {
      const prevRuns = loadPreviousPresentationRuns(2);
      /** The user's own baseline — sent to the scorer and shown as a delta. */
      const recentSessions = loadSessionHistory("presentation")
        .slice(0, 3)
        .map((s) => ({
          at: s.completedAtMs,
          overall: s.score,
          skills: s.skills,
          title: s.title,
        }));
      setPreviousOverall(
        prevRuns.length ? prevRuns[prevRuns.length - 1].overall : null,
      );
      const feedback = await scorePresentationRun({
        type: "presentation",
        transcript,
        // Only user-provided context — empty strings are "not provided" (#10/#27).
        objective,
        keyTakeaways: custom?.keyTakeaway.trim() ?? "",
        audience: custom?.audience.type.trim() ?? "",
        callToAction: custom?.callToAction.trim() ?? "",
        slidesText: calibration.slideText,
        scriptText: calibration.scriptText.slice(0, MAX_TRANSCRIPT_CHARS),
        // Priorities always flow to the scorer: preset weights are still the
        // user's stated focus (#10 only governs how the UI presents them).
        rubricText: criteria
          .map((c) => `${c.label} (weight ${c.weight})`)
          .join("; "),
        priorities: criteria.map((c) => ({ label: c.label, weight: c.weight })),
        previousRuns: prevRuns,
        recentSessions,
        /** Timestamped camera events the model may cite with atSec.
            Sitting mode drops stance/leg events — they aren't scorable. */
        events: (summary?.events ?? [])
          .filter(
            (e) =>
              summary?.postMode !== "sitting" ||
              (e.kind !== "swaying" && e.kind !== "stepping"),
          )
          .slice(0, 30)
          .map((e) => ({
            kind: e.kind,
            startSec: Math.round(e.startMs / 1000),
            endSec: Math.round(e.endMs / 1000),
          })),
        measured: {
          cameraOn,
          wordCount: words.length,
          wordsPerMinute:
            summary?.audio.estimatedWpm ??
            (result.elapsedSec >= 3
              ? Math.round(words.length / (result.elapsedSec / 60))
              : 0),
          fillerCount: fillers.count,
          fillerList: fillers.list,
          pauseCount: summary?.audio.speechSegments ?? null,
          avgPauseSec: summary?.audio.avgPauseSec ?? null,
          gazePct:
            cameraOn && summary && gazeDen > 0
              ? Math.round((summary.gaze.onCameraSec / gazeDen) * 100)
              : null,
          posturePct:
            cameraOn && summary && postureDen > 0
              ? Math.round((summary.posture.goodSec / postureDen) * 100)
              : null,
          // Sitting mode: stance/leg movement isn't scorable → not measured.
          fidgetFlags:
            summary && summary.postMode !== "sitting"
              ? summary.movement.swayingEvents
              : null,
          /** Resolved posture mode — sitting excludes stance/leg cues (P2). */
          postMode: summary?.postMode ?? "standing",
          /** Script-vs-delivered drift: content-word coverage (P3). */
          scriptCoveragePct: scriptCoveragePct(
            calibration.scriptText,
            transcript,
          ),
          durationSec: Math.round(result.elapsedSec),
        },
      });
      setScoreFeedback(feedback);

      if (feedback.status === "scored" && feedback.overall !== null) {
        const overall = feedback.overall;
        savePresentationRun({
          overall,
          strength: feedback.feedback?.strength.text ?? null,
        });
        const skills: Record<string, number> = {};
        const put = (label: string, v: number | null | undefined) => {
          if (typeof v === "number") skills[label] = v;
        };
        put("Pace", feedback.skills?.pace.score);
        put("Eye Contact", feedback.skills?.eyeContact.score);
        put("Posture", feedback.skills?.posture.score);
        put("Clarity", feedback.skills?.clarity.score);
        put("Structure", feedback.skills?.structure.score);
        put("Presence", feedback.skills?.presence.score);
        savePracticeSession({
          track: "presentation",
          score: overall,
          grade: resultCard.grade,
          title: rubricTitle,
          summary: resultCard.summary,
          highlights: [
            feedback.feedback?.strength.text ?? "",
            feedback.feedback?.priorityFix.text ?? "",
          ]
            .filter(Boolean)
            .slice(0, 3),
          skills,
        });
      }
      // insufficient_data → nothing saved (#11/#14/#25).
    } catch (err) {
      // The cloud scorer failed. Do NOT pretend it worked: label the offline
      // numbers honestly as basic metrics (no content analysis), and offer a
      // Retry when the failure is one a re-run could fix (not a bad API key).
      const isScoreErr = err instanceof ScoreRequestError;
      const hint = isScoreErr
        ? err.message
        : "Mane is busy, try again in a moment";
      const retryable = isScoreErr ? err.retryable : true;
      setFeedbackRetryable(retryable);
      saveOfflineScore(`${hint} — showing basic metrics only, no content analysis.`);
    }
  }

  // Session actions ----------------------------------------------------------
  function handleSaveVideo(): void {
    if (!replayUrl) return;
    const a = document.createElement("a");
    a.href = replayUrl;
    a.download = `manestage-presentation-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setVideoState("saved");
  }

  function handleDiscardVideo(): void {
    if (replayUrl) URL.revokeObjectURL(replayUrl);
    setReplayUrl(null);
    setVideoState("discarded");
  }

  function handleRetry(): void {
    setScorecard(null);
    setReport(null);
    setEvalError(null);
    setVideoState("pending");
    setReplayUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setStep(3);
  }

  function handleNewSetup(): void {
    setStep(0);
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
            <PresentationIcon />
            Presentation Coach
          </Badge>
          <span className="text-xs font-medium text-ink-600">
            {localCoach
              ? "Local coach — nothing leaves this device"
              : "Camera on-device · AI scoring in the cloud"}
          </span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">
          Practice your talk, then see how it landed
        </h1>
        <p className="max-w-2xl font-medium text-ink-700">
          Tell Mane what your talk is about, choose what matters most, check
          your slides and mic, then present. Your scores show up in seconds.
        </p>
        <StepIndicator steps={STEPS} current={step} className="mt-2" />
      </motion.div>

      {/* STEP 1 — Purpose selection */}
      {step === 0 && (
        <PurposeStep value={purpose} onContinue={handlePurposeContinue} />
      )}

      {/* STEP 2 — Rubric customization */}
      {step === 1 && (
        <>
          <RubricStep
            purpose={purpose}
            criteria={criteria}
            onChange={(next) => {
              setCriteria(next);
              setCriteriaTouched(true);
            }}
            onContinue={() => setStep(2)}
          />
          <div className="flex justify-start">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ArrowLeft className="size-4" />
              Back to purpose
            </Button>
          </div>
        </>
      )}

      {/* STEP 3 — Deck & hardware calibration */}
      {step === 2 && (
        <>
          <CalibrationStep
            value={calibration}
            onChange={setCalibration}
            onContinue={() => setStep(3)}
          />
          <div className="flex justify-start">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft className="size-4" />
              Back to rubrics
            </Button>
          </div>
        </>
      )}
      {/* STEP 4 — Live presentation room */}
      {step === 3 && (
        <>
          <PresentationLiveRoom
            purpose={purpose}
            calibration={calibration}
            onFinished={handleLiveFinished}
          />
          <div className="flex justify-start">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ArrowLeft className="size-4" />
              Back to calibration
            </Button>
          </div>
        </>
      )}

      {/* STEP 5 — Post-presentation analytics */}
      {step === 4 && (
        <PresentationResults
          purpose={purpose}
          criteria={criteria}
          criteriaTouched={criteriaTouched}
          feedback={scoreFeedback}
          feedbackError={feedbackError}
          feedbackRetryable={feedbackRetryable}
          onFeedbackRetry={handleFeedbackRetry}
          scorecard={scorecard}
          report={report}
          replayUrl={replayUrl}
          evaluating={evaluating}
          evalError={evalError}
          videoState={videoState}
          onSaveVideo={handleSaveVideo}
          onDiscardVideo={handleDiscardVideo}
          onRetry={handleRetry}
          onNewSetup={handleNewSetup}
          previousOverall={previousOverall}
        />
      )}
    </div>
  );
}