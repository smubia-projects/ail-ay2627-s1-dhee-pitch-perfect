"use client";

/**
 * Presentation Coach · Step 4 — Live Presentation Room.
 * Split UI: webcam feed (MediaPipe pose/face/hands telemetry + Web Speech
 * captions) on the left, slide preview / script HUD on the right, with
 * Start Presentation / Presentation Done controls. On finish it hands the
 * session summary, dual-rubric draft, transcript, and replay URL back to
 * the page for evaluation.
 */

import * as React from "react";
import { motion } from "framer-motion";
import {
  Captions,
  CheckCircle2,
  Clock,
  Gauge,
  Keyboard,
  Mic,
  MicOff,
  MonitorPlay,
  Play,
  ScrollText,
  Square,
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
import { CameraFeed, type SessionProvider } from "@/components/camera-feed";
import { Mane } from "@/components/mascot/mane";
import { SpeechBubble } from "@/components/mascot/speech-bubble";
import { useLiveCaptions } from "@/hooks/use-live-captions";
import type { SessionSummary } from "@/hooks/use-telemetry";
import type { DualRubricDraft } from "@/lib/dual-rubric";
import { cn } from "@/lib/utils";
import {
  PURPOSE_OPTIONS,
  type DeckCalibration,
  type PurposeSelection,
} from "@/lib/manestage";

export interface LiveRoomResult {
  /** Live captions captured during the run (may be empty). */
  transcript: string;
  /** Wall-clock seconds the run lasted (sum of active segments). */
  elapsedSec: number;
  summary: SessionSummary | null;
  dualDraft: DualRubricDraft | null;
  recordingUrl: string | null;
}

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PresentationLiveRoom({
  purpose,
  calibration,
  onFinished,
}: {
  purpose: PurposeSelection;
  calibration: DeckCalibration;
  onFinished: (result: LiveRoomResult) => void;
}) {
  const [recording, setRecording] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [finishing, setFinishing] = React.useState(false);
  const [elapsedSec, setElapsedSec] = React.useState(0);

  const captions = useLiveCaptions(recording);
  const providerRef = React.useRef<SessionProvider | null>(null);

  /** Pause / resume the session (CameraFeed follows the `recording` prop). */
  function handleToggle(): void {
    setRecording((v) => !v);
  }
  const handleSessionProvider = React.useCallback(
    (provider: SessionProvider) => {
      providerRef.current = provider;
    },
    [],
  );

  /** Live WPM straight from the captions: words / elapsed minutes. */
  const wordCount = captions.transcript.trim()
    ? captions.transcript.trim().split(/\s+/).length
    : 0;
  const liveWpm =
    wordCount > 0 && elapsedSec >= 3
      ? Math.round((wordCount / Math.max(elapsedSec, 1)) * 60)
      : 0;

  // Practice timer: committed seconds + the current recording segment.
  const sessionSecondsRef = React.useRef(0);
  const recordingStartRef = React.useRef<number | null>(null);
  const elapsedRef = React.useRef(0);
  React.useEffect(() => {
    if (!recording) return;
    recordingStartRef.current = performance.now();
    const id = window.setInterval(() => {
      if (recordingStartRef.current !== null) {
        const value =
          sessionSecondsRef.current +
          (performance.now() - recordingStartRef.current) / 1000;
        elapsedRef.current = value;
        setElapsedSec(value);
      }
    }, 400);
    return () => {
      window.clearInterval(id);
      if (recordingStartRef.current !== null) {
        sessionSecondsRef.current +=
          (performance.now() - recordingStartRef.current) / 1000;
        recordingStartRef.current = null;
        elapsedRef.current = sessionSecondsRef.current;
        setElapsedSec(sessionSecondsRef.current);
      }
    };
  }, [recording]);

  function handleStart(): void {
    captions.reset();
    sessionSecondsRef.current = 0;
    elapsedRef.current = 0;
    setElapsedSec(0);
    setRecording(true);
  }

  /**
   * Presentation Done — stop capture, give MediaRecorder a beat to finalize
   * the blob, then hand everything to the page for evaluation.
   */
  function handleDone(): void {
    setFinishing(true);
    setRecording(false);
    window.setTimeout(() => {
      onFinished({
        transcript: captions.transcript,
        elapsedSec: elapsedRef.current,
        summary: providerRef.current?.summary() ?? null,
        dualDraft: providerRef.current?.dualDraft() ?? null,
        recordingUrl: providerRef.current?.recordingUrl() ?? null,
      });
      setFinishing(false);
    }, 900);
  }

  const purposeLabel =
    PURPOSE_OPTIONS.find((o) => o.id === purpose.id)?.label ?? "Presentation";
  const bubbleText = finishing
    ? "Done. Grabbing your results, one sec."
    : recording
      ? captions.supported
        ? "You're live. Talk like they're right there. I'm watching your posture, pace, and eyes."
        : "You're live. Speak to the camera like it's your audience."
      : "Press Start when you're ready. I'll stay quiet and just watch.";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid gap-5 lg:grid-cols-3"
    >
      {/* Left — controls + webcam telemetry */}
      <div className="flex flex-col gap-4 lg:col-span-2">
        {/* Control bar — sticky under the navbar so the fixed bottom dock
            can never overlap it on mobile, and Done stays available for the
            whole session (not swapped out when the camera pauses). */}
        <div className="sticky top-16 z-30 flex flex-wrap items-center gap-3 rounded-none border border-iris-700/20 bg-card/90 px-4 py-3 shadow-sm backdrop-blur">
          <Button
            size="lg"
            disabled={finishing}
            onClick={elapsedSec > 0 ? handleToggle : handleStart}
          >
            {recording ? (
              <>
                <Square className="size-4" />
                Pause
              </>
            ) : (
              <>
                <Play className="size-4" />
                {elapsedSec > 0 ? "Resume" : "Start Presentation"}
              </>
            )}
          </Button>

          {elapsedSec > 0 && (
            <Button
              size="lg"
              variant="destructive"
              disabled={finishing}
              onClick={handleDone}
            >
              <CheckCircle2 className="size-4" />
              {finishing ? "Wrapping up…" : "Presentation Done"}
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            aria-pressed={muted}
            title={muted ? "Unmute microphone" : "Mute microphone"}
            className={cn(muted && "border-iris-600 text-iris-800")}
            onClick={() => setMuted((v) => !v)}
          >
            {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            <span className="hidden sm:inline">{muted ? "Muted" : "Mic on"}</span>
          </Button>

          <span className="flex items-center gap-1.5 text-sm font-medium text-ink-800 tabular-nums">
            <Clock className="size-4 text-iris-700" />
            {mmss(elapsedSec)}
          </span>
          {liveWpm > 0 && (
            <Badge
              variant="outline"
              className="border-iris-600/50 bg-iris-100 text-iris-800 tabular-nums"
            >
              <Gauge className="size-3" />
              {liveWpm} wpm
            </Badge>
          )}
          {recording && (
            <span className="flex items-center gap-2 text-xs text-iris-800">
              <span className="inline-block size-2 animate-pulse rounded-none bg-iris-700" />
              {captions.supported ? "Listening…" : "Recording…"}
            </span>
          )}

          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-ink-300 bg-ink-50 text-ink-800"
            >
              {purposeLabel}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                calibration.usingDeviceForSlides
                  ? "border-iris-600 bg-iris-100 text-iris-800"
                  : "border-ink-300 bg-ink-50 text-ink-700",
              )}
            >
              <Keyboard className="size-3" />
              {calibration.usingDeviceForSlides
                ? "Using this device"
                : "Full scoring"}
            </Badge>
          </span>
        </div>

        {/* Webcam + MediaPipe telemetry */}
        <CameraFeed
          onSessionProvider={handleSessionProvider}
          active={recording}
          onActiveChange={setRecording}
          muted={muted}
          ignoreDeviceInteraction={calibration.usingDeviceForSlides}
        />
      </div>
      {/* Right — Mane + slide/script/caption HUDs */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-none border border-iris-700/20 bg-iris-100/70 p-3">
          <Mane attire="presenter" size={84} />
          <SpeechBubble className="mt-1 flex-1" text={bubbleText} />
        </div>

        {/* Slide preview HUD */}
        <Card className="border-iris-700/25">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-display text-sm">
              <MonitorPlay className="size-4 text-iris-700" />
              Slide preview
              {calibration.deckFileName && (
                <span className="ml-auto truncate text-xs font-normal text-ink-900/55">
                  {calibration.deckFileName}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-44 overflow-y-auto rounded-none border border-iris-700/15 bg-card p-3">
              {calibration.slideText.trim() ? (
                <pre className="font-sans text-xs whitespace-pre-wrap text-ink-900/80">
                  {calibration.slideText}
                </pre>
              ) : (
                <p className="text-xs text-ink-500">
                  No slides yet. You can still practice and I&apos;ll score
                  how you deliver.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Script HUD */}
        <Card className="border-iris-700/25">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-display text-sm">
              <ScrollText className="size-4 text-iris-700" />
              Script or outline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-36 overflow-y-auto rounded-none border border-iris-700/15 bg-card p-3">
              {calibration.scriptText.trim() ? (
                <pre className="font-sans text-xs whitespace-pre-wrap text-ink-900/80">
                  {calibration.scriptText}
                </pre>
              ) : (
                <p className="text-xs text-ink-500">
                  No script needed. I&apos;ll write down what you say as you
                  go.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Live captions */}
        <Card className="border-iris-700/25">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-display text-sm">
              <Captions className="size-4 text-iris-700" />
              Live transcript
              {recording && (
                <span className="ml-auto flex items-center gap-2 text-xs font-normal text-iris-800">
                  <span className="inline-block size-2 animate-pulse rounded-none bg-iris-700" />
                  {captions.supported ? "Listening…" : "Recording…"}
                  <span className="rounded-none bg-iris-100 px-2 py-0.5 font-semibold tabular-nums text-iris-900">
                    {mmss(elapsedSec)}
                  </span>
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {captions.supported
                ? "What you say feeds your speaking score: pace, filler words, and clarity."
                : "This browser can't do live captions. Your script still counts for your speaking score."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p
              aria-live="polite"
              className="min-h-20 rounded-none border border-iris-700/10 bg-iris-50/70 p-3 text-sm text-ink-900/80"
            >
              {captions.transcript ||
                (recording
                  ? "Listening for your words…"
                  : "Your words will appear here once you start.")}
            </p>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}