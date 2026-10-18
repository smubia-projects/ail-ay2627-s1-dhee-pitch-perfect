/**
 * Manestage — Interview Coach domain model.
 *
 * Industry raffle-wheel list, the open-ended context box shape, the six
 * evaluation dimensions (Structured Thinking, STAR/CAR, Measurable Impact,
 * Clarity, Ownership, Role & Culture Fit) and the deterministic per-question
 * reviewer that produces real-time feedback — missing news events, context
 * box project callouts, and framework tweaks — plus dimension scores.
 *
 * Pure + deterministic (mock AI service): no React, no DOM.
 */

import type { GeneratedQuestion } from "@/lib/interview";

// ---------------------------------------------------------------------------
// Step 1 — Industry & context input
// ---------------------------------------------------------------------------

/** Raffle wheel segments (an "Other" option sits beside the wheel). */
export const INDUSTRIES = [
  "Technology / Software",
  "Finance & Banking",
  "Consulting",
  "Healthcare & Biotech",
  "Marketing & Media",
  "Education",
  "Design / UX",
  "Engineering (Hardware)",
  "Retail & E-commerce",
  "Government / Public Sector",
  "Sustainability & Energy",
  "Hospitality & Travel",
] as const;

/** Curated industry news hooks — used for "missing news event" callouts. */
export const INDUSTRY_NEWS_HOOKS: Record<string, string> = {
  "Technology / Software": "the shift toward AI-native products and platform consolidation",
  "Finance & Banking": "the rate-cycle reset and embedded-finance competition",
  Consulting: "AI-augmented delivery models reshaping junior consulting roles",
  "Healthcare & Biotech": "value-based care and GLP-1 driven market shifts",
  "Marketing & Media": "the collapse of third-party cookies and creator-led funnels",
  Education: "generative AI reshaping assessment and academic integrity",
  "Design / UX": "design systems converging with AI-assisted prototyping",
  "Engineering (Hardware)": "supply-chain re-routing and onshoring incentives",
  "Retail & E-commerce": "retail media networks and quick-commerce economics",
  "Government / Public Sector": "digital identity rollouts and open-data mandates",
  "Sustainability & Energy": "grid-scale storage economics and carbon reporting rules",
  "Hospitality & Travel": "dynamic pricing backlash and bleisure travel growth",
};

export type Commitment = "Internship" | "Part-time" | "Full-time" | "Contract" | "";

export interface InterviewContext {
  /** Wheel selection, or "Other" when typed manually. */
  industry: string;
  /** Free-text industry when industry === "Other". */
  industryCustom: string;
  /** Role / occupation title. */
  role: string;
  /** How the job was found (referral, posting, career fair…). */
  howFound: string;
  commitment: Commitment;
  /** Desire rating 1–5. */
  desireRating: number;
  /** Particulars about relevant personal projects & past work experiences. */
  contextNotes: string;
}

export const DEFAULT_INTERVIEW_CONTEXT: InterviewContext = {
  industry: INDUSTRIES[0],
  industryCustom: "",
  role: "",
  howFound: "",
  commitment: "Internship",
  desireRating: 4,
  contextNotes: "",
};

/** Resolved industry label (handles the "Other" free text). */
export function industryLabel(context: InterviewContext): string {
  if (context.industry === "Other") {
    return context.industryCustom.trim() || "Other industry";
  }
  return context.industry;
}

// ---------------------------------------------------------------------------
// Step 3 — Six evaluation dimensions
// ---------------------------------------------------------------------------

export const DIMENSIONS = [
  { id: "structured", label: "Structured Thinking & Problem-Solving" },
  { id: "framework", label: "STAR and CAR framework" },
  { id: "impact", label: "Measurable Impact & Results" },
  { id: "clarity", label: "Communication Clarity & Delivery" },
  { id: "ownership", label: "Ownership & Self-Awareness" },
  { id: "culture", label: "Role & Cultural Competency Match" },
] as const;

export type DimensionId = (typeof DIMENSIONS)[number]["id"];

export interface DimensionScore {
  id: DimensionId;
  label: string;
  /** 0–100, or null when no scored answer covered this dimension (#13). */
  score: number | null;
  /** One-line evidence for the score. */
  note: string;
}

export interface QuestionReview {
  questionId: string;
  /** Equal-weighted average of the six dimensions (0–100). */
  score: number;
  dimensions: DimensionScore[];
  /** Specific callouts: missing news events, context callouts, STAR tweaks. */
  feedback: string[];
  /** Set when there was no answer to score — shows "No answer detected". */
  insufficient?: string | null;
}

// ---------------------------------------------------------------------------
// Deterministic reviewer
// ---------------------------------------------------------------------------

/** Stopword table used to find distinctive content words. */
const STOPWORDS: Record<string, true> = (
  "the a an and or but if then for of to in on at with about from into over after before " +
  "was were is are be been being do does did have has had i we you they he she it my our your " +
  "their this that these those not no yes so as by up down out off can could would should will " +
  "they're we're i'm it's what when where which who whom how why all any both each few " +
  "more most other some such only own same than too very just actually basically really like " +
  "know going got get make made"
)
  .split(" ")
  .reduce<Record<string, true>>((acc, w) => {
    if (w) acc[w] = true;
    return acc;
  }, {});

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z']+/g) ?? [];
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/** Distinctive content words from the context box (projects & experience). */
function contextKeywords(context: InterviewContext): string[] {
  const source = `${context.contextNotes} ${context.role} ${industryLabel(context)}`;
  return [
    ...new Set(
      wordsOf(source).filter((w) => w.length > 5 && !STOPWORDS[w]),
    ),
  ].slice(0, 24);
}

export interface EvaluateAnswerInput {
  question: GeneratedQuestion;
  transcript: string;
  context: InterviewContext;
  /** Optional delivery telemetry from the recorded answer. */
  telemetry?: { avgWpm?: number | null; initiationDelaySec?: number | null };
}

/** Minimum spoken words for a scorable interview answer (#13). */
export const MIN_ANSWER_WORDS = 30;

/**
 * Scores one answer across the six Manestage dimensions and produces the
 * specific feedback bullets shown live under the question. Answers under
 * MIN_ANSWER_WORDS (or with no captured transcript) are reported as
 * "No answer detected" — no scores are invented.
 */
export function evaluateAnswer(input: EvaluateAnswerInput): QuestionReview {
  const text = input.transcript.trim();
  const spoken = text ? text.split(/\s+/).length : 0;
  if (spoken < MIN_ANSWER_WORDS) {
    return {
      questionId: input.question.id,
      score: 0,
      dimensions: [],
      feedback: [],
      insufficient: `No answer detected: ${spoken} word${spoken === 1 ? "" : "s"} captured — at least ${MIN_ANSWER_WORDS} are needed to score an answer.`,
    };
  }
  const context = input.context;
  const lower = text.toLowerCase();
  const words = wordsOf(text);
  const feedback: string[] = [];
  const dimensions: DimensionScore[] = [];

  // 1 · Structured thinking — sequencing + segmented beats -------------------
  const structureMarkers = countMatches(
    lower,
    /\b(first|second|third|then|next|finally|initially|after that|because|so that|as a result|in the end|to start)\b/g,
  );
  const beats = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const structured = clamp(
    text.length < 60
      ? 25
      : 42 + Math.min(structureMarkers, 5) * 9 + Math.min(beats, 8) * 3,
  );
  dimensions.push({
    id: "structured",
    label: DIMENSIONS[0].label,
    score: structured,
    note: `${structureMarkers} sequencing signals across ${beats} sentence beats.`,
  });
  if (structured < 60 && text.length >= 60) {
    feedback.push(
      "Structure tip: signpost the path. Say: there are three parts, situation, what I did, what happened.",
    );
  }

  // 2 · STAR / CAR framework alignment --------------------------------------
  const hasSituation = /\b(when|during|at the time|the context|situation|i was working|we were)\b/.test(lower);
  const hasTask = /\b(my (job|task|goal|responsibility|objective)|needed to|had to|responsible for|the ask)\b/.test(lower);
  const actionCount = countMatches(
    lower,
    /\b(i (led|built|designed|ran|created|fixed|launched|decided|negotiated|wrote|migrated|analyzed|organized|proposed|automated|reduced|introduced|coordinated|owned|tested|interviewed|pitched|shipped))\b/g,
  );
  const hasResult = /\b(the (result|outcome|impact)|ended up|we (grew|reduced|increased|saved|cut)|i (learned|realized))\b|\d+\s*%|\$\d/.test(lower);
  const starPresent = [hasSituation, hasTask, actionCount > 0, hasResult].filter(
    Boolean,
  ).length;
  const framework = clamp(18 + starPresent * 20.5);
  dimensions.push({
    id: "framework",
    label: DIMENSIONS[1].label,
    score: framework,
    note: `${starPresent}/4 STAR elements present (action verbs: ${actionCount}).`,
  });
  const missingStar: string[] = [];
  if (!hasSituation) missingStar.push("Situation");
  if (!hasTask) missingStar.push("Task");
  if (actionCount === 0) missingStar.push("Action (first-person verbs)");
  if (!hasResult) missingStar.push("Result");
  if (missingStar.length > 0 && text.length >= 40) {
    feedback.push(
      `STAR tip: work on ${missingStar.join(", ")}. One sentence each keeps the story easy to follow.`,
    );
  }

  // 3 · Measurable impact ----------------------------------------------------
  const metricCount = countMatches(text, /\d+(\.\d+)?\s*(%|x|k|m|bn|hours?|days?|weeks?|users?|customers?|revenue|\$)/gi)
    + countMatches(text, /\$\s?\d/g);
  const hasPercent = /\d+\s*%/.test(text);
  const impact = clamp(30 + Math.min(metricCount, 4) * 15 + (hasPercent ? 15 : 0));
  dimensions.push({
    id: "impact",
    label: DIMENSIONS[2].label,
    score: impact,
    note:
      metricCount > 0
        ? `${metricCount} metric citation${metricCount > 1 ? "s" : ""}${hasPercent ? " incl. a percentage" : ""}.`
        : "No quantified outcome detected.",
  });
  if (impact < 60) {
    feedback.push(
      "You left out the numbers. Land the result with one figure from your own work — a measured outcome beats made it faster.",
    );
  }

  // 4 · Communication clarity & delivery -------------------------------------
  const fillerCount = countMatches(
    lower,
    /\b(um|uh|er|ah|like|you know|i mean|basically|actually|kind of|sort of)\b/g,
  );
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const avgSentenceLen = words.length / sentences;
  const wpm = input.telemetry?.avgWpm ?? null;
  const wpmBonus = wpm !== null && wpm >= 110 && wpm <= 170 ? 6 : 0;
  const clarity = clamp(
    (text.length < 60 ? 35 : 88) - fillerCount * 7 -
      (avgSentenceLen > 34 ? 14 : 0) -
      (avgSentenceLen < 7 && sentences > 2 ? 8 : 0) +
      wpmBonus,
    25,
    98,
  );
  dimensions.push({
    id: "clarity",
    label: DIMENSIONS[3].label,
    score: clarity,
    note:
      `${fillerCount} filler${fillerCount === 1 ? "" : "s"} · avg ${avgSentenceLen.toFixed(0)} words/sentence` +
      (wpm !== null ? ` · ${Math.round(wpm)} wpm` : ""),
  });
  if (fillerCount >= 3) {
    feedback.push(
      `${fillerCount} filler words. Trade um, like, and you know for a two-second pause instead.`,
    );
  }

  // 5 · Ownership & self-awareness (I vs We) ----------------------------------
  const iCount = words.filter((w) => w === "i").length;
  const weCount = words.filter((w) => w === "we").length;
  const iRatio = iCount + weCount > 0 ? iCount / (iCount + weCount) : 0;
  const selfAware = /\b(i (learned|realized|was wrong|misjudged)|my (mistake|fault)|next time|in hindsight)\b/.test(lower);
  const ownership = clamp(
    iCount === 0 ? 35 : 45 + iRatio * 50 + (selfAware ? 8 : 0),
  );
  dimensions.push({
    id: "ownership",
    label: DIMENSIONS[4].label,
    score: ownership,
    note: `“I”:${iCount} vs “we”:${weCount} (${Math.round(iRatio * 100)}% first-person)${selfAware ? " · reflection present" : ""}.`,
  });
  if (iCount > 0 && weCount > iCount) {
    feedback.push(
      `Ownership tip: we (${weCount}) outruns I (${iCount}). Claim your own decisions before crediting the team.`,
    );
  } else if (iCount === 0 && text.length >= 60) {
    feedback.push(
      "Ownership tip: no first person yet. Start the action with I led, I built, or I decided.",
    );
  }

  // 6 · Role & cultural competency match -------------------------------------
  const keys = contextKeywords(context);
  const keyHits = keys.filter((k) => lower.includes(k)).length;
  const industry = industryLabel(context);
  const hook = INDUSTRY_NEWS_HOOKS[industry] ?? "";
  const hookWords = hook ? wordsOf(hook).filter((w) => w.length > 4 && !STOPWORDS[w]) : [];
  const hookHits = hookWords.filter((w) => lower.includes(w)).length;
  const probesCompany =
    /\b(company|industry|market|trend|news|future|strategy|why (us|this company|here))\b/.test(lower) ||
    /company|industry|strategic/i.test(input.question.competency);
  const culture = clamp(
    52 +
      Math.min(keyHits, 4) * 8 +
      (hookHits > 0 ? 14 : 0) +
      (context.role && lower.includes(wordsOf(context.role).filter((w) => w.length > 3)[0] ?? "___") ? 6 : 0),
  );
  dimensions.push({
    id: "culture",
    label: DIMENSIONS[5].label,
    score: culture,
    note: hookHits > 0
      ? `Industry hook referenced (${keyHits} context keywords matched).`
      : `${keyHits} context keywords matched; no industry-news hook yet.`,
  });
  if (hook && hookHits === 0 && (probesCompany || culture < 62)) {
    feedback.push(
      `Missing news hook: this ${industry} answer should nod to ${hook}. It shows you're tuned in.`,
    );
  }

  // Context-box project callout ---------------------------------------------
  const distinctive = keys.filter((k) => k.length > 6).slice(0, 6);
  const calloutMissed = distinctive.filter((k) => !lower.includes(k));
  if (input.context.contextNotes.trim().length > 30 && calloutMissed.length >= 2) {
    const snippet = input.context.contextNotes.trim().slice(0, 72);
    feedback.push(
      `From your context box: you mentioned “${snippet}${input.context.contextNotes.length > 72 ? "…" : ""}”. Weave that project into this answer.`,
    );
  }
  if (feedback.length === 0) {
    feedback.push(
      "Clean pass. Keep this shape and tighten the final sentence into a crisp takeaway.",
    );
  }

  const score = Math.round(
    dimensions.reduce((sum, d) => sum + (d.score ?? 0), 0) / dimensions.length,
  );
  return { questionId: input.question.id, score, dimensions, feedback };
}

/**
 * Average the scored per-question reviews into the end-of-interview report.
 * #13/#14: insufficient-data answers are excluded everywhere; when nothing
 * was scored the overall is null (never a made-up number).
 */
export function aggregateReviews(reviews: QuestionReview[]): {
  overall: number | null;
  dimensions: DimensionScore[];
  scoredCount: number;
  insufficientCount: number;
} {
  const scored = reviews.filter((r) => !r.insufficient);
  const insufficientCount = reviews.length - scored.length;
  if (scored.length === 0) {
    return {
      overall: null,
      dimensions: DIMENSIONS.map((d) => ({
        id: d.id,
        label: d.label,
        score: null,
        note: "No answer detected.",
      })),
      scoredCount: 0,
      insufficientCount,
    };
  }
  const dimensions = DIMENSIONS.map((d) => {
    const rows = scored
      .map((r) => r.dimensions.find((x) => x.id === d.id))
      .filter((x): x is DimensionScore => Boolean(x));
    if (rows.length === 0) {
      return {
        id: d.id,
        label: d.label,
        score: null,
        note: "Not covered by the scored answers.",
      } satisfies DimensionScore;
    }
    const score = Math.round(
      rows.reduce((sum, r) => sum + (r.score ?? 0), 0) / rows.length,
    );
    return {
      id: d.id,
      label: d.label,
      score,
      note: `Average across ${rows.length} answer${rows.length === 1 ? "" : "s"}.`,
    } satisfies DimensionScore;
  });
  return {
    overall: Math.round(
      scored.reduce((sum, r) => sum + r.score, 0) / scored.length,
    ),
    dimensions,
    scoredCount: scored.length,
    insufficientCount,
  };
}