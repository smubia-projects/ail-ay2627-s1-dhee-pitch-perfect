"use client";

/**
 * Presentation Coach · Step 3 — Deck & Hardware Calibration.
 * Upload fields for the slide deck (PDF/PPTX, parsed in-browser) and an
 * optional presentation script/outline, plus the interactive hardware
 * switch that flags MediaPipe tracking to ignore keyboard/clicker laptop
 * interactions so they are never scored as negative posture/fidgeting.
 */

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  FileUp,
  Keyboard,
  LoaderCircle,
  ScrollText,
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
import { PosturePreference } from "@/components/posture-preference";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mane } from "@/components/mascot/mane";
import { SpeechBubble } from "@/components/mascot/speech-bubble";
import { cn } from "@/lib/utils";
import { MAX_SLIDE_CHARS, MAX_TRANSCRIPT_CHARS } from "@/lib/presentation";
import {
  isLegacyPpt,
  isSupportedSlideFile,
  extractSlideText,
} from "@/lib/slide-extractor";
import type { DeckCalibration } from "@/lib/manestage";

export function CalibrationStep({
  value,
  onChange,
  onContinue,
}: {
  value: DeckCalibration;
  onChange: (next: DeckCalibration) => void;
  onContinue: () => void;
}) {
  const [slidesError, setSlidesError] = React.useState<string | null>(null);
  const [extracting, setExtracting] = React.useState(false);

  async function handleDeckFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setSlidesError(null);
    if (!isSupportedSlideFile(file)) {
      setSlidesError("That file type won't work. Use PDF, PPTX, TXT, or Markdown.");
      return;
    }
    if (isLegacyPpt(file)) {
      setSlidesError(
        "Old .ppt files don't open here. Save it as .pptx or paste your outline below.",
      );
      return;
    }
    setExtracting(true);
    try {
      const text = await extractSlideText(file);
      if (text.length > MAX_SLIDE_CHARS) {
        setSlidesError(
          `Slide text exceeds ${MAX_SLIDE_CHARS.toLocaleString()} characters.`,
        );
      } else {
        onChange({ ...value, slideText: text, deckFileName: file.name });
      }
    } catch (err) {
      setSlidesError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setExtracting(false);
    }
  }

  async function handleScriptFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const text = await file.text();
      onChange({
        ...value,
        scriptText: text.slice(0, MAX_TRANSCRIPT_CHARS),
      });
    } catch {
      setSlidesError("Could not read that script file.");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-5"
    >
      {/* Mane guides calibration */}
      <div className="flex items-start gap-3 rounded-none border border-iris-700/20 bg-iris-100/70 p-4">
        <Mane attire="presenter" size={96} />
        <SpeechBubble
          className="mt-2 flex-1"
          text="Add your slides and script if you have them. Then answer one quick question about your setup."
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Slide deck upload */}
        <Card className="border-iris-700/25">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-base">
              <FileUp className="size-4 text-iris-700" />
              Slide deck
            </CardTitle>
            <CardDescription>
              PDF and PPTX load right here in your browser. You can also
              paste an outline. Both work.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-ink-900" htmlFor="deck-file">
                Upload deck (PDF, PPTX, TXT, or Markdown)
              </label>
              <Input
                id="deck-file"
                type="file"
                accept=".pdf,.pptx,.ppsx,.txt,.md,.markdown,.csv"
                className="h-9"
                onChange={(e) => void handleDeckFile(e.target.files?.[0])}
              />
              {extracting && (
                <p className="flex items-center gap-1.5 text-xs text-iris-800">
                  <LoaderCircle className="size-3 animate-spin" />
                  Reading your slides…
                </p>
              )}
              {value.deckFileName && !extracting && (
                <p className="flex items-center gap-1.5 text-xs text-iris-800">
                  <CheckCircle2 className="size-3" />
                  Loaded {value.deckFileName}
                </p>
              )}
              {slidesError && (
                <p className="text-sm text-destructive">{slidesError}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-ink-900" htmlFor="slide-text">
                Slide text or outline
              </label>
              <Textarea
                id="slide-text"
                rows={7}
                value={value.slideText}
                placeholder={"Slide 1\nTitle and key bullets…\n\nSlide 2\n…"}
                onChange={(e) =>
                  onChange({
                    ...value,
                    slideText: e.target.value.slice(0, MAX_SLIDE_CHARS),
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                {value.slideText.length.toLocaleString()} /{" "}
                {MAX_SLIDE_CHARS.toLocaleString()} characters
              </p>
            </div>
          </CardContent>
        </Card>
        {/* Script / outline */}
        <Card className="border-iris-700/25">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-base">
              <ScrollText className="size-4 text-iris-700" />
              Your script or outline
            </CardTitle>
            <CardDescription>
              This is optional. I compare what you say against it. No script?
              I&apos;ll just listen.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-ink-900" htmlFor="script-file">
                Upload script (TXT or MD)
              </label>
              <Input
                id="script-file"
                type="file"
                accept=".txt,.md,.markdown"
                className="h-9"
                onChange={(e) => void handleScriptFile(e.target.files?.[0])}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-ink-900" htmlFor="script-text">
                …or paste it here
              </label>
              <Textarea
                id="script-text"
                rows={9}
                value={value.scriptText}
                placeholder={
                  "Good morning. For the next ten minutes I'll show you…\n\n1) The problem\n2) What we tried\n3) What I recommend"
                }
                onChange={(e) =>
                  onChange({
                    ...value,
                    scriptText: e.target.value.slice(0, MAX_TRANSCRIPT_CHARS),
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                {value.scriptText.length.toLocaleString()} /{" "}
                {MAX_TRANSCRIPT_CHARS.toLocaleString()} characters
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Interactive hardware switch */}
      <Card
        className={cn(
          "border-2 transition-colors",
          value.usingDeviceForSlides
            ? "border-iris-600 bg-iris-50"
            : "border-iris-700/25 bg-card",
        )}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Keyboard className="size-4 text-iris-700" />
            One quick question
            {value.usingDeviceForSlides && (
              <Badge className="ml-auto border-iris-600/50 bg-iris-100 text-iris-800">
                Clicks won&apos;t count against you
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Are you going to be using the device you are currently practicing
            your presentation for, to access the slides and click?
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              aria-pressed={value.usingDeviceForSlides}
              className={cn(
                "flex-1 rounded-none border px-5 py-3 text-sm font-semibold transition-colors",
                value.usingDeviceForSlides
                  ? "border-iris-600 bg-iris-500 text-[#2a2118] shadow-[0_8px_20px_rgba(139,90,60,0.4)]"
                  : "border-iris-700/25 bg-card text-ink-800 hover:border-iris-700/50",
              )}
              onClick={() => onChange({ ...value, usingDeviceForSlides: true })}
            >
              Yes, I&apos;ll use this laptop
            </button>
            <button
              type="button"
              aria-pressed={!value.usingDeviceForSlides}
              className={cn(
                "flex-1 rounded-none border px-5 py-3 text-sm font-semibold transition-colors",
                !value.usingDeviceForSlides
                  ? "border-iris-600 bg-iris-500 text-[#2a2118] shadow-[0_8px_20px_rgba(139,90,60,0.4)]"
                  : "border-iris-700/25 bg-card text-ink-800 hover:border-iris-700/50",
              )}
              onClick={() => onChange({ ...value, usingDeviceForSlides: false })}
            >
              No, I&apos;ll use a second screen or clicker
            </button>
          </div>
          <p className="rounded-none border border-iris-700/20 bg-card px-3 py-2.5 text-xs text-ink-900/70">
            {value.usingDeviceForSlides ? (
              <>
                <span className="font-semibold text-iris-800">
                  Got it.
                </span>{" "}
                Reaching for your keyboard or glancing down at your slides
                won&apos;t count against you. I&apos;ll note it on your
                timeline.
              </>
            ) : (
              <>
                <span className="font-semibold text-iris-800">
                  Full scoring is on.
                </span>{" "}
                Every lean, glance, and fidget counts toward your body score.
              </>
            )}
          </p>
        </CardContent>
      </Card>

      {/* Sitting vs standing (P2) */}
      <Card className="border border-iris-700/25 bg-card">
        <CardContent>
          <PosturePreference />
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button size="lg" onClick={onContinue}>
          Enter the live room
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </motion.div>
  );
}