/** POST /api/presentation/evaluate — JSON: { transcript, slideText, rubric, telemetry }. Returns a point-by-point scorecard. */

import type { Request, Response } from "express";

import {
  chatCompletion,
  generateWithRetry,
  getModel,
  jsonSchemaFormat,
} from "@/lib/openrouter";
import {
  MAX_SLIDE_CHARS,
  MAX_TRANSCRIPT_CHARS,
  trimForPrompt,
} from "@/lib/presentation";
import type { ParsedRubric, Scorecard } from "@/lib/presentation";
import type { SessionSummary } from "@/hooks/use-telemetry";

/** Strict JSON output schema for the final scorecard. */
const SCORECARD_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    overallScore: {
      type: "number",
      description: "Overall score from 0 to 100 after all deductions.",
    },
    grade: {
      type: "string",
      enum: ["excellent", "good", "fair", "needs_work"],
    },
    summary: {
      type: "string",
      description: "2–4 sentence overall assessment.",
    },
    categories: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          maxPoints: { type: "integer" },
          awardedPoints: { type: "number" },
          deductionTotal: { type: "number" },
        },
        required: ["id", "name", "maxPoints", "awardedPoints", "deductionTotal"],
      },
    },
    points: {
      type: "array",
      minItems: 6,
      maxItems: 14,
      description:
        "Point-by-point scorecard: each rubric/telemetry criterion with deductions, feedback and evidence.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: 'e.g. "p1".' },
          category: {
            type: "string",
            description: "Category id this point belongs to.",
          },
          title: { type: "string" },
          status: {
            type: "string",
            enum: ["met", "deducted", "na"],
          },
          maxPoints: { type: "number" },
          pointsDeducted: { type: "number" },
          feedback: { type: "string" },
          evidence: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                source: {
                  type: "string",
                  enum: ["telemetry", "transcript", "rubric", "audio"],
                },
                detail: { type: "string" },
                timestampSec: {
                  type: ["number", "null"],
                  description:
                    "Seconds from session start when the evidence is a timestamped event.",
                },
                count: {
                  type: ["integer", "null"],
                  description: "Occurrence count for aggregated evidence.",
                },
              },
              required: ["source", "detail", "timestampSec", "count"],
            },
          },
          recommendation: { type: "string" },
        },
        required: [
          "id",
          "category",
          "title",
          "status",
          "maxPoints",
          "pointsDeducted",
          "feedback",
          "evidence",
          "recommendation",
        ],
      },
    },
    telemetryHighlights: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          metric: { type: "string" },
          observation: { type: "string" },
          assessment: {
            type: "string",
            enum: ["good", "ok", "needs_work"],
          },
        },
        required: ["metric", "observation", "assessment"],
      },
    },
    strengths: { type: "array", maxItems: 6, items: { type: "string" } },
    improvements: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
  },
  required: [
    "overallScore",
    "grade",
    "summary",
    "categories",
    "points",
    "telemetryHighlights",
    "strengths",
    "improvements",
  ],
};

interface EvaluateRequest {
  transcript?: string;
  slideText?: string;
  rubric?: ParsedRubric | null;
  telemetry?: SessionSummary | null;
}

/** Caps evidence windows in the prompt while keeping chronology. */
const MAX_PROMPT_EVENTS = 40;

function formatEvents(summary: SessionSummary): string {
  // Sitting mode: stance/leg events are not scorable, so they are not
  // offered as evidence either (P2).
  const relevant = summary.events.filter(
    (e) =>
      summary.postMode !== "sitting" ||
      (e.kind !== "swaying" && e.kind !== "stepping"),
  );
  if (relevant.length === 0) return "(no flagged telemetry events)";
  const events = relevant.slice(0, MAX_PROMPT_EVENTS);
  const lines = events.map((event) => {
    const start = (event.startMs - summary.startedAtMs) / 1000;
    const end = (event.endMs - summary.startedAtMs) / 1000;
    const span =
      end - start < 0.05
        ? `${start.toFixed(1)}s`
        : `${start.toFixed(1)}s–${end.toFixed(1)}s`;
    return `- [${event.kind}] ${span}`;
  });
  const omitted = relevant.length - events.length;
  if (omitted > 0) lines.push(`(+${omitted} more events omitted)`);
  return lines.join("\n");
}

function buildPrompt(): string {
  return `You are the final evaluator of an AI Presentation Coach. You receive:
(A) the speaker's transcript, (B) the slide text context, (C) a parsed custom rubric (qualitative directives + hard telemetry rules + semantic overrides), and (D) an aggregated telemetry session summary from MediaPipe + Web Audio (timings, event counts, timestamped evidence windows).

Produce a rigorous point-by-point SCORECARD as JSON matching the provided schema.

GRADING RULES
1. WEIGHTING — score holistically on FLOW, CLARITY and PACING rather than binary presence checks. Priorities, highest to lowest: (a) VERBAL FLOW — cadence (prefer ~130–160 WPM unless the rubric sets its own band), pause placement, vocal variety/pitch movement, fluid transitions, plain-language explanations, and filler control; (b) NON-VERBAL FLOW — open posture, natural hand gestures, purposeful movement, audience-facing presence; (c) structure & narrative; (d) content vs slides. Allocate the 100 points to reflect that order, e.g.: structure & narrative (20), content vs slides (25), delivery, pacing & vocal variety (30), posture, gestures & presence (25). Adjust weights to what the rubric emphasizes. categories[] must sum to maxPoints = 100 and awardedPoints must equal maxPoints − deductionTotal per category (overallScore = Σ awardedPoints, 0–100).
2. EYE CONTACT IS NOT CAMERA-LENS STARING — never deduct, fail, or flag a point because the speaker is not looking into the webcam. Brief natural glances at slides, notes, a second screen, props, or a thinking gaze away from the lens are NORMAL and must be score-neutral. Judge head orientation and presence instead: the speaker should be generally oriented toward their audience and re-engage after each glance. Reserve any gaze-related deduction for sustained disengagement (e.g. facing away for most of the talk), and then only lightly (a small, soft deduction).
3. points[] must cover: every directive from the rubric that the transcript lets you verify; every telemetry rule (comparing against the session summary values — e.g. estimatedWpm vs an ideal_range rule, violationSec vs at_most limits); pacing/pauses from the audio stats; and overall structure. status = "met" when satisfied (pointsDeducted 0), "deducted" when violated (pointsDeducted > 0), "na" when neither verifiable nor applicable. Count a point as "met" when the behavior was genuinely present — natural, imperfect execution still counts; only mark "deducted" when the evidence clearly contradicts the criterion.
4. EVIDENCE IS MANDATORY: every point's evidence[] must cite SPECIFIC telemetry numbers, event counts, or timestampSec values from the summary (e.g. "pause at 12.4s–15.9s; 3 events, 9.2s total") and/or quoted transcript lines. Never invent timestamps or counts that are not in the summary. When telemetry is null, say so and grade on transcript/rubric only (source "transcript"/"rubric").
5. SEMANTIC OVERRIDES — respect them strictly: for each semanticOverride, when the transcript contains the cue (its guidance phrase/topic — e.g. turning to a physical slide, table, or demo), the protected signals (gaze_off_camera / turned_away / …) around that moment are INTENTIONAL: do NOT deduct for them; if relevant, mention them as intentional and correct behavior. Only unprotected violations within/around the moment may be deducted. Use timestamped events + transcript reasoning to decide alignment; if alignment is genuinely ambiguous, lean toward no deduction for protected signals and note the ambiguity in feedback. Apply the same protection whenever the transcript shows the speaker checking notes, slides, props, or the room — those glances are correct behavior, never "distracted gaze".
6. Deduction honesty: apply rubric severity — "hard" rules deduct meaningfully (5–15 points), "soft" preferences lightly (1–5). Cap any single point's deduction at its maxPoints. Deliberate pauses, silence, and moments of thought are ASSETS — never deduct for a natural pause or brief hesitation. Overall tone: specific, constructive, actionable; recommendations must be concrete. Every feedback string MUST reference this run — quote the speaker's transcript lines or cite the telemetry numbers you used — no two points may share the same sentence, and never emit canned filler such as "this didn't come through" or "I looked for this and didn't find it".
7. telemetryHighlights: 4–8 entries summarizing the signals that matter for flow — pace/cadence, pitch variation, posture, open gestures & movement, and audience orientation — with an honest assessment. Frame gaze as "Audience orientation", not lens eye contact: glancing at slides or notes and returning to the audience is doing it right; mention only sustained facing-away as an issue.
8. POSTURE MODE — when the telemetry summary's postMode is "sitting", the presenter is seated: judge posture and alignment from the shoulders and torso only; never mention stance, feet, weight shifts or pacing across the floor; and mark any stance/leg-based telemetry rule (sway_seconds, sway_frequency_hz, steps) as "na" instead of deducting for it. When postMode is "standing" (or telemetry is absent), grade normally.

Return ONLY the JSON object.`;
}

export async function evaluateHandler(req: Request, res: Response) {
  // express.json() has already parsed (and size-capped) the body.
  const body = (req.body ?? {}) as EvaluateRequest;

  const transcript = (body.transcript ?? "").trim();
  const slideText = (body.slideText ?? body.rubric?.slideText ?? "").trim();
  const rubric = body.rubric ?? null;
  const telemetry = body.telemetry ?? null;

  if (!transcript) {
    return res.status(400).json({ error: "A speech transcript is required for evaluation." });
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return res.status(400).json(
      {
        error: `Transcript exceeds ${MAX_TRANSCRIPT_CHARS.toLocaleString()} characters.`,
      },
    );
  }
  if (slideText.length > MAX_SLIDE_CHARS) {
    return res.status(400).json({ error: `Slide text exceeds ${MAX_SLIDE_CHARS.toLocaleString()} characters.` });
  }
  if (!rubric || (!rubric.directives?.length && !rubric.telemetryRules?.length)) {
    return res.status(400).json({ error: "Parse a rubric first — directives or telemetry rules are required." });
  }

  console.info(
    `[agent:presentation-evaluate] step=received transcriptChars=${transcript.length} slideChars=${slideText.length} directives=${rubric.directives.length} telemetryRules=${rubric.telemetryRules.length} telemetry=${telemetry ? "ok" : "missing"}`,
  );

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    return res.status(500).json({ error: "Presentation evaluation is not configured (OPENROUTER_API_KEY missing)." });
  }

  // Assemble the four inputs for the model.
  const sections = [
    buildPrompt(),
    `SLIDE TEXT:\n${slideText ? trimForPrompt(slideText, MAX_SLIDE_CHARS) : "(none provided)"}`,
    `PARSED RUBRIC:\n${JSON.stringify(rubric)}`,
    `TRANSCRIPT:\n${trimForPrompt(transcript, MAX_TRANSCRIPT_CHARS)}`,
  ];
  if (telemetry) {
    const summaryWithoutEvents: SessionSummary = {
      ...telemetry,
      events: [],
    };
    sections.push(
      `TELEMETRY SESSION SUMMARY (seconds relative to session start):\n${JSON.stringify(summaryWithoutEvents)}\n\nTIMESTAMPED EVENTS:\n${formatEvents(telemetry)}`,
    );
  } else {
    sections.push(
      "TELEMETRY SESSION SUMMARY: (unavailable — no camera session was recorded; grade on transcript and rubric only and do not reference telemetry)",
    );
  }

  try {
    const prompt = sections.join("\n\n");
    console.info(
      `[agent:presentation-evaluate] step=calling-llm model=${getModel()} promptChars=${prompt.length}`,
    );
    const text = await generateWithRetry(() =>
      chatCompletion({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 8192,
        responseFormat: jsonSchemaFormat("presentation_scorecard", SCORECARD_SCHEMA),
      }),
    );
    const scorecard = JSON.parse(text) as Scorecard;
    console.info(
      `[agent:presentation-evaluate] step=scorecard-generated overallScore=${scorecard.overallScore} grade=${scorecard.grade}`,
    );
    return res.json(scorecard);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Evaluation failed.";
    console.error(`[agent:presentation-evaluate] step=failed error="${message.slice(0, 200)}"`);
    return res.status(502).json({ error: `AI evaluation failed: ${message}` });
  }
}


