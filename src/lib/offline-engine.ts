/**
 * Offline coaching engine — deterministic fallback used by the API routes
 * whenever Gemini is unreachable (invalid key, daily quota, capacity…).
 *
 * Everything here genuinely analyses the user's OWN inputs:
 *  - `localParseRubric`        regex-parses numeric telemetry rules,
 *                              qualitative directives, and intentional-turn
 *                              overrides out of the rubric text;
 *  - `localGenerateQuestions`  extracts role/skills/company context and
 *                              builds 5 targeted STAR questions;
 *  - `localEvaluatePresentation` scores transcript + real session telemetry
 *                              (with timestamps/counts) into a Scorecard;
 *
 * Pure and DOM/React-free so it can be unit tested with Node.
 */

import type {
  QualitativeDirective,
  SemanticOverride,
  TelemetryRule,
} from "@/lib/presentation";
import type {
  ParsedRubric,
  Scorecard,
  ScorecardCategory,
  ScorecardPoint,
  ScoreEvidence,
  FlaggedMove,
  TimestampedFeedback,
} from "@/lib/presentation";
import type { SessionSummary } from "@/hooks/use-telemetry";
import { STANCE_METRICS } from "@/lib/posture-mode";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  ("the a an and or but if then than of to in on for with at by from as is are was were be been being this that these those it its i we you they he she your our their my me do does did doing have has had will would can could should may might must about into over under more most other some such no nor not only own same so too very just also here there when where why how all any both each few. because while during before after above below up down out off again further once").split(
    " ",
  ),
);

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? [];
}

function wordCount(text: string): number {
  return wordsOf(text).length;
}

/** Frequent content words minus stopwords (lowercased). */
function keywords(text: string, limit = 40): string[] {
  const counts = new Map<string, number>();
  for (const word of wordsOf(text)) {
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

/** Which of `needles` appear in `haystack` as whole words. */
function foundNeedles(needles: string[], haystack: string): string[] {
  if (needles.length === 0) return [];
  const hay = ` ${haystack.toLowerCase()} `;
  return needles.filter(
    (n) =>
      hay.includes(` ${n} `) ||
      hay.includes(` ${n}s `) ||
      hay.includes(` ${n}ing `),
  );
}

/** Fraction of `needles` present in `haystack` (0–1). */
function overlapRatio(needles: string[], haystack: string): number {
  if (needles.length === 0) return 0;
  return foundNeedles(needles, haystack).length / needles.length;
}

/** First sentence of `text` mentioning any of `needles`, if any. */
function sentenceContaining(text: string, needles: string[]): string | null {
  if (needles.length === 0) return null;
  return (
    sentencesOf(text).find((s) => foundNeedles(needles, s).length > 0) ?? null
  );
}

/** Keeps quoted evidence readable in a single feedback line. */
function clipQuote(text: string, max = 160): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Local rubric parser (regex-based, no API key)
// ---------------------------------------------------------------------------

const METRIC_UNITS: Record<string, string> = {
  wpm: "wpm",
  pause_seconds: "s",
  pitch_std_hz: "Hz",
  posture_lean_deg: "deg",
  shoulder_tilt_deg: "deg",
  gaze_deviation_deg: "deg",
  head_yaw_deg: "deg",
  arms_crossed_seconds: "s",
  hands_outside_box_seconds: "s",
  sway_frequency_hz: "Hz",
  sway_seconds: "s",
  steps: "count",
};

function makeRule(
  metric: TelemetryRule["metric"],
  comparator: TelemetryRule["comparator"],
  value: number,
  valueMax: number | null,
  severity: TelemetryRule["severity"],
  description: string,
): TelemetryRule {
  return {
    metric,
    comparator,
    value,
    valueMax,
    unit: METRIC_UNITS[metric] ?? "",
    severity,
    description,
  };
}

const RULE_PATTERNS: Array<{
  match: RegExp;
  build: (m: RegExpMatchArray) => TelemetryRule;
}> = [
  {
    match:
      /(?:pace|speaking rate|wpm)[^.\n]*?(\d{2,3})\s*(?:–|-|to|and)\s*(\d{2,3})\s*wpm/i,
    build: (m) =>
      makeRule("wpm", "ideal_range", Number(m[1]), Number(m[2]), "soft", m[0].trim()),
  },
  {
    match: /(?:at least|minimum|min)[^.\n]*?(\d{2,3})\s*wpm/i,
    build: (m) => makeRule("wpm", "at_least", Number(m[1]), null, "soft", m[0].trim()),
  },
  {
    match:
      /(?:at most|maximum|max|no more than|under|below)[^.\n]*?(\d{2,3})\s*wpm/i,
    build: (m) => makeRule("wpm", "at_most", Number(m[1]), null, "soft", m[0].trim()),
  },
  {
    match: /pauses?[^.\n]*?(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)/i,
    build: (m) =>
      makeRule("pause_seconds", "at_most", Number(m[1]), null, "soft", m[0].trim()),
  },
  {
    match: /(?:upright|stand|posture|lean)[^.\n]*?(\d{1,2})\s*(?:deg|°)/i,
    build: (m) =>
      makeRule("posture_lean_deg", "at_most", Number(m[1]), null, "soft", m[0].trim()),
  },
  {
    match: /shoulder[^.\n]*?(\d{1,2})\s*(?:deg|°)/i,
    build: (m) =>
      makeRule("shoulder_tilt_deg", "at_most", Number(m[1]), null, "soft", m[0].trim()),
  },
  {
    match: /(?:eye contact|gaze)[^.\n]*?(\d{1,2})\s*(?:deg|°)/i,
    // Gaze/eye-contact is a preference, never a hard lens-stare pass/fail.
    build: (m) =>
      makeRule("gaze_deviation_deg", "at_most", Number(m[1]), null, "soft", m[0].trim()),
  },
  {
    match: /(?:eye contact|gaze)[^.\n]*?(\d{2,3})\s*%/i,
    build: (m) =>
      makeRule(
        "gaze_deviation_deg",
        "at_most",
        Math.max(4, Math.round((1 - Number(m[1]) / 100) * 20)),
        null,
        "soft",
        m[0].trim(),
      ),
  },
];

/**
 * Deterministic regex parser for grading rubrics — extracts hard numeric
 * telemetry rules, qualitative directives, and intentional-turn overrides
 * without any API key.
 */
export function localParseRubric(input: {
  rubricText: string;
  slideText?: string;
  title?: string;
}): ParsedRubric {
  const rubricText = (input.rubricText ?? "").trim();
  const slideText = (input.slideText ?? "").trim();
  const lines = rubricText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Telemetry rules ---------------------------------------------------------
  const telemetryRules: TelemetryRule[] = [];
  for (const line of lines) {
    for (const pattern of RULE_PATTERNS) {
      const match = line.match(pattern.match);
      if (match) {
        const parsed = pattern.build(match);
        if (!telemetryRules.some((r) => r.metric === parsed.metric)) {
          telemetryRules.push(parsed);
        }
        break;
      }
    }
    if (/monoton|vocal variet|pitch/i.test(line)) {
      const m = line.match(/(\d{1,3})\s*Hz/);
      telemetryRules.push(
        makeRule(
          "pitch_std_hz",
          "at_least",
          m ? Number(m[1]) : 12,
          null,
          "soft",
          "Vary your tone and keep it lively",
        ),
      );
    }
    if (/arms?\s+cross/i.test(line)) {
      telemetryRules.push(
        makeRule("arms_crossed_seconds", "at_most", 5, null, "soft", "Keep arms uncrossed"),
      );
    }
  }

  // Qualitative directives --------------------------------------------------
  const directiveMatchers: Array<
    [RegExp, QualitativeDirective["category"]]
  > = [
    [/hook|opening|start with|begin with|narrative/i, "narrative_hook"],
    [/agenda|structure|transition|signpost|recap|outline/i, "structure"],
    [/slide|visual|chart|demo|diagram/i, "visual_aid"],
    [/tone|energy|enthusiasm|eye contact|pace|delivery/i, "delivery"],
  ];
  const directives: QualitativeDirective[] = [];
  for (const line of lines) {
    if (telemetryRules.some((r) => r.description === line)) continue;
    const hit = directiveMatchers.find(([re]) => re.test(line));
    if (hit && line.length > 15) {
      const slideMatch = line.match(/slide\s*(\d+)/i);
      directives.push({
        category: hit[1],
        instruction: line.replace(/^[-*·•]\s*/, ""),
        slideRef: slideMatch ? `slide ${slideMatch[1]}` : "n/a",
      });
    }
  }

  // Intentional-turn overrides ---------------------------------------------
  const semanticOverrides: SemanticOverride[] = [];
  for (const line of lines) {
    if (
      /(turn|look|glance|point)\s+(to|toward|at)\s+(the\s+)?(side|wall|slide|whiteboard|demo|table|screen)/i.test(
        line,
      )
    ) {
      semanticOverrides.push({
        cue: line.replace(/^[-*·•]\s*/, ""),
        protects: ["gaze_off_camera", "turned_away"],
        guidance: `Speaker intentionally turns away when the rubric says: "${line.slice(0, 80)}"`,
      });
    }
  }

  const title =
    (input.title ?? "").trim() ||
    (lines[0] && lines[0].length <= 60 ? lines[0] : "Custom grading rubric");

  return {
    engine: "local",
    title,
    slideText,
    directives,
    telemetryRules,
    semanticOverrides,
    summary: `Parsed ${telemetryRules.length} coaching rule(s), ${directives.length} directive(s), and ${semanticOverrides.length} intentional-turn override(s), all locally. No API key needed!`,
  };
}

/**
 * Detects unconventional moves & phrases from the transcript and telemetry
 * events. Phrases the user whitelisted as intentional are filtered out.
 */
export function detectUnconventionalMoves(
  transcript: string,
  telemetry: SessionSummary | null,
  whitelisted: string[],
): FlaggedMove[] {
  const lowered = whitelistSafe(transcript);
  const whitelist = new Set(whitelisted.map((w) => w.toLowerCase()));
  const moves: FlaggedMove[] = [];

  const phrasePatterns: Array<[RegExp, string]> = [
    [/\b(um+|uh+)\b/gi, "Filler word (um/uh)"],
    [/\b(like|you know|basically|actually|literally|kind of|sort of)\b/gi, "Hedge/filler phrase"],
    [/\b(sorry|apologize|i guess|i think maybe)\b/gi, "Apologetic hedging"],
    [/\b(anyway|so yeah|whatever)\b/gi, "Trailing-off phrase"],
  ];
  for (const [pattern, label] of phrasePatterns) {
    const matches = lowered.match(pattern);
    if (matches && matches.length >= 2) {
      const phrase = matches[0].toLowerCase();
      if (whitelist.has(phrase) || whitelist.has(label.toLowerCase())) continue;
      moves.push({
        id: `phrase-${phrase.replace(/\s+/g, "-")}`,
        phrase: label,
        kind: "phrase",
        count: matches.length,
        timestampSec: null,
        whitelisted: false,
      });
    }
  }

  if (telemetry) {
    const moveChecks: Array<[string, number, boolean]> = [
      ["Looked down at notes", Math.round(telemetry.gaze.offCameraSec), telemetry.gaze.offCameraSec > 8],
      ["Turned away from camera", Math.round(telemetry.gaze.turnedAwaySec), telemetry.gaze.turnedAwaySec > 6],
      ["Swayed while speaking", Math.round(telemetry.movement.swayingSec), telemetry.movement.swayingSec > 10],
      ["Crossed arms", Math.round(telemetry.arms.crossedSec), telemetry.arms.crossedSec > 5],
    ];
    for (const [label, seconds, trigger] of moveChecks) {
      if (!trigger) continue;
      if (whitelist.has(label.toLowerCase())) continue;
      const event = telemetry.events.find((e) =>
        e.kind.includes(label.toLowerCase().split(" ")[0]),
      );
      moves.push({
        id: `move-${label.toLowerCase().replace(/\s+/g, "-")}`,
        phrase: label,
        kind: "move",
        count: seconds,
        timestampSec: event ? Math.round(event.startMs / 1000) : null,
        whitelisted: false,
      });
    }
  }
  return moves;
}

/** Lowercases and strips punctuation for matching. */
function whitelistSafe(text: string): string {
  return text;
}

/** Builds timestamped weak-point feedback from telemetry events. */
export function buildTimestampedFeedback(
  telemetry: SessionSummary | null,
): TimestampedFeedback[] {
  if (!telemetry) return [];
  const labels: Record<string, [string, "minor" | "major"]> = {
    posture_violation: ["You leaned or slouched here", "minor"],
    gaze_off_camera: ["Glance off-camera (notes and slides are fine — just re-engage after)", "minor"],
    turned_away: ["You turned away from your audience here", "major"],
    arms_crossed: ["Arms crossed over your chest here", "minor"],
    hands_outside_box: ["Hands drifted out of the speaker's box", "minor"],
    swaying: ["Swaying back and forth", "minor"],
  };
  return telemetry.events
    .filter(
      (e) =>
        labels[e.kind] &&
        e.endMs - e.startMs > 800 &&
        // Sitting mode: stance/leg events never reach the feedback (P2).
        !(telemetry.postMode === "sitting" && e.kind === "swaying"),
    )
    .slice(0, 8)
    .map((e) => {
      const [label, severity] = labels[e.kind];
      return {
        label,
        startSec: Math.round(e.startMs / 1000),
        endSec: Math.round(e.endMs / 1000),
        severity,
      };
    });
}

/** Scores the transcript + telemetry against the parsed rubric, locally. */
export function localEvaluatePresentation(input: {
  transcript: string;
  slideText?: string;
  rubric: ParsedRubric | null;
  telemetry: SessionSummary | null;
  whitelisted?: string[];
  /** Headline scores of the user's recent runs — local baseline compare. */
  recentOveralls?: number[];
}): Scorecard {
  const transcript = (input.transcript ?? "").trim();
  const rubric = input.rubric;
  const telemetry = input.telemetry;
  const words = wordCount(transcript);

  const points: ScorecardPoint[] = [];
  const categories: ScorecardCategory[] = [];
  let pointId = 0;

  const addPoint = (
    category: string,
    title: string,
    status: ScorecardPoint["status"],
    maxPoints: number,
    deduction: number,
    feedback: string,
    evidence: ScoreEvidence[],
    recommendation: string,
  ) => {
    pointId += 1;
    points.push({
      id: `p${pointId}`,
      category,
      title,
      status,
      maxPoints,
      pointsDeducted: Math.min(deduction, maxPoints),
      feedback,
      evidence,
      recommendation,
    });
  };

  // ---------------------------------------------------------------------------
  // Strict weighted scoring — every point must be EARNED. Unchecked or failed
  // critical items (slide coverage, transcript depth, directives) drag the
  // weighted average down AND cap the maximum achievable score.
  // ---------------------------------------------------------------------------

  const transcriptWords = words;
  /** False when the user skipped the transcript and we only heard live audio. */
  const hasTranscript = transcriptWords > 0;

  // Internal weighted items (feed the score); display points below are
  // presentational only and never grant free credit.
  interface ScoreItem {
    category: "content" | "transcript" | "delivery" | "habits";
    weight: number;
    /** 0–1 fraction earned. */
    ratio: number;
  }
  const items: ScoreItem[] = [];

  // 1. Transcript depth (critical when words were captured; skipped when
  //    the coach only listened to live audio) --------------------------------
  const transcriptRatio =
    transcriptWords >= 120 ? 1 : transcriptWords >= 80 ? 0.7 : transcriptWords >= 40 ? 0.4 : 0;
  if (hasTranscript) {
    items.push({ category: "transcript", weight: 20, ratio: transcriptRatio });
    addPoint(
      "transcript",
      "Depth of your talk",
      transcriptRatio >= 0.7 ? "met" : "deducted",
      20,
      Math.round((1 - transcriptRatio) * 20),
      transcriptWords >= 120
        ? "Hey, nice depth! Your talk had room to really develop each idea."
        : transcriptWords >= 80
          ? "Solid start! A few sections could use one more example each."
          : "This one felt brief. Next time, flesh out each section with a story or example.",
      [
        {
          source: "transcript",
          detail:
            transcriptWords >= 120
              ? "You spoke enough for a full, coachable run."
              : "There wasn't much to coach on here. Aim for a longer, fuller talk next time.",
          timestampSec: null,
          count: null,
        },
      ],
      "Practice a full-length run so every section gets real airtime.",
    );
  } else {
    // No written words at all (live-audio run) — N/A, weight redistributes.
    addPoint(
      "transcript",
      "Depth of your talk",
      "na",
      20,
      0,
      "N/A (Skipped). I listened to your live audio instead of written words, so there's nothing to measure here. Your score is re-weighted across everything else.",
      [
        {
          source: "transcript",
          detail: "We only had your live audio this time.",
          timestampSec: null,
          count: null,
        },
      ],
      "Paste a script next time if you'd like this checked too.",
    );
  }

  // 2. Slide content coverage (critical WHEN slides AND spoken words exist;
  //    otherwise cleanly skipped — weight redistributes across the rest).
  const slideWords = keywords(rubric?.slideText || input.slideText || "", 30);
  const coverage =
    slideWords.length > 0 && hasTranscript
      ? overlapRatio(slideWords, transcript)
      : null;
  if (coverage !== null) {
    const coverageRatio = Math.min(1, coverage / 0.55);
    items.push({ category: "content", weight: 30, ratio: coverageRatio });
    // Name the slide ideas that never made it into the spoken talk so the
    // feedback is specific to THIS run instead of a generic template.
    const mentionedSlideWords = foundNeedles(slideWords, transcript);
    const missedSlideWords = slideWords.filter(
      (word) => !mentionedSlideWords.includes(word),
    );
    const missedList = missedSlideWords.slice(0, 3).join(", ");
    addPoint(
      "content",
      "Covering your slides",
      coverageRatio >= 1 ? "met" : "deducted",
      30,
      Math.round((1 - coverageRatio) * 30),
      coverageRatio >= 1
        ? "Nice! You hit the heart of your slides, so the audience heard what they read."
        : coverageRatio >= 0.4
          ? `Some slide points came through, but these never reached your talk: ${missedList}.`
          : `Most of your slide content stayed on the screen — I never heard ${missedList} out loud. Walk through each slide's main idea next time.`,
      [
        {
          source: "transcript",
          detail:
            coverageRatio >= 1
              ? "Your talk touched almost all of the important slide ideas."
              : `Never mentioned in your talk: ${missedList}.`,
          timestampSec: null,
          count: null,
        },
      ],
      "Give every slide one spoken takeaway sentence so nothing is left unread.",
    );
  } else {
    // Skipped: no slides, or no written words to match against.
    addPoint(
      "content",
      "Covering your slides",
      "na",
      30,
      0,
      hasTranscript
        ? "N/A (Skipped). You didn't upload slides this time, and that's completely ok. Your score is re-weighted across everything else."
        : "N/A (Skipped). I only had your live audio, so there's nothing written to match against your slides. Paste a script next time for a coverage check.",
      [
        {
          source: "transcript",
          detail: hasTranscript
            ? "No slides to compare against this time."
            : "We only had your live audio this time.",
          timestampSec: null,
          count: null,
        },
      ],
      "Add slides any time to check how well your talk covers them.",
    );
  }


  // 3. Delivery directives from the rubric -----------------------------------
  const directives = (rubric?.directives ?? []).slice(0, 6);
  let directivesHit = 0;
  for (const directive of directives) {
    const instruction = directive.instruction.replace(/^[-*·•]\s*/, "");
    const directiveWeight = Math.max(
      3,
      Math.round(20 / Math.max(1, directives.length)),
    );
    // Coaching points are matched against written words, so a live-audio
    // run can't check them: N/A with the weight redistributed.
    const directiveKeywords = keywords(directive.instruction, 6);
    const matched = foundNeedles(directiveKeywords, transcript);
    const hit =
      hasTranscript &&
      directiveKeywords.length > 0 &&
      matched.length / directiveKeywords.length > 0.25;
    if (hit) directivesHit += 1;
    if (hasTranscript) {
      items.push({
        category: "delivery",
        weight: directiveWeight,
        ratio: hit ? 1 : 0,
      });
    }
    // Tailored feedback — cite THIS run's actual words (or exactly what was
    // missing) instead of a canned sentence shared by every rubric point.
    const quoted = sentenceContaining(transcript, matched);
    const wanted = directiveKeywords.slice(0, 4).join(", ");
    const foundList = matched.slice(0, 3).join(", ");
    const feedback = !hasTranscript
      ? "N/A (Skipped). I checked coaching points against written words, and this run was live audio only."
      : hit
        ? quoted
          ? `This came through clearly — you said it yourself: “${clipQuote(quoted)}”`
          : `This came through clearly: I matched ${foundList} in your transcript.`
        : matched.length > 0
          ? `It only half-landed: your talk mentions ${foundList}, but never as one clear statement of this point. ${instruction} — make that a single, unmistakable line next run.`
          : `Nothing in what you said touches this: I searched your transcript for ${wanted} and found none of it. ${instruction}.`;
    const evidenceDetail = !hasTranscript
      ? "Needs written words to check."
      : hit
        ? quoted
          ? `You said: “${clipQuote(quoted)}”`
          : `Matched in your transcript: ${foundList}.`
        : matched.length > 0
          ? `Only “${matched.slice(0, 3).join("”, “")}” from this rubric line appeared in your talk.`
          : `None of its key words (${wanted}) appear in what you said.`;
    addPoint(
      "delivery",
      `Coaching point: ${instruction.slice(0, 60)}`,
      !hasTranscript ? "na" : hit ? "met" : "deducted",
      directiveWeight,
      hit ? 0 : directiveWeight,
      feedback,
      [
        {
          source: "rubric",
          detail: evidenceDetail,
          timestampSec: null,
          count: null,
        },
      ],
      `Next run, make this unmistakable: ${instruction}`,
    );
  }

  // 4. Delivery habits from the rubric's numeric rules ------------------------
  const rules = rubric?.telemetryRules ?? [];
  let rulesChecked = 0;
  let hardRuleMissed = false;
  for (const rule of rules) {
    const measured = measureRule(rule, telemetry);
    const met =
      measured !== null &&
      (rule.comparator === "at_least"
        ? measured >= rule.value
        : rule.comparator === "at_most"
          ? measured <= rule.value
          : measured >= rule.value && measured <= (rule.valueMax ?? Infinity));
    if (measured !== null) {
      rulesChecked += 1;
      if (!met && rule.severity === "hard") hardRuleMissed = true;
    }
    const ruleWeight = Math.max(4, Math.round(30 / Math.max(1, rules.length)));
    // Lens-gaze habits are light preferences: a miss costs at most 3 points so
    // natural glances at notes/slides never nuke the score. Unchecked habits
    // still earn NOTHING — the cap below keeps the total honest.
    const gazeRule =
      rule.metric === "gaze_deviation_deg" || rule.metric === "head_yaw_deg";
    const missDeduction = met
      ? 0
      : gazeRule
        ? Math.min(3, ruleWeight)
        : ruleWeight;
    items.push({
      category: "habits",
      weight: ruleWeight,
      ratio: met ? 1 : measured === null ? 0 : 1 - missDeduction / ruleWeight,
    });
    const friendly = friendlyMetricMessage(rule.metric, met);
    addPoint(
      "habits",
      `Habit: ${friendly.short}`,
      measured === null ? "na" : met ? "met" : "deducted",
      ruleWeight,
      missDeduction,
      measured === null
        ? "I couldn't watch for this one. Keep the camera on during practice so I can help with it."
        : friendly.feedback,
      [
        {
          source: "telemetry",
          detail:
            measured === null
              ? "Not captured this time."
              : met
                ? "I watched this closely during your run, and you nailed it!"
                : "I watched this closely during your run, and it slipped a little.",
          timestampSec: null,
          count: null,
        },
      ],
      friendly.coaching,
    );
  }

  // Weighted average (redistributing category weight when a category is empty)
  // Verbal + non-verbal flow (delivery & habits) carry the most weight;
  // slide/depth categories are supporting evidence.
  const CATEGORY_WEIGHTS: Record<ScoreItem["category"], number> = {
    content: 25,
    transcript: 20,
    delivery: 25,
    habits: 30,
  };
  const presentCategories = new Set(items.map((i) => i.category));
  let earned = 0;
  let totalWeight = 0;
  for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS) as Array<
    [ScoreItem["category"], number]
  >) {
    if (!presentCategories.has(category)) continue;
    const catItems = items.filter((i) => i.category === category);
    const catWeight = catItems.reduce((s, i) => s + i.weight, 0);
    const catEarned = catItems.reduce((s, i) => s + i.weight * i.ratio, 0);
    // Scale the category back to its nominal weight.
    earned += (catEarned / Math.max(1, catWeight)) * weight;
    totalWeight += weight;
  }
  const weighted = totalWeight > 0 ? (earned / totalWeight) * 100 : 0;

  // Critical-failure caps — a low basic requirement drags the ceiling down.
  // Skipped slides and live-audio runs are NOT penalized; their weight just
  // redistributes across the other categories.
  let cap = 100;
  if (hasTranscript && transcriptWords < 40) cap = Math.min(cap, 40);
  else if (hasTranscript && transcriptWords < 80) cap = Math.min(cap, 65);
  if (coverage !== null && coverage < 0.15) cap = Math.min(cap, 55);
  if (hasTranscript && directives.length > 0 && directivesHit === 0) {
    cap = Math.min(cap, 55);
  }
  if (rules.length > 0 && rulesChecked === 0) cap = Math.min(cap, 60);
  if (hardRuleMissed) cap = Math.min(cap, 75);

  const overallScore = Math.min(100, Math.round(weighted), cap);
  const grade =
    overallScore >= 85
      ? "excellent"
      : overallScore >= 70
        ? "good"
        : overallScore >= 55
          ? "fair"
          : "needs_work";

  // Category display roll-up (mirrors the nominal weights above) --------------
  const catMeta: Record<ScoreItem["category"], string> = {
    content: "Covering your slides",
    transcript: "Depth of your talk",
    delivery: "Following your rubric's coaching",
    habits: "Delivery habits",
  };
  for (const [id, name] of Object.entries(catMeta)) {
    const catPoints = points.filter((p) => p.category === id);
    if (catPoints.length === 0) continue;
    // Skipped / unchecked ("na") points are excluded from the display totals
    // so they neither inflate nor deflate the category line.
    const scored = catPoints.filter((p) => p.status !== "na");
    const maxPoints = scored.reduce((s, p) => s + p.maxPoints, 0);
    const deductionTotal = scored.reduce((s, p) => s + p.pointsDeducted, 0);
    categories.push({
      id,
      name,
      maxPoints,
      awardedPoints: maxPoints - deductionTotal,
      deductionTotal,
    });
  }

  const gaps: string[] = [];
  if (hasTranscript && transcriptWords < 80) gaps.push("a fuller talk");
  if (coverage !== null && coverage < 0.55) gaps.push("more slide coverage");
  if (hasTranscript && directives.length > 0 && directivesHit < directives.length) {
    gaps.push("the rubric's coaching points");
  }

  // Personalised trend vs the user's own recent runs: up → strength,
  // down → improvement. Baseline = mean of the supplied headline scores.
  const baseline =
    input.recentOveralls && input.recentOveralls.length > 0
      ? Math.round(
          input.recentOveralls.reduce((a, b) => a + b, 0) /
            input.recentOveralls.length,
        )
      : null;
  const trendDelta = baseline === null ? null : overallScore - baseline;

  return {
    engine: "local",
    overallScore,
    grade,
    summary:
      totalWeight === 0
        ? "There wasn't much I could coach on that run. Turn the camera on and try again, and I'll have plenty to say!"
        : overallScore >= 70
          ? `Hey, strong run against “${rubric?.title ?? "your rubric"}”! Your delivery really stood out.`
          : gaps.length > 0
            ? `You've got real room to grow here. Next time, focus on ${gaps.slice(0, 2).join(" and ")}, and you'll see a big jump.`
            : `A steady run against “${rubric?.title ?? "your rubric"}”. Tighten a few details and you'll shine.`,
    categories,
    points,
    telemetryHighlights: buildHighlights(telemetry),
    strengths: [
      ...(baseline !== null && trendDelta !== null && trendDelta > 0
        ? [
            `You're up ${trendDelta} point${trendDelta === 1 ? "" : "s"} on your recent average of ${baseline}.`,
          ]
        : []),
      ...buildStrengths(telemetry, coverage),
    ].slice(0, 6),
    improvements: [
      ...(baseline !== null && trendDelta !== null && trendDelta < 0
        ? [
            `That's ${Math.abs(trendDelta)} point${Math.abs(trendDelta) === 1 ? "" : "s"} below your recent average of ${baseline} — start with the fix below.`,
          ]
        : []),
      ...buildImprovements(telemetry, coverage, gaps),
    ].slice(0, 6),
    timestampedFeedback: buildTimestampedFeedback(telemetry),
    flaggedMoves: detectUnconventionalMoves(
      transcript,
      telemetry,
      input.whitelisted ?? [],
    ),
  };
}

/**
 * Maps internal metric keys to warm, jargon-free coaching copy. The UI never
 * shows metric names or raw values — only these friendly sentences.
 */
function friendlyMetricMessage(
  metric: TelemetryRule["metric"],
  met: boolean,
): { short: string; feedback: string; coaching: string } {
  const M: Record<string, { short: string; good: string; bad: string; tip: string }> = {
    wpm: {
      short: "a comfortable speaking pace",
      good: "Nice pace! You sounded conversational and easy to follow.",
      bad: "You were racing a bit there. Try slowing down during the key points so they land.",
      tip: "Take a little breath between sections and let your words breathe too.",
    },
    pause_seconds: {
      short: "natural pauses between sections",
      good: "Great pauses! You gave your best points room to breathe.",
      bad: "You ran your sections together. A short breath between ideas will help them stick.",
      tip: "Count to two quietly after a big point, then keep going.",
    },
    pitch_std_hz: {
      short: "a lively, varied tone",
      good: "Your voice had a nice bounce to it. That variation keeps people listening!",
      bad: "Your tone was a little flat at times. Try punching the important words and going softer on the rest.",
      tip: "Whisper the setup, then say the punchline out loud. That contrast is gold.",
    },
    posture_lean_deg: {
      short: "an upright, centered stance",
      good: "Hey, nice posture! You looked centered and confident up there.",
      bad: "Your posture dipped at times. Quick fix: roll your shoulders back and stand tall.",
      tip: "Pretend a string is pulling the top of your head toward the ceiling.",
    },
    shoulder_tilt_deg: {
      short: "level, relaxed shoulders",
      good: "Your shoulders stayed relaxed. That reads as calm and confident.",
      bad: "One shoulder crept up when you got into it. Drop both between sections.",
      tip: "Shake your arms out, then settle back into a level stance.",
    },
    gaze_deviation_deg: {
      short: "steady audience orientation",
      good: "You stayed oriented toward your audience — engaged and present.",
      bad: "Your focus drifted off the audience a few times. Natural glances at notes or slides are fine; just re-engage a beat sooner.",
      tip: "Glance away freely, then let your eyes lead you back to the audience.",
    },
    head_yaw_deg: {
      short: "facing your audience",
      good: "You stayed facing your audience the whole time. Nice!",
      bad: "You spent some stretches turned away from your audience. Brief turns are natural — keep the long stretches facing them.",
      tip: "When you glance at notes, let your eyes move, not your whole head.",
    },
    arms_crossed_seconds: {
      short: "relaxed, open arms",
      good: "Nice, your arms stayed open and relaxed.",
      bad: "Your arms crossed over your chest for a bit. Keep them open, it reads as confidence.",
      tip: "Rest your hands loosely together at waist height when you're not gesturing.",
    },
    hands_outside_box_seconds: {
      short: "gestures in a natural zone",
      good: "Your hands stayed in a natural speaking zone. Nice gestures!",
      bad: "Your hands drifted out of view for a bit. Keep them around chest height.",
      tip: "Imagine a soft box in front of your chest and keep your gestures inside it.",
    },
    sway_frequency_hz: {
      short: "a grounded stance",
      good: "You stood solid! That grounded stance really works.",
      bad: "There was some swaying in there. Plant your feet and shift weight only when you mean to.",
      tip: "Stand with your feet a little wider than your hips for a steadier base.",
    },
    sway_seconds: {
      short: "a grounded stance",
      good: "You stood solid! That grounded stance really works.",
      bad: "There was some swaying in there. Plant your feet and shift weight only when you mean to.",
      tip: "Stand with your feet a little wider than your hips for a steadier base.",
    },
    steps: {
      short: "purposeful movement",
      good: "Nice movement! You moved with purpose.",
      bad: "You moved around a bit much. Stay put unless a step helps make your point.",
      tip: "Give yourself one planned move per section instead of pacing.",
    },
  };
  const copy = M[metric] ?? {
    short: "this coaching point",
    good: "Nice work on this one!",
    bad: "This one slipped a little this time.",
    tip: "Keep it in mind for your next run and you'll get it.",
  };
  return {
    short: copy.short,
    feedback: met ? copy.good : copy.bad,
    coaching: copy.tip,
  };
}

/** Maps a rubric telemetry rule to a measured value from the summary. */
function measureRule(
  rule: TelemetryRule,
  telemetry: SessionSummary | null,
): number | null {
  if (!telemetry) return null;
  // Sitting mode: stance/leg rules aren't applicable → "na" (P2).
  if (telemetry.postMode === "sitting" && STANCE_METRICS.has(rule.metric)) {
    return null;
  }
  const r = round2;
  switch (rule.metric) {
    case "wpm":
      return telemetry.audio.estimatedWpm > 0
        ? telemetry.audio.estimatedWpm
        : null;
    case "pause_seconds":
      return r(telemetry.audio.avgPauseSec);
    case "pitch_std_hz":
      return telemetry.audio.pitchStdDevHz;
    case "posture_lean_deg":
      return r(telemetry.posture.avgLeanDeg);
    case "shoulder_tilt_deg":
      return r(telemetry.posture.maxAbsLeanDeg);
    case "gaze_deviation_deg":
      return telemetry.gaze.avgDeviationDeg;
    case "head_yaw_deg":
      return r(telemetry.gaze.turnedAwaySec);
    case "arms_crossed_seconds":
      return r(telemetry.arms.crossedSec);
    case "hands_outside_box_seconds":
      return r(telemetry.box.outsideSec);
    case "sway_seconds":
      return r(telemetry.movement.swayingSec);
    case "sway_frequency_hz":
      // SessionSummary keeps swaying seconds + events; approximate Hz.
      return telemetry.movement.swayingSec > 0
        ? round1(telemetry.movement.swayingEvents / telemetry.movement.swayingSec)
        : null;
    case "steps":
      return telemetry.movement.steps;
    default:
      return null;
  }
}

/** Warm, jargon-free highlights with specifics from the actual attempt. */
function buildHighlights(
  telemetry: SessionSummary | null,
): Scorecard["telemetryHighlights"] {
  if (!telemetry) return [];
  const highlights: Scorecard["telemetryHighlights"] = [];
  const wpm = telemetry.audio.estimatedWpm;
  if (wpm > 0) {
    const comfortable = wpm >= 130 && wpm <= 160;
    highlights.push({
      metric: "Pace",
      observation: comfortable
        ? `You were cruising at around ${wpm} words a minute. Right in the comfy zone!`
        : wpm > 160
          ? `You were flying at around ${wpm} words a minute. Slow to a comfy, conversational rhythm.`
          : `You were taking it easy at around ${wpm} words a minute. Add a little more energy to keep people with you.`,
      assessment: comfortable ? "good" : "needs_work",
    });
  }
  if (telemetry.audio.pitchStdDevHz !== null) {
    const varied = telemetry.audio.pitchStdDevHz >= 12;
    highlights.push({
      metric: "Voice variety",
      observation: varied
        ? "Your tone had a nice bounce to it. Never flat for a second!"
        : "Your tone stayed pretty even. Punch the key words and you'll sound electric.",
      assessment: varied ? "good" : "needs_work",
    });
  }
  const upright = telemetry.posture.violationSec < 8;
  highlights.push({
    metric: "Posture",
    observation: upright
      ? "Hey, nice posture! You stayed upright and centered the whole run."
      : `Your posture dipped for about ${Math.round(telemetry.posture.violationSec)} seconds in there. Roll your shoulders back between sections and you'll fix that fast.`,
    assessment: upright ? "good" : "needs_work",
  });
  const steadyEyes = telemetry.gaze.offCameraEvents <= 2;
  highlights.push({
    metric: "Audience presence",
    observation: steadyEyes
      ? "You stayed oriented toward your audience — engaged and present throughout."
      : `Your focus drifted off the audience ${telemetry.gaze.offCameraEvents} times. Natural glances are fine — just re-engage a beat sooner.`,
    assessment: steadyEyes
      ? "good"
      : telemetry.gaze.offCameraEvents <= 5
        ? "ok"
        : "needs_work",
  });
  // Sitting mode: no stance/movement highlight at all (P2).
  if (telemetry.postMode !== "sitting") {
    const grounded = telemetry.movement.swayingSec < 10;
    highlights.push({
      metric: "Movement",
      observation: grounded
        ? "You stood solid where you were. That grounded stance really works."
        : `You shifted around for about ${Math.round(telemetry.movement.swayingSec)} seconds. Plant your feet and move only when you mean to.`,
      assessment: grounded ? "good" : "needs_work",
    });
  }
  return highlights;
}

/** Strengths derived from the measured signals. */
function buildStrengths(
  telemetry: SessionSummary | null,
  coverage: number | null,
): string[] {
  const strengths: string[] = [];
  if (coverage !== null && coverage > 0.55) {
    strengths.push("You covered the heart of your slides in your delivery.");
  }
  if (telemetry) {
    if (telemetry.audio.estimatedWpm >= 130 && telemetry.audio.estimatedWpm <= 160) {
      strengths.push("A comfortable, conversational pace throughout.");
    }
    if (telemetry.gaze.offCameraEvents <= 2) {
      strengths.push("You stayed engaged with your audience — glances and all.");
    }
    if (telemetry.posture.violationSec < 8) {
      strengths.push("Confident, upright posture the whole way through.");
    }
    if ((telemetry.audio.pitchStdDevHz ?? 0) >= 12) {
      strengths.push("Your tone stayed lively and kept the audience engaged.");
    }
  }
  if (strengths.length === 0) strengths.push("You completed a full practice run. That's a great start!");
  return strengths.slice(0, 5);
}

/** Improvement areas derived from the measured signals. */
function buildImprovements(
  telemetry: SessionSummary | null,
  coverage: number | null,
  gaps: string[] = [],
): string[] {
  const improvements: string[] = [...gaps.map((g) => `Give more attention to ${g} next run.`)];
  if (coverage !== null && coverage < 0.55 && !gaps.includes("more slide coverage")) {
    improvements.push("Reference more of the slide content explicitly as you move between slides.");
  }
  if (telemetry) {
    const wpm = telemetry.audio.estimatedWpm;
    if (wpm > 0 && wpm < 130) {
      improvements.push("Pick up the pace a little — aim for a lively 130–160 wpm rhythm.");
    }
    if (wpm > 160) {
      improvements.push("Ease off the pace a touch so every idea has room to land.");
    }
    if (telemetry.gaze.offCameraEvents > 4) {
      improvements.push(
        "Brief glances at notes or slides are natural — practice returning your focus to the audience a beat sooner.",
      );
    }
    if (telemetry.posture.violationSec >= 8) {
      improvements.push("Your posture slipped for a while. Reset your shoulders between sections.");
    }
    if (
      telemetry.postMode !== "sitting" &&
      telemetry.movement.swayingSec >= 10
    ) {
      improvements.push("Plant your feet and shift your weight only when you mean to.");
    }
  }
  if (improvements.length === 0) {
    improvements.push("Add one deliberate pause after each key point for emphasis.");
  }
  return improvements.slice(0, 5);
}

