import { describe, expect, it } from "vitest";

import {
  applyCameraGuard,
  shouldScore,
  type PresentationFeedback,
} from "@/lib/presentation-feedback-schema";
import {
  buildPresentationScorerInput,
  parsePresentationFeedback,
} from "@/lib/presentation-scorer";
import type { PresentationScoreRequest } from "@/lib/score";

/**
 * Fixture-driven tests for the presentation scorer pipeline (#28):
 * no speech, camera off, a normal talk, and an empty objective.
 */

const NORMAL_TRANSCRIPT =
  "Welcome everyone. Today I'll show you how our referral program works. We grew signups by eighteen percent last quarter, and I'll walk you through the three levers: incentives, timing, and reminders. Let's start with the numbers on this slide.";

function baseRequest(
  overrides: Partial<PresentationScoreRequest> = {},
): PresentationScoreRequest {
  return {
    type: "presentation",
    transcript: NORMAL_TRANSCRIPT,
    objective: "",
    keyTakeaways: "",
    audience: "",
    callToAction: "",
    slidesText: "",
    rubricText: "",
    scriptText: "",
    priorities: [],
    previousRuns: [],
    recentSessions: [],
    events: [],
    measured: {
      cameraOn: true,
      wordCount: 39,
      wordsPerMinute: 130,
      fillerCount: 0,
      fillerList: [],
      pauseCount: 2,
      avgPauseSec: 1.2,
      gazePct: 72,
      posturePct: 88,
      fidgetFlags: 0,
      postMode: "standing",
      scriptCoveragePct: null,
      durationSec: 18,
    },
    ...overrides,
  };
}

/** Model output with quotes verbatim from NORMAL_TRANSCRIPT. */
function normalModelOutput(): unknown {
  return {
    status: "scored",
    insufficientReason: null,
    skills: {
      pace: {
        score: 82,
        evidenceQuote: "measured 130 wpm over 18s with 2 pauses",
        reason: "In the conversational band with real pauses.",
      },
      clarity: {
        score: 85,
        evidenceQuote: "I'll walk you through the three levers",
        reason: "Plain language, zero fillers measured.",
      },
      structure: {
        score: 80,
        evidenceQuote: "Today I'll show you how our referral program works",
        reason: "Open, roadmap, then the numbers.",
      },
      presence: {
        score: 75,
        evidenceQuote: "measured fidgetFlags 0 with steady posture",
        reason: "Calm, still delivery.",
      },
      eyeContact: {
        score: 70,
        evidenceQuote: "measured gazePct 72",
        reason: "Mostly audience-facing.",
      },
      posture: {
        score: 88,
        evidenceQuote: "measured posturePct 88",
        reason: "Centered and aligned.",
      },
    },
    overall: 50,
    feedback: {
      strength: {
        text: "You open with a clear roadmap: “Today I'll show you how our referral program works”.",
        quote: "Today I'll show you how our referral program works",
      },
      priorityFix: {
        text: "Close the loop on the levers you promised.",
        quote: "incentives, timing, and reminders",
      },
      rewrittenSentence: {
        original: "We grew signups by eighteen percent last quarter",
        improved:
          "We grew signups eighteen percent last quarter with three levers — name them next",
      },
      vsLastAttempt: null,
      askUser: null,
    },
    confidence: "high",
  };
}

describe("no speech", () => {
  it("rejects an empty transcript at the gate", () => {
    expect(shouldScore("")).toBe(false);
  });
  it("rejects a whispered fragment at the gate", () => {
    expect(shouldScore("Um, hi.")).toBe(false);
  });
  it("passes the model's insufficient verdict straight through", () => {
    const parsed = parsePresentationFeedback(
      {
        status: "insufficient_data",
        insufficientReason: "No speech detected.",
        skills: null,
        overall: null,
        feedback: null,
        confidence: "low",
      },
      "",
      false,
    );
    expect(parsed!.status).toBe("insufficient_data");
    expect(parsed!.overall).toBeNull();
  });
});

describe("camera off", () => {
  it("forces eyeContact and posture to null and recomputes overall", () => {
    const parsed = parsePresentationFeedback(
      normalModelOutput(),
      NORMAL_TRANSCRIPT,
      false, // camera off
    )!;
    expect(parsed.skills!.eyeContact.score).toBeNull();
    expect(parsed.skills!.posture.score).toBeNull();
    expect(parsed.skills!.eyeContact.reason).toBe(
      "Camera was off, so this was not measured.",
    );
    // The four speech skills survive: (82 + 85 + 80 + 75) / 4 = 81
    expect(parsed.overall).toBe(81);
  });

  it("applyCameraGuard leaves feedback untouched when the camera was on", () => {
    const fb = normalModelOutput() as PresentationFeedback;
    applyCameraGuard(fb, true);
    expect(fb.skills!.eyeContact.score).toBe(70);
    expect(fb.skills!.posture.score).toBe(88);
  });
});

describe("normal talk", () => {
  it("keeps quotes verified against the transcript and recomputes overall", () => {
    const parsed = parsePresentationFeedback(
      normalModelOutput(),
      NORMAL_TRANSCRIPT,
      true,
    )!;
    expect(parsed.status).toBe("scored");
    for (const s of Object.values(parsed.skills!)) {
      if (s.score !== null && !s.evidenceQuote!.toLowerCase().startsWith("measured")) {
        expect(
          NORMAL_TRANSCRIPT.toLowerCase().includes(
            s.evidenceQuote!.toLowerCase(),
          ),
        ).toBe(true);
      }
    }
    // All six skills valid: (82 + 85 + 80 + 75 + 70 + 88) / 6 = 80
    expect(parsed.overall).toBe(80);
    expect(parsed.feedback!.strength.text).toContain("referral program");
  });
});

describe("empty objective", () => {
  it("sends an empty objective instead of inventing one (#10/#27)", () => {
    const payload = buildPresentationScorerInput(baseRequest());
    expect(payload.objective).toBe("");
    expect(payload.keyTakeaways).toBe("");
    expect(payload.callToAction).toBe("");
    expect(payload.audience).toBe("");
    expect(payload.rubricText).toBe("");
  });

  it("passes user-entered objective fields straight through", () => {
    const payload = buildPresentationScorerInput(
      baseRequest({
        objective: "Win buy-in for the referral program",
        keyTakeaways: "Three levers drive signups",
        audience: "Growth team",
      }),
    );
    expect(payload.objective).toBe("Win buy-in for the referral program");
    expect(payload.keyTakeaways).toBe("Three levers drive signups");
    expect(payload.audience).toBe("Growth team");
  });
});

describe("drill + timestamped evidence guardrails", () => {
  it("keeps a valid drill and an atSec matching a supplied event", () => {
    const raw = normalModelOutput() as PresentationFeedback;
    const fb = raw.feedback!;
    fb.strength.atSec = 8;
    fb.priorityFix.atSec = 9;
    fb.priorityFix.drill = {
      title: "Close-the-loop drill",
      steps: ["Rewrite your closing line", "Deliver it in 20 seconds"],
      minutes: 3,
    };
    const parsed = parsePresentationFeedback(raw, NORMAL_TRANSCRIPT, true, {
      durationSec: 60,
      eventSecs: [8, 40],
    })!;
    expect(parsed.feedback!.priorityFix.drill!.title).toBe(
      "Close-the-loop drill",
    );
    expect(parsed.feedback!.strength.atSec).toBe(8);
    // 9 s sits within ±1 s of the supplied 8 s event.
    expect(parsed.feedback!.priorityFix.atSec).toBe(9);
  });

  it("drops atSec with no events, no matching event, or outside the session", () => {
    const withAt = (at: number) => {
      const raw = normalModelOutput() as PresentationFeedback;
      raw.feedback!.strength.atSec = at;
      return raw;
    };
    // No timing options at all → nothing to verify against.
    expect(
      parsePresentationFeedback(
        withAt(8),
        NORMAL_TRANSCRIPT,
        true,
      )!.feedback!.strength.atSec,
    ).toBeNull();
    // The supplied events don't include this second.
    expect(
      parsePresentationFeedback(withAt(7), NORMAL_TRANSCRIPT, true, {
        durationSec: 60,
        eventSecs: [40],
      })!.feedback!.strength.atSec,
    ).toBeNull();
    // Beyond the session length.
    expect(
      parsePresentationFeedback(withAt(90), NORMAL_TRANSCRIPT, true, {
        durationSec: 60,
        eventSecs: [90],
      })!.feedback!.strength.atSec,
    ).toBeNull();
  });

  it("drops a malformed drill but keeps the scorecard", () => {
    const raw = normalModelOutput() as PresentationFeedback;
    raw.feedback!.priorityFix.drill = { title: "", steps: ["  "], minutes: 3 };
    const parsed = parsePresentationFeedback(raw, NORMAL_TRANSCRIPT, true)!;
    expect(parsed.feedback!.priorityFix.drill).toBeNull();
    expect(parsed.overall).toBe(80);
  });
});

describe("enriched scorer payload", () => {
  it("passes script, priorities, recent sessions and evidence events through", () => {
    const payload = buildPresentationScorerInput(
      baseRequest({
        scriptText: "My intended opening: three levers, one number each",
        priorities: [{ label: "Structure", weight: 3 }],
        recentSessions: [
          {
            at: 1_700_000_000_000,
            overall: 71,
            skills: { Structure: 74 },
            title: "Case study",
          },
        ],
        events: [{ kind: "gaze_off_camera", startSec: 8, endSec: 12 }],
      }),
    );
    expect(payload.scriptText).toContain("three levers");
    expect(payload.priorities).toEqual([{ label: "Structure", weight: 3 }]);
    expect(payload.recentSessions).toHaveLength(1);
    expect(payload.evidenceEvents).toEqual([
      { kind: "gaze_off_camera", startSec: 8, endSec: 12 },
    ]);
  });
});

describe("content blocks (#28b)", () => {
  /** Model output WITH script adherence, criteria results and top fixes. */
  function outputWithContent(): Record<string, unknown> {
    return {
      ...(normalModelOutput() as Record<string, unknown>),
      scriptAdherence: {
        coveragePct: 72,
        covered: ["the three levers"],
        skipped: ["the closing recap"],
        addedOffScript: ["we grew signups by eighteen percent last quarter"],
        reason: "The closing recap never arrived.",
      },
      criteriaResults: [
        {
          label: "Structure",
          verdict: "partially_met",
          evidenceQuote: "I'll walk you through the three levers",
          fix: "Add a closing recap naming the three levers again.",
        },
        {
          label: "Invented criterion",
          verdict: "met",
          evidenceQuote: "a quote that is not in the transcript at all",
          fix: "n/a",
        },
      ],
      top3Fixes: [
        {
          text: "Close the loop on the levers",
          atSec: 8,
          evidenceQuote: "incentives, timing, and reminders",
        },
        {
          text: "A fix backed by a fabricated quote",
          atSec: null,
          evidenceQuote: "totally made up words",
        },
      ],
    };
  }

  it("parses the new blocks and keeps verifiable entries", () => {
    const parsed = parsePresentationFeedback(
      outputWithContent(),
      NORMAL_TRANSCRIPT,
      true,
      { durationSec: 60, eventSecs: [8] },
    )!;
    expect(parsed.scriptAdherence!.coveragePct).toBe(72);
    expect(parsed.scriptAdherence!.skipped).toEqual(["the closing recap"]);
    // Verbatim off-script quote survives.
    expect(parsed.scriptAdherence!.addedOffScript).toContain(
      "we grew signups by eighteen percent last quarter",
    );
    expect(parsed.criteriaResults).toHaveLength(2);
    expect(parsed.top3Fixes[0]!.text).toBe("Close the loop on the levers");
    // atSec 8 matches the supplied event.
    expect(parsed.top3Fixes[0]!.atSec).toBe(8);
  });

  it("nulls evidence quotes that are not in the transcript", () => {
    const parsed = parsePresentationFeedback(
      outputWithContent(),
      NORMAL_TRANSCRIPT,
      true,
      { durationSec: 60, eventSecs: [8] },
    )!;
    const bogus = parsed.criteriaResults.find(
      (c) => c.label === "Invented criterion",
    )!;
    expect(bogus.evidenceQuote).toBeNull();
    const fakeFix = parsed.top3Fixes.find((f) =>
      f.text.includes("fabricated quote"),
    )!;
    expect(fakeFix.evidenceQuote).toBeNull();
  });

  it("drops a top-fix atSec that matches no supplied event", () => {
    const raw = outputWithContent();
    (raw.top3Fixes as Array<{ atSec: number | null }>)[1]!.atSec = 55;
    const parsed = parsePresentationFeedback(raw, NORMAL_TRANSCRIPT, true, {
      durationSec: 60,
      eventSecs: [8],
    })!;
    const second = parsed.top3Fixes.find((f) =>
      f.text.includes("fabricated quote"),
    )!;
    expect(second.atSec).toBeNull();
  });

  it("defaults the new blocks to empty when the model omits them (backward compat)", () => {
    const parsed = parsePresentationFeedback(
      normalModelOutput(),
      NORMAL_TRANSCRIPT,
      true,
    )!;
    expect(parsed.scriptAdherence).toBeNull();
    expect(parsed.criteriaResults).toEqual([]);
    expect(parsed.top3Fixes).toEqual([]);
    expect(parsed.overall).toBe(80);
  });
});
