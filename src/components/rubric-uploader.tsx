"use client";

/**
 * Rubric & slide uploader for the Presentation Coach.
 *
 * Accepts slides as pasted text or a PDF/TXT/Markdown file (PDFs are sent
 * to the parse API as base64 and extracted by Gemini), plus a custom
 * grading rubric. "Parse" turns both into a structured {@link ParsedRubric}
 * (qualitative directives, hard telemetry rules, semantic overrides) and
 * publishes the session inputs — including the speech transcript — to the
 * parent page via `onUpdate`.
 */

import * as React from "react";
import {
  ClipboardList,
  Eye,
  FileCheck,
  LoaderCircle,
  ScrollText,
  Sparkles,
  Target,
  Trash2,
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_PDF_BYTES,
  MAX_RUBRIC_CHARS,
  MAX_SLIDE_CHARS,
  MAX_TRANSCRIPT_CHARS,
} from "@/lib/presentation";
import type { ParsedRubric, TelemetryRule } from "@/lib/presentation";
import { localParseRubric } from "@/lib/offline-engine";
import { isLocalCoach } from "@/lib/prefs-store";
import { apiJson, isHandledApiError } from "@/lib/api";

/** Everything the evaluation API needs from the presenter. */
export interface PresentationInputs {
  slideText: string;
  transcript: string;
  rubric: ParsedRubric | null;
}

interface SlidePdfFile {
  name: string;
  base64: string;
  mimeType: string;
}

const TEXT_FILE_PATTERN = /\.(txt|md|markdown|csv|text)$/i;

/** Reads a file as raw base64 (strip the data-URL prefix). */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read the file."));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.readAsDataURL(file);
  });
}

function formatRule(rule: TelemetryRule): string {
  const bound =
    rule.comparator === "ideal_range" && rule.valueMax !== null
      ? `${rule.value}–${rule.valueMax}`
      : `${rule.value}`;
  return `${rule.metric} ${rule.comparator === "ideal_range" ? "≈" : rule.comparator === "at_least" ? "≥" : "≤"} ${bound} ${rule.unit}`;
}

export function RubricUploader({
  onUpdate,
}: {
  /** Called whenever slides/transcript/parsed rubric change. */
  onUpdate?: (inputs: PresentationInputs) => void;
}) {
  const [slidesText, setSlidesText] = React.useState("");
  const [rubricText, setRubricText] = React.useState("");
  const [transcript, setTranscript] = React.useState("");
  const [slidePdf, setSlidePdf] = React.useState<SlidePdfFile | null>(null);
  const [parsed, setParsed] = React.useState<ParsedRubric | null>(null);
  const [parsing, setParsing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Publish inputs to the parent page (evaluation payload source).
  React.useEffect(() => {
    onUpdate?.({
      slideText: parsed?.slideText || slidesText,
      transcript,
      rubric: parsed,
    });
  }, [slidesText, transcript, parsed, onUpdate]);

  async function handleSlideFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(null);
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      if (file.size > MAX_PDF_BYTES) {
        setError("Slide PDF exceeds the 10 MB limit.");
        return;
      }
      const base64 = await readFileAsBase64(file).catch(() => null);
      if (base64 === null) {
        setError("Could not read the PDF file.");
        return;
      }
      setSlidePdf({ name: file.name, base64, mimeType: "application/pdf" });
      setSlidesText("");
    } else if (file.type.startsWith("text/") || TEXT_FILE_PATTERN.test(file.name)) {
      setSlidePdf(null);
      setSlidesText(await file.text());
    } else {
      setError("Unsupported slide file — use PDF, TXT, or Markdown.");
    }
  }

  async function handleRubricFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("text/") && !TEXT_FILE_PATTERN.test(file.name)) {
      setError("Rubric files must be TXT, Markdown, or CSV.");
      return;
    }
    setRubricText(await file.text());
  }

  async function handleParse(): Promise<void> {
    setError(null);
    if (!rubricText.trim()) {
      setError("Paste or upload your grading rubric first.");
      return;
    }
    if (rubricText.length > MAX_RUBRIC_CHARS) {
      setError(`Rubric exceeds ${MAX_RUBRIC_CHARS.toLocaleString()} characters.`);
      return;
    }
    if (!slidePdf && slidesText.length > MAX_SLIDE_CHARS) {
      setError(
        `Slide text exceeds ${MAX_SLIDE_CHARS.toLocaleString()} characters.`,
      );
      return;
    }
    setParsing(true);
    // Local coach mode never calls the cloud — parse with the offline engine.
    if (isLocalCoach()) {
      setParsed(
        localParseRubric({ rubricText, slideText: slidePdf ? "" : slidesText }),
      );
      setParsing(false);
      return;
    }
    try {
      const data = await apiJson<ParsedRubric>(
        "/api/presentation/parse-rubric",
        {
          rubricText,
          slideText: slidePdf ? "" : slidesText,
          slidePdf: slidePdf
            ? { data: slidePdf.base64, mimeType: slidePdf.mimeType }
            : null,
        },
        "Rubric parsing failed",
      );
      setParsed(data);
    } catch (err) {
      if (isHandledApiError(err)) return; // CTA / paused notice already shown
      setError(err instanceof Error ? err.message : "Rubric parsing failed.");
    } finally {
      setParsing(false);
    }
  }

  function handleClear(): void {
    setSlidesText("");
    setRubricText("");
    setTranscript("");
    setSlidePdf(null);
    setParsed(null);
    setError(null);
  }

  const canParse = !parsing && rubricText.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="size-4" />
          Rubric &amp; slides
        </CardTitle>
        <CardDescription>
          Upload slides (PDF/TXT/Markdown) and your custom grading rubric —
          Gemini parses them into qualitative directives, hard telemetry
          rules, and intentional-turn overrides.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Slides */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="slide-upload">
              Presentation slides
            </label>
            <Input
              id="slide-upload"
              type="file"
              accept=".pdf,.txt,.md,.markdown,text/plain,application/pdf"
              className="h-9"
              onChange={(event) => void handleSlideFile(event.target.files?.[0])}
            />
            {slidePdf && (
              <Badge variant="secondary" className="w-fit gap-1">
                <FileCheck className="size-3" />
                {slidePdf.name}
              </Badge>
            )}
            <Textarea
              rows={6}
              value={slidesText}
              disabled={slidePdf !== null}
              placeholder="…or paste slide text / outline here (— Slide 1 — …)"
              onChange={(event) => setSlidesText(event.target.value)}
            />
          </div>

          {/* Rubric */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="rubric-upload">
              Custom grading rubric
            </label>
            <Input
              id="rubric-upload"
              type="file"
              accept=".txt,.md,.markdown,.csv,text/plain,text/markdown,text/csv"
              className="h-9"
              onChange={(event) => void handleRubricFile(event.target.files?.[0])}
            />
            <Textarea
              rows={6}
              value={rubricText}
              placeholder={"Paste your rubric, e.g.\n· Ideal pace 130–160 wpm\n· Pause < 2 s between sections\n· Glance at the side-wall slide when referencing it — no camera staring required\n· Open with a narrative hook"}
              onChange={(event) => setRubricText(event.target.value)}
            />
          </div>
        </div>

        {/* Transcript */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="transcript-input">
            Speech transcript
          </label>
          <Textarea
            id="transcript-input"
            rows={5}
            value={transcript}
            placeholder="Paste the transcript of your presentation (from your recording tool or notes) — the evaluator cross-references it with telemetry."
            onChange={(event) => setTranscript(event.target.value.slice(0, MAX_TRANSCRIPT_CHARS))}
          />
          <p className="text-xs text-muted-foreground">
            {transcript.length.toLocaleString()} /{" "}
            {MAX_TRANSCRIPT_CHARS.toLocaleString()} characters
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void handleParse()} disabled={!canParse}>
            {parsing ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {parsing
              ? "Parsing…"
              : parsed
                ? "Re-parse rubric & slides"
                : "Parse rubric & slides"}
          </Button>
          <Button variant="outline" onClick={handleClear}>
            <Trash2 className="size-4" />
            Clear
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {/* Parsed result */}
        {parsed && (
          <div className="flex flex-col gap-3 rounded-none border border-border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="gap-1">
                <Sparkles className="size-3" />
                Parsed
              </Badge>
              <span className="text-sm font-medium">{parsed.title}</span>
            </div>
            {parsed.summary && (
              <p className="text-sm text-muted-foreground">{parsed.summary}</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">
                <ClipboardList className="size-3" />
                {parsed.directives.length} directives
              </Badge>
              <Badge variant="secondary">
                <Target className="size-3" />
                {parsed.telemetryRules.length} telemetry rules
              </Badge>
              <Badge variant="secondary">
                <Eye className="size-3" />
                {parsed.semanticOverrides.length} intentional-turn overrides
              </Badge>
            </div>

            {parsed.telemetryRules.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Hard telemetry rules
                </p>
                <ul className="flex flex-col gap-1">
                  {parsed.telemetryRules.slice(0, 8).map((rule, index) => (
                    <li
                      key={`${rule.metric}-${index}`}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="font-mono text-xs">
                        {formatRule(rule)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {rule.description}
                      </span>
                      <Badge
                        variant={rule.severity === "hard" ? "destructive" : "outline"}
                        className="shrink-0"
                      >
                        {rule.severity}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {parsed.semanticOverrides.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Intentional turns (never penalized)
                </p>
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {parsed.semanticOverrides.map((override, index) => (
                    <li key={index}>
                      · <span className="text-foreground">{override.cue}</span>{" "}
                      → protects{" "}
                      <span className="font-mono text-xs">
                        {override.protects.join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {parsed.directives.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Qualitative directives
                </p>
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {parsed.directives.slice(0, 6).map((directive, index) => (
                    <li key={index}>
                      · [{directive.category}] {directive.instruction}{" "}
                      <span className="text-xs">({directive.slideRef})</span>
                    </li>
                  ))}
                  {parsed.directives.length > 6 && (
                    <li className="text-xs">
                      +{parsed.directives.length - 6} more…
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


