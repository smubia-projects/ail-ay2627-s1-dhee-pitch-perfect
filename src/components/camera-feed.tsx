"use client";

/**
 * Live camera telemetry view: streams the webcam into a <video>, draws the
 * MediaPipe landmark wireframes on an overlaid <canvas> (mirrored and
 * cover-cropped exactly like the video) and shows live status badges plus
 * audio stats fed by the `useTelemetry` hook.
 */

import * as React from "react";
import {
  FaceLandmarker,
  HandLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  Activity,
  Camera,
  CameraOff,
  Eye,
  LoaderCircle,
  PersonStanding,
  Play,
  Square,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ArmsCrossedBadge,
  AudioSpectrum,
  EyeContactBadge,
  MonotoneAlertBadge,
  SpeakersBoxBadge,
  StatPill,
  TelemetryGlowBadge,
} from "@/components/ui/telemetry-badge";
import { cn } from "@/lib/utils";
import type { DualRubricDraft } from "@/lib/dual-rubric";
import {
  useTelemetry,
  type LandmarkConnection,
  type SessionSummary,
  type TelemetryMetrics,
} from "@/hooks/use-telemetry";

/** Getters the parent page consumes after (or during) a session. */
export interface SessionProvider {
  summary: () => SessionSummary | null;
  dualDraft: () => DualRubricDraft | null;
  recordingUrl: () => string | null;
}

/**
 * Wireframe tables. MediaPipe exposes them as statics typed with the
 * package-internal `Connection` interface, which is structurally
 * `{ start, end }` — matching our exported `LandmarkConnection`.
 */
const POSE_CONNECTIONS: LandmarkConnection[] = PoseLandmarker.POSE_CONNECTIONS;
const HAND_CONNECTIONS: LandmarkConnection[] = HandLandmarker.HAND_CONNECTIONS;
const FACE_CONTOURS: LandmarkConnection[] =
  FaceLandmarker.FACE_LANDMARKS_CONTOURS;
const FACE_IRIS: LandmarkConnection[] = [
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
];

type MapAxis = (value: number) => number;

interface PointStyle {
  color: string;
  radius?: number;
  width?: number;
  alpha?: number;
  minVisibility?: number;
}

function drawConnections(
  ctx: CanvasRenderingContext2D,
  points: NormalizedLandmark[],
  connections: LandmarkConnection[],
  mapX: MapAxis,
  mapY: MapAxis,
  style: PointStyle,
): void {
  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width ?? 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const connection of connections) {
    const a = points[connection.start];
    const b = points[connection.end];
    if (!a || !b) continue;
    if (
      style.minVisibility !== undefined &&
      ((a.visibility ?? 1) < style.minVisibility ||
        (b.visibility ?? 1) < style.minVisibility)
    ) {
      continue;
    }
    ctx.moveTo(mapX(a.x), mapY(a.y));
    ctx.lineTo(mapX(b.x), mapY(b.y));
  }
  ctx.stroke();
  ctx.restore();
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  points: NormalizedLandmark[],
  mapX: MapAxis,
  mapY: MapAxis,
  style: PointStyle,
): void {
  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.fillStyle = style.color;
  for (const p of points) {
    if (
      style.minVisibility !== undefined &&
      (p.visibility ?? 1) < style.minVisibility
    ) {
      continue;
    }
    ctx.beginPath();
    ctx.arc(mapX(p.x), mapY(p.y), style.radius ?? 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  mapX: MapAxis,
  mapY: MapAxis,
  color: string,
): void {
  const x1 = mapX(rect.x);
  const x2 = mapX(rect.x + rect.width);
  const y1 = mapY(rect.y);
  const y2 = mapY(rect.y + rect.height);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.abs(x2 - x1),
    Math.abs(y2 - y1),
  );
  ctx.restore();
}

// ---------------------------------------------------------------------------
// CameraFeed
// ---------------------------------------------------------------------------

export function CameraFeed({
  onSessionProvider,
  onTelemetry,
  active: activeProp,
  onActiveChange,
  muted = false,
  ignoreDeviceInteraction = false,
}: {
  /**
   * Called once with getters for the aggregated summary, the dual-rubric
   * draft and the replay recording — the evaluation page consumes all three
   * when it builds the report.
   */
  onSessionProvider?: (provider: SessionProvider) => void;
  /** Reports live metrics (throttled to ~4 Hz) while telemetry runs. */
  onTelemetry?: (metrics: TelemetryMetrics | null) => void;
  /** Controlled recording state (for page-level toolbar controls). */
  active?: boolean;
  /** Notified whenever the record toggle is pressed. */
  onActiveChange?: (active: boolean) => void;
  /** Disables the mic track without restarting the camera session. */
  muted?: boolean;
  /**
   * Hardware calibration — the presenter drives slides/clicks from this very
   * device, so MediaPipe keyboard/clicker movements are excluded from
   * posture & fidget scoring instead of being penalised.
   */
  ignoreDeviceInteraction?: boolean;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const sizeRef = React.useRef({ width: 0, height: 0 });
  const [internalActive, setInternalActive] = React.useState(false);
  const active = activeProp ?? internalActive;
  const setActive = (next: boolean) => {
    setInternalActive(next);
    onActiveChange?.(next);
  };

  const {
    status,
    error,
    telemetry,
    frameRef,
    getSessionSummary,
    getDualRubricDraft,
    getRecordingUrl,
  } = useTelemetry(videoRef, {
    enabled: active,
    muted,
    ignoreDeviceInteraction,
  });

  // Publish the session resources to the parent page (stable callback).
  const provider = React.useMemo<SessionProvider>(
    () => ({
      summary: getSessionSummary,
      dualDraft: getDualRubricDraft,
      recordingUrl: getRecordingUrl,
    }),
    [getSessionSummary, getDualRubricDraft, getRecordingUrl],
  );
  React.useEffect(() => {
    onSessionProvider?.(provider);
  }, [onSessionProvider, provider]);

  // Forward live metrics (e.g. for the interview answer recorder).
  React.useEffect(() => {
    onTelemetry?.(telemetry);
  }, [onTelemetry, telemetry]);

  // Track the container size so the canvas backing store matches CSS pixels.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        sizeRef.current = { width: rect.width, height: rect.height };
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Drawing loop — reads `frameRef` at display rate (no React re-renders).
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let rafId = 0;
    const draw = () => {
      rafId = requestAnimationFrame(draw);
      const { width, height } = sizeRef.current;
      if (width <= 0 || height <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      const backingW = Math.round(width * dpr);
      const backingH = Math.round(height * dpr);
      if (canvas.width !== backingW || canvas.height !== backingH) {
        canvas.width = backingW;
        canvas.height = backingH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const frame = frameRef.current;
      const video = videoRef.current;
      if (!frame || !video) return;

      // Mirror the drawing to match the CSS-mirrored <video>, and apply the
      // same cover-crop math so landmarks stay glued to the picture.
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      const scale = Math.max(width / vw, height / vh);
      const offX = (width - scale * vw) / 2;
      const offY = (height - scale * vh) / 2;
      const mapX = (nx: number) => width - (offX + scale * nx * vw);
      const mapY = (ny: number) => offY + scale * ny * vh;

      if (frame.pose) {
        drawConnections(ctx, frame.pose, POSE_CONNECTIONS, mapX, mapY, {
          color: "#38bdf8",
          width: 2,
          alpha: 0.85,
          minVisibility: 0.5,
        });
        drawPoints(ctx, frame.pose, mapX, mapY, {
          color: "#e0f2fe",
          radius: 2,
          alpha: 0.9,
          minVisibility: 0.5,
        });
      }

      if (frame.face) {
        drawConnections(ctx, frame.face, FACE_CONTOURS, mapX, mapY, {
          color: "#a78bfa",
          width: 1,
          alpha: 0.5,
        });
        drawConnections(ctx, frame.face, FACE_IRIS, mapX, mapY, {
          color: "#c4b5fd",
          width: 1,
          alpha: 0.9,
        });
        drawPoints(ctx, frame.face, mapX, mapY, {
          color: "#ddd6fe",
          radius: 1,
          alpha: 0.5,
        });
      }

      for (const hand of frame.hands) {
        drawConnections(ctx, hand, HAND_CONNECTIONS, mapX, mapY, {
          color: "#fbbf24",
          width: 2,
          alpha: 0.9,
        });
        drawPoints(ctx, hand, mapX, mapY, {
          color: "#fde68a",
          radius: 1.5,
          alpha: 0.9,
        });
      }

      const box = frame.metrics.box;
      if (box) {
        drawBox(
          ctx,
          box.rect,
          mapX,
          mapY,
          box.inside === false ? "#E8656F" : "#10b981",
        );
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [frameRef]);

  const running = active && status === "running";

  return (
    <div className="flex flex-col gap-3">
      {/* Sleek glassmorphic video-player frame */}
      <div className="rounded-none border border-white/10 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-2 shadow-2xl shadow-black/40 ring-1 ring-white/5">
        <div
          ref={containerRef}
          className="relative aspect-video w-full overflow-hidden rounded-none bg-black"
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={cn(
              "absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity duration-300",
              running ? "opacity-100" : "opacity-0",
            )}
          />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

          {/* Cinematic vignettes keep floating overlays readable */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-24 bg-gradient-to-b from-black/60 via-black/20 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-24 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />

          {/* Controls — glass pill top-right */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            {status === "starting" && (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-none border border-white/10 bg-black/50 px-3 text-xs text-white/90 backdrop-blur-md">
                <LoaderCircle className="size-3 animate-spin" />
                Loading models…
              </span>
            )}
            <Button
              size="sm"
              variant={active ? "secondary" : "default"}
              disabled={status === "starting"}
              onClick={() => setActive(!active)}
              className={
                active
                  ? "border border-white/10 bg-white/15 text-white backdrop-blur-md hover:bg-white/25"
                  : undefined
              }
            >
              {active ? (
                <>
                  <Square className="size-3.5" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="size-3.5" />
                  Start camera
                </>
              )}
            </Button>
          </div>

          {/* Idle / error overlay — dark glass */}
          {!active && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/55 text-white/60 backdrop-blur-sm">
              <CameraOff className="size-8" />
              <p className="text-sm">
                Camera&apos;s off. Start a session and your live feedback
                shows up here.
              </p>
            </div>
          )}
          {error && (
            <div className="absolute inset-x-3 bottom-3 z-20 rounded-none border border-rose-400/30 bg-rose-500/15 px-3 py-2 text-xs text-rose-200 backdrop-blur-md">
              {error}
            </div>
          )}

          {/* Floating telemetry glow badges — top-left */}
          {running && telemetry && (
            <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[75%] flex-col items-start gap-1.5">
              {telemetry.detected.pose && telemetry.posture && (
                <TelemetryGlowBadge
                  icon={PersonStanding}
                  tone={telemetry.posture.good ? "iris" : "rose"}
                  pulse={!telemetry.posture.good}
                >
                  {telemetry.posture.good
                    ? "Good Posture"
                    : `Leaning ${Math.abs(telemetry.posture.leanDeg).toFixed(0)}°`}
                </TelemetryGlowBadge>
              )}
              {telemetry.detected.face && telemetry.head && (
                !telemetry.head.facingScreen ? (
                  <TelemetryGlowBadge tone="rose" icon={Eye} pulse>
                    Looking away {Math.abs(telemetry.head.yawDeg).toFixed(0)}°
                  </TelemetryGlowBadge>
                ) : telemetry.gaze ? (
                  <EyeContactBadge
                    ok={telemetry.gaze.eyeContact}
                    deviationDeg={telemetry.gaze.deviationDeg}
                  />
                ) : null
              )}
              {telemetry.box && (
                <SpeakersBoxBadge inside={telemetry.box.inside} />
              )}
              {telemetry.arms && (
                <ArmsCrossedBadge crossed={telemetry.arms.crossed} />
              )}
              <TelemetryGlowBadge
                icon={Activity}
                tone={
                  telemetry.movement.state === "steady"
                    ? "iris"
                    : telemetry.movement.state === "swaying"
                      ? "amber"
                      : "indigo"
                }
                pulse={telemetry.movement.state === "swaying"}
              >
                {telemetry.movement.state === "steady"
                  ? "Steady"
                  : telemetry.movement.state === "swaying"
                    ? `Swaying ${telemetry.movement.frequencyHz.toFixed(1)} Hz`
                    : "Lateral Step"}
              </TelemetryGlowBadge>
            </div>
          )}

          {/* Floating audio cluster — bottom-left */}
          {running && telemetry?.audio.available && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[80%] flex-wrap items-center gap-2">
              <AudioSpectrum
                level={Math.min(telemetry.audio.rms * 6, 1)}
                active={telemetry.audio.speaking}
              />
              <StatPill
                className={
                  telemetry.audio.speaking
                    ? "border-iris-400/40 text-iris-200"
                    : undefined
                }
              >
                {telemetry.audio.speaking ? "Speaking" : "Silent"}
              </StatPill>
              <StatPill>
                {telemetry.audio.speaking
                  ? `Nice pauses: ${telemetry.audio.avgPauseSec.toFixed(1)}s between ideas`
                  : `Pause ${telemetry.audio.currentPauseSec.toFixed(1)}s`}
              </StatPill>
              <MonotoneAlertBadge pitchStdDevHz={telemetry.audio.pitchStdDevHz} />
            </div>
          )}

          {/* FPS — bottom-right */}
          {running && (
            <div className="absolute bottom-3 right-3 z-10">
              <StatPill className="text-white/70">
                {(telemetry?.fps ?? 0).toFixed(0)} FPS
              </StatPill>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        <Camera className="mr-1 inline size-3" />
        I&apos;m tracking quietly in the background. Your camera feed never
        leaves this device.
      </p>
    </div>
  );
}


