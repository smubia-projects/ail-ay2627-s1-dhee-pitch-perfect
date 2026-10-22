/** POST /api/presentation/parse-rubric — JSON: { rubricText, slideText, slidePdf? }. Returns directives, telemetry rules and overrides. */

import type { Request, Response } from "express";

import {
  chatCompletion,
  generateWithRetry,
  jsonSchemaFormat,
  pdfFilePart,
  type ContentPart,
} from "@/lib/openrouter";
import {
  MAX_PDF_BYTES,
  MAX_RUBRIC_CHARS,
  MAX_SLIDE_CHARS,
  trimForPrompt,
} from "@/lib/presentation";
import type { ParsedRubric } from "@/lib/presentation";

/** Strict JSON output schema for the rubric parser. */
const PARSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        "Presentation title derived from the slides or rubric, else a short generic title.",
    },
    slideText: {
      type: "string",
      description:
        "Normalized slide content (titles + bullets, slide markers preserved). Extracted from the PDF when one is attached; lightly normalized when provided as text; empty string when no slides were supplied.",
    },
    directives: {
      type: "array",
      maxItems: 40,
      description:
        "Qualitative coaching directives: narrative hooks, structure, content, delivery, visual aids.",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [
              "narrative_hook",
              "structure",
              "content",
              "delivery",
              "visual_aid",
              "other",
            ],
          },
          instruction: {
            type: "string",
            description: "One concise, actionable directive.",
          },
          slideRef: {
            type: "string",
            description:
              'Slide or section the directive targets, e.g. "slide 3", "opening", "n/a".',
          },
        },
        required: ["category", "instruction", "slideRef"],
      },
    },
    telemetryRules: {
      type: "array",
      maxItems: 30,
      description:
        "Hard numeric rules the rubric implies for webcam/mic telemetry (ideal pace, posture strictness, eye contact limits, …).",
      items: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: [
              "wpm",
              "pause_seconds",
              "pitch_std_hz",
              "posture_lean_deg",
              "shoulder_tilt_deg",
              "gaze_deviation_deg",
              "head_yaw_deg",
              "arms_crossed_seconds",
              "hands_outside_box_seconds",
              "sway_frequency_hz",
              "sway_seconds",
              "steps",
            ],
          },
          comparator: {
            type: "string",
            enum: ["at_least", "at_most", "ideal_range"],
          },
          value: { type: "number" },
          valueMax: {
            type: ["number", "null"],
            description: "Upper bound for ideal_range, else null.",
          },
          unit: {
            type: "string",
            description: 'Unit of the threshold, e.g. "wpm", "deg", "sec".',
          },
          severity: {
            type: "string",
            enum: ["hard", "soft"],
          },
          description: {
            type: "string",
            description: "The rubric wording this rule was derived from.",
          },
        },
        required: [
          "metric",
          "comparator",
          "value",
          "valueMax",
          "unit",
          "severity",
          "description",
        ],
      },
    },
    semanticOverrides: {
      type: "array",
      maxItems: 15,
      description:
        "Moments the rubric requires the speaker to intentionally break a telemetry norm (turning to a physical slide, table, demo, …) — these must not be flagged as distracted gaze.",
      items: {
        type: "object",
        properties: {
          cue: {
            type: "string",
            description: "What the rubric asks the speaker to do.",
          },
          protects: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "gaze_off_camera",
                "turned_away",
                "posture_lean",
                "arms_crossed",
                "hands_outside_box",
                "swaying",
              ],
            },
          },
          guidance: {
            type: "string",
            description:
              "How the evaluator can recognize this moment in the transcript (phrase, topic, slide cue).",
          },
        },
        required: ["cue", "protects", "guidance"],
      },
    },
    summary: {
      type: "string",
      description: "1–2 sentence overview of the parsed rubric.",
    },
  },
  required: [
    "title",
    "slideText",
    "directives",
    "telemetryRules",
    "semanticOverrides",
    "summary",
  ],
};

interface ParseRubricRequest {
  slideText?: string;
  /** Base64-encoded PDF slides (forwarded to the model as a PDF file part). */
  slidePdf?: { data: string; mimeType: string } | null;
  rubricText?: string;
  title?: string;
}

function buildPrompt(title: string | undefined): string {
  return `You are the parser for an AI Presentation Coach. You receive a custom grading rubric and the presenter's slide material, and you must return ONLY a JSON object matching the provided schema.

TASKS
1. slideText — Produce the normalized slide content. If a PDF is attached, extract its text slide by slide in order, prefixing each with "— Slide N —" (keep titles and bullets, drop decorative noise). If slide text was supplied inline, normalize it lightly (keep slide markers). If there are no slides, return "".
2. directives — Extract every QUALITATIVE directive the coach should hold the speaker to: narrative hooks (openers, stories, callbacks), structure (agenda, signposting, transitions, recap), content points, delivery instructions (tone, audience engagement style, enthusiasm), and visual-aid usage. One directive per distinct instruction; quote-faithfully but concise; set slideRef to the target slide/section ("slide 3", "opening", "n/a").
3. telemetryRules — Convert every HARD numeric requirement the rubric states or clearly implies about webcam/mic telemetry into a rule:
   • pace → metric "wpm"; pauses → "pause_seconds"; vocal variety → "pitch_std_hz";
   • upright stance → "posture_lean_deg" / "shoulder_tilt_deg"; eye contact → "gaze_deviation_deg";
   • facing the audience → "head_yaw_deg"; uncrossed arms → "arms_crossed_seconds";
   • hands in the speaker's box → "hands_outside_box_seconds"; stillness → "sway_frequency_hz" / "sway_seconds"; deliberate movement → "steps".
   Use comparator "at_least" for minimums, "at_most" for limits, "ideal_range" (value..valueMax) for target bands like "ideal pace 130–160 wpm". severity = "hard" when the rubric states an explicit pass/fail limit or score deduction, "soft" when it is a preference. Eye-contact/gaze rules are ALWAYS "soft" — camera-lens eye contact is never a hard pass/fail. DO NOT invent rules the rubric never mentions.
4. semanticOverrides — When the rubric REQUIRES the speaker to deliberately break a telemetry norm (e.g. turn to look at a physical slide, whiteboard, table, audience member, or demo device), register an override so the evaluator treats those moments as INTENTIONAL instead of "distracted gaze". cue = what the rubric asks for; protects = the telemetry signals that must not be penalized while the cue applies (usually gaze_off_camera and/or turned_away); guidance = the exact transcript phrase/topic the evaluator can use to align the moment (e.g. "when the transcript references the chart on the side wall"). Return [] when the rubric has no such requirement.
5. summary — 1–2 sentences describing the rubric.

RULES
- Output JSON only, matching the schema exactly. No markdown, no commentary.
- Rubric title: ${title ? title : "derive a short title from the rubric or slides"}.
- Never invent numeric thresholds that are not in the rubric.`;
}

export async function parseRubricHandler(req: Request, res: Response) {
  // express.json() has already parsed (and size-capped) the body.
  const body = (req.body ?? {}) as ParseRubricRequest;

  const rubricText = (body.rubricText ?? "").trim();
  const slideText = (body.slideText ?? "").trim();
  const slidePdf = body.slidePdf ?? null;

  if (!rubricText && !slideText && !slidePdf) {
    return res.status(400).json({ error: "Provide rubric text and/or slide content to parse." });
  }
  if (rubricText.length > MAX_RUBRIC_CHARS) {
    return res.status(400).json({ error: `Rubric exceeds ${MAX_RUBRIC_CHARS.toLocaleString()} characters.` });
  }
  if (slideText.length > MAX_SLIDE_CHARS) {
    return res.status(400).json({ error: `Slide text exceeds ${MAX_SLIDE_CHARS.toLocaleString()} characters.` });
  }
  if (slidePdf && (slidePdf.data.length * 3) / 4 > MAX_PDF_BYTES) {
    return res.status(400).json({ error: "PDF slides exceed the 10 MB limit." });
  }

  if (!(process.env.API_KEY || process.env.OPENROUTER_API_KEY)?.trim()) {
    return res.status(500).json({ error: "Rubric parsing is not configured (OPENROUTER_API_KEY missing)." });
  }

  // Build content parts: instructions first, then slide text or PDF.
  const sections = [buildPrompt(body.title)];
  if (slideText) {
    sections.push(`SLIDE TEXT:\n${trimForPrompt(slideText, MAX_SLIDE_CHARS)}`);
  }
  sections.push(
    `RUBRIC:\n${rubricText ? trimForPrompt(rubricText, MAX_RUBRIC_CHARS) : "(no rubric text supplied — derive only slide content and obvious defaults; do not invent rules)"}`,
  );

  const parts: ContentPart[] = [{ type: "text", text: sections.join("\n\n") }];
  if (slidePdf) {
    parts.push(pdfFilePart(slidePdf.data));
  }

  const promptChars = parts.reduce(
    (sum, part) => sum + (part.type === "text" ? part.text.length : 0),
    0,
  );
  console.info(
    `[agent:rubric-parse] step=received rubricChars=${rubricText.length} slideChars=${slideText.length} pdfBytes=${slidePdf ? Math.round((slidePdf.data.length * 3) / 4) : 0} promptChars=${promptChars}`,
  );

  try {
    const text = await generateWithRetry(() =>
      chatCompletion({
        messages: [{ role: "user", content: parts }],
        temperature: 0.2,
        maxTokens: 4096,
        responseFormat: jsonSchemaFormat("parsed_rubric", PARSE_SCHEMA),
      }),
    );
    const parsed = JSON.parse(text) as ParsedRubric;

    // Minimal structural validation before handing it to the UI.
    const rubric: ParsedRubric = {
      title: typeof parsed.title === "string" ? parsed.title : "Untitled rubric",
      slideText: typeof parsed.slideText === "string" ? parsed.slideText : "",
      directives: Array.isArray(parsed.directives) ? parsed.directives : [],
      telemetryRules: Array.isArray(parsed.telemetryRules)
        ? parsed.telemetryRules
        : [],
      semanticOverrides: Array.isArray(parsed.semanticOverrides)
        ? parsed.semanticOverrides
        : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };

    console.info(
      `[agent:rubric-parse] step=rubric-parsed title="${rubric.title}" directives=${rubric.directives.length} telemetryRules=${rubric.telemetryRules.length}`,
    );
    return res.json(rubric);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Rubric parsing failed.";
    console.error(`[agent:rubric-parse] step=failed error="${message.slice(0, 200)}"`);
    return res.status(502).json({ error: `AI rubric parsing failed: ${message}` });
  }
}


