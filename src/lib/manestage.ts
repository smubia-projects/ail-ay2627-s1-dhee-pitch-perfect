/**
 * ManeStage — Presentation Coach domain model.
 *
 * Purpose selection (incl. the custom questionnaire), curated rubric
 * presets with weightage, deck & hardware calibration state, and the
 * contextual feedback builder that internalizes the presentation's purpose
 * and call-to-action when reviewing a run.
 *
 * Pure types + deterministic helpers — no React, no DOM.
 */

import type { ParsedRubric, Scorecard } from "@/lib/presentation";
import type { DualRubricReport } from "@/lib/dual-rubric";

// ---------------------------------------------------------------------------
// Step 1 — Purpose selection
// ---------------------------------------------------------------------------

export type PurposeId = "case-study" | "startup-pitch" | "academic" | "custom";

/** Primary goal of a custom ("Other") presentation. */
export type CoreObjective = "Funding" | "Educate" | "Sell" | "Status update";

export type KnowledgeLevel = "Novice" | "Intermediate" | "Expert";

export type DeliveryMedium =
  | "Virtual"
  | "In-person stage"
  | "Interactive round-table"
  | "Read-only deck";

export interface AudienceProfile {
  /** Type of audience, e.g. "Executives", "Peers", "Public". */
  type: string;
  knowledgeLevel: KnowledgeLevel;
  /** Skepticism & biases — doubts / friction points the audience carries. */
  skepticism: string;
}

export interface FormatLogistics {
  /** Strict time limit in minutes. */
  timeLimitMin: number;
  /** Q&A window timing, e.g. "Final 5 minutes". */
  qaWindow: string;
  medium: DeliveryMedium;
}

export interface PersonaStyle {
  /** Exactly 3 tone adjectives. */
  toneAdjectives: [string, string, string];
  /** Presenter persona relative to the audience. */
  presenterPersona: string;
}

/** The "Other (Custom Questionnaire)" payload. */
export interface CustomQuestionnaire {
  /** Free-text objective of the presentation (item 1 of the quick list). */
  objectiveText: string;
  coreObjective: CoreObjective;
  keyTakeaway: string;
  callToAction: string;
  audience: AudienceProfile;
  format: FormatLogistics;
  persona: PersonaStyle;
}

export interface PurposeOption {
  id: PurposeId;
  label: string;
  description: string;
}

export interface PurposeSelection {
  id: PurposeId;
  /** Only set when id === "custom". */
  custom: CustomQuestionnaire | null;
}

export const PURPOSE_OPTIONS: PurposeOption[] = [
  {
    id: "case-study",
    label: "Case study & project briefings",
    description:
      "Walk stakeholders through a project: context, approach, results, and what you'd do next.",
  },
  {
    id: "startup-pitch",
    label: "Startup and business model pitches",
    description: "Hackathons, pitch decks, and comps.",
  },
  {
    id: "academic",
    label: "Academic presentations",
    description: "Literature reviews",
  },
  {
    id: "custom",
    label: "Something else. Answer a few quick questions",
    description: "Tell Mane about the objective, key takeaways, and audience.",
  },
];

export const DEFAULT_CUSTOM_QUESTIONNAIRE: CustomQuestionnaire = {
  objectiveText: "",
  coreObjective: "Educate",
  keyTakeaway: "",
  callToAction: "",
  audience: { type: "", knowledgeLevel: "Intermediate", skepticism: "" },
  format: {
    timeLimitMin: 10,
    qaWindow: "Final 5 minutes",
    medium: "Virtual",
  },
  persona: {
    toneAdjectives: ["Warm", "Crisp", "Confident"],
    presenterPersona: "",
  },
};

// ---------------------------------------------------------------------------
// Step 2 — Rubric customization (curated criteria + weightage)
// ---------------------------------------------------------------------------

export type RubricGroup = "content" | "delivery" | "structure" | "audience";

export interface RubricCriterion {
  id: string;
  label: string;
  description: string;
  /** Emphasis 0–100 (slider). Weights are normalized for display. */
  weight: number;
  group: RubricGroup | "custom";
  /** True for user-added criteria (e.g. a professor's custom rubric). */
  custom?: boolean;
}

function criterion(
  id: string,
  label: string,
  description: string,
  weight: number,
  group: RubricGroup,
): RubricCriterion {
  return { id, label, description, weight, group };
}

/** Curated system rubrics per presentation purpose. */
export const RUBRIC_PRESETS: Record<PurposeId, RubricCriterion[]> = {
  "case-study": [
    criterion("cs-problem", "Problem framing", "Establishes the client/problem context in under 60 seconds", 15, "content"),
    criterion("cs-method", "Method & evidence", "Approach, data sources, and assumptions are explicit", 20, "content"),
    criterion("cs-insight", "Insight clarity", "Findings are stated as insights, not raw observations", 20, "content"),
    criterion("cs-structure", "Structure & signposting", "Agenda up front, clear transitions, recap at the end", 15, "structure"),
    criterion("cs-rec", "Recommendation & next steps", "Ends with a decision or concrete next actions", 20, "audience"),
    criterion("cs-presence", "Delivery & presence", "Pace, posture, and eye contact with the stakeholders", 10, "delivery"),
  ],
  "startup-pitch": [
    criterion("sp-hook", "Narrative hook & problem", "Opens with a compelling customer problem or story", 15, "content"),
    criterion("sp-solution", "Solution & demo clarity", "What it is, how it works, and why now, in plain language", 15, "content"),
    criterion("sp-traction", "Market & traction numbers", "TAM/SAM, growth, and engagement quantified", 20, "content"),
    criterion("sp-model", "Business model & unit economics", "How the money works: pricing, margins, CAC and LTV", 15, "content"),
    criterion("sp-ask", "The ask & call to action", "The raise/partnership ask and what happens next", 20, "audience"),
    criterion("sp-presence", "Stage presence & pacing", "Confident delivery, strategic pauses, judge eye contact", 15, "delivery"),
  ],
  academic: [
    criterion("ac-question", "Research question & motivation", "States the gap and why it matters up front", 15, "content"),
    criterion("ac-method", "Methodology transparency", "Design, sample, and analysis choices are explained", 20, "content"),
    criterion("ac-results", "Results & interpretation", "Figures walked through axis-by-axis; effect sizes named", 25, "content"),
    criterion("ac-lit", "Literature positioning", "Relates findings to prior work honestly", 15, "content"),
    criterion("ac-beamer", "Slide (Beamer) clarity", "Readable slides with titles as claims, no wall of text", 10, "structure"),
    criterion("ac-qa", "Q&A readiness & pacing", "Calm pace with space for questions; caveats acknowledged", 15, "delivery"),
  ],
  custom: [
    criterion("cu-message", "Core message clarity", "The single takeaway lands even if they forget everything else", 20, "content"),
    criterion("cu-structure", "Structure & flow", "Opening, signposts, and a clean landing", 20, "structure"),
    criterion("cu-evidence", "Evidence & examples", "Claims backed by data, demos, or stories", 15, "content"),
    criterion("cu-audience", "Audience fit", "Pitched to the room's knowledge level; doubts addressed", 15, "audience"),
    criterion("cu-delivery", "Delivery & presence", "Pace, posture, eye contact, filler words", 15, "delivery"),
    criterion("cu-cta", "Closing & call to action", "Ends with the action you want the audience to take", 15, "audience"),
  ],
};

/** Default telemetry delivery rules attached to every generated rubric. */
const DEFAULT_TELEMETRY_RULES: ParsedRubric["telemetryRules"] = [
  {
    metric: "wpm",
    comparator: "ideal_range",
    value: 130,
    valueMax: 160,
    unit: "wpm",
    severity: "soft",
    description: "Speak at a comfortable, conversational pace",
  },
  {
    metric: "posture_lean_deg",
    comparator: "at_most",
    value: 10,
    valueMax: null,
    unit: "deg",
    severity: "soft",
    description: "Stand tall with relaxed, open body language",
  },
  {
    metric: "gaze_deviation_deg",
    comparator: "at_most",
    value: 15,
    valueMax: null,
    unit: "deg",
    severity: "soft",
    description: "Stay oriented toward your audience (glances at slides are fine)",
  },
];

// ---------------------------------------------------------------------------
// Step 3 — Deck & hardware calibration
// ---------------------------------------------------------------------------

export interface DeckCalibration {
  /** Uploaded deck file name (PDF/PPTX), if any. */
  deckFileName: string | null;
  /** Extracted slide text (or pasted outline). */
  slideText: string;
  /** Uploaded / pasted presentation script or outline. */
  scriptText: string;
  /**
   * Hardware switch — "Are you going to be using the device you are
   * currently practicing on to access the slides and click?" When true,
   * MediaPipe tracking ignores keyboard/clicker interactions so they are
   * not scored as negative posture/fidgeting.
   */
  usingDeviceForSlides: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalized emphasis per criterion (shares of 100 that always sum to 100). */
export function normalizeWeights(
  criteria: RubricCriterion[],
): Array<RubricCriterion & { share: number }> {
  const active = criteria.filter((c) => c.weight > 0);
  const total = active.reduce((sum, c) => sum + c.weight, 0);
  if (total === 0) {
    return criteria.map((c) => ({ ...c, share: 0 }));
  }
  return criteria.map((c) => ({
    ...c,
    share: c.weight > 0 ? Math.round((c.weight / total) * 100) : 0,
  }));
}

/** One-line human summary of the chosen purpose (used in prompts/feedback).
 * #10: only mentions fields the user actually entered. */
export function describePurpose(selection: PurposeSelection): string {
  const option = PURPOSE_OPTIONS.find((o) => o.id === selection.id);
  if (selection.id !== "custom" || !selection.custom) {
    return option?.label ?? "Presentation practice";
  }
  const c = selection.custom;
  const parts = [
    c.objectiveText.trim() ? `objective: “${c.objectiveText.trim()}”` : null,
    c.keyTakeaway.trim() ? `takeaway: “${c.keyTakeaway.trim()}”` : null,
    c.callToAction.trim() ? `CTA: “${c.callToAction.trim()}”` : null,
    c.audience.type.trim()
      ? `audience: ${c.audience.type.trim()} (${c.audience.knowledgeLevel})`
      : null,
    c.audience.skepticism.trim()
      ? `doubts: ${c.audience.skepticism.trim()}`
      : null,
  ].filter(Boolean);
  return parts.length > 0
    ? `${option?.label ?? "Custom presentation"}: ${parts.join(". ")}`
    : `${option?.label ?? "Custom presentation"}: no goal provided`;
}

/**
 * Builds the ParsedRubric the evaluators consume from the weighted criteria.
 * Zero-weight criteria are dropped; directives keep weight order so the
 * model sees the heaviest emphasis first.
 */
export function buildRubricFromCriteria(
  selection: PurposeSelection,
  criteria: RubricCriterion[],
): ParsedRubric {
  const active = criteria
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const label =
    PURPOSE_OPTIONS.find((o) => o.id === selection.id)?.label ??
    "Presentation practice";
  return {
    engine: "local",
    title: `${label} rubric`,
    slideText: "",
    directives: active.map((c) => ({
      category: c.group === "custom" ? "custom" : c.group,
      instruction: `[${c.weight} emphasis] ${c.label}: ${c.description}`,
      slideRef: "n/a",
    })) as ParsedRubric["directives"],
    telemetryRules: DEFAULT_TELEMETRY_RULES,
    semanticOverrides: [],
    summary: `Weighted rubric for ${describePurpose(selection)}.`,
  };
}

// ---------------------------------------------------------------------------
// Step 5 — Contextual AI feedback (internalizes purpose + CTA)
// ---------------------------------------------------------------------------

export interface ContextualFeedback {
  headline: string;
  /** Purpose-aware bullets mixing rubric weights with the run's evidence. */
  bullets: string[];
  /** The single most important thing to fix next run. */
  focusNext: string;
}

/**
 * Deterministic, purpose-aware review of a finished run. Used directly when
 * the Gemini route is unavailable and to enrich the model scorecard
 * otherwise. #10: it only ever mentions goals, takeaways, calls-to-action
 * and weights the USER actually entered — anything empty shows as
 * "No goal provided" and generates nothing.
 */
export function buildContextualFeedback(input: {
  purpose: PurposeSelection;
  criteria: RubricCriterion[];
  /** True only when the user edited the rubric weights themselves. */
  weightsKnown: boolean;
  overall: number;
  verbal: number | null;
  nonVerbal: number | null;
  report: DualRubricReport | null;
  scorecard: Scorecard | null;
}): ContextualFeedback {
  const { purpose, criteria, weightsKnown, overall, verbal, nonVerbal, report, scorecard } =
    input;
  const bullets: string[] = [];

  // 1. Purpose framing — only what the user entered (#10).
  if (purpose.id === "custom" && purpose.custom) {
    const c = purpose.custom;
    const objective = c.objectiveText.trim();
    const takeaway = c.keyTakeaway.trim();
    const ask = c.callToAction.trim();
    if (!objective && !takeaway && !ask) {
      bullets.push("No goal provided.");
    } else {
      if (objective) {
        bullets.push(
          `Your objective was “${objective}” — every section should point back to it.`,
        );
      } else {
        bullets.push("No goal provided.");
      }
      if (takeaway) {
        bullets.push(`Keep pressing your key takeaway home: “${takeaway}”.`);
      }
      if (ask) {
        bullets.push(`Spend the last 30 seconds on your ask: “${ask}”.`);
      }
    }
    if (c.audience.skepticism.trim()) {
      bullets.push(
        `A doubt to handle early: ${c.audience.skepticism.trim()}. Answer it before the Q&A, not during.`,
      );
    }
  } else {
    const label =
      PURPOSE_OPTIONS.find((o) => o.id === purpose.id)?.label ??
      "This purpose";
    bullets.push(`${label} was the theme of this run.`);
  }

  // 2. Verbal vs non-verbal cue split.
  if (verbal !== null && nonVerbal !== null) {
    const gap = verbal - nonVerbal;
    if (Math.abs(gap) >= 12) {
      bullets.push(
        gap > 0
          ? `Your words are doing more work than your body (${verbal} vs ${nonVerbal}). Open your shoulders and plant your feet between sections.`
          : `Your presence outpaced your script (${nonVerbal} vs ${verbal}). Add one number or example per claim.`,
      );
    } else {
      bullets.push(
        `Your words and body matched: verbal ${verbal}, body ${nonVerbal}. Keep that pairing.`,
      );
    }
  }

  // 3. Timeline moments (peaks / dips).
  const segments = report?.timeline ?? [];
  const dip = segments.find((s) => s.status === "dip");
  const peak = segments.find((s) => s.status === "peak");
  if (dip) {
    bullets.push(
      `Lowest point at ${dip.timestamp}. ${dip.analysis} That moment is what people remember.`,
    );
  }
  if (peak) {
    bullets.push(
      `Best moment at ${peak.timestamp}. ${peak.analysis} Bottle that rhythm and reuse it at the open and close.`,
    );
  }

  // 4. Rubric emphasis — only ever based on weights the user set (#10).
  const missed = weightsKnown
    ? [...criteria]
        .filter((c) => c.weight >= 15)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 2)
    : [];
  if (scorecard?.summary && bullets.length < 5) {
    bullets.push(scorecard.summary);
  } else if (missed.length > 0 && overall < 85) {
    bullets.push(
      `These counted the most and deserve another pass: ${missed.map((c) => c.label.toLowerCase()).join(" and ")}.`,
    );
  }

  const gradeWord =
    overall >= 85 ? "stage ready" : overall >= 70 ? "solid" : "warming up";
  const focus = dip?.title ?? missed[0]?.label ?? "Tighten the opening and close";

  return {
    headline: `Mane's take: a ${gradeWord} ${overall}/100 run for this purpose.`,
    bullets,
    focusNext: `Next run, fix this first: ${focus}.`,
  };
}