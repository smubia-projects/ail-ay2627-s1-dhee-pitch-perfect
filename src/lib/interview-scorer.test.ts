import { describe, expect, it } from "vitest";

import {
  InterviewFeedbackSchema,
  shouldScore,
  validate,
  type InterviewFeedback,
} from "@/lib/interview-feedback-schema";
import {
  buildInterviewScorerInput,
  computeInterviewMeasured,
  parseInterviewFeedback,
} from "@/lib/interview-scorer";

/**
 * Fixture-driven tests for the interview scorer pipeline (#26).
 *
 * The Gemini call itself is not made here — these tests exercise the
 * deterministic pipeline around it: the shouldScore() cost gate, the Zod
 * schema, and the validate() guardrails (verbatim-quote verification + code
 * recomputation of `overall`). Model outputs below are captured in the exact
 * shape the system prompt requests for each fixture.
 */

const WEAK_TRANSCRIPT =
  "Um, so we had a project and it was kind of hard, but we got it done in the end and it went well.";

const STRONG_TRANSCRIPT =
  "In my second year I led a four-person team building a checkout flow for a campus startup. Cart abandonment was at 62%, so I ran five user interviews, found the address form was the blocker, and rebuilt it as a single step. I shipped it in two weeks and abandonment dropped to 41%.";

const OFF_TOPIC_TRANSCRIPT =
  "I believe teamwork is the most important value in any organization, and I always give my best every single day regardless of the task at hand or the environment around me.";

/** A scored model response whose quotes are verbatim from WEAK_TRANSCRIPT. */
function weakModelOutput(): unknown {
  return {
    status: "scored",
    insufficientReason: null,
    skills: {
      structuredThinking: {
        score: 25,
        evidenceQuote: "so we had a project",
        reason: "No clear opening or signposting.",
      },
      starCar: {
        score: 15,
        evidenceQuote: "we had a project and it was kind of hard",
        reason: "Situation only — no Task, Action or Result.",
      },
      measurableImpact: {
        score: 10,
        evidenceQuote: "it went well",
        reason: "No number or concrete outcome anywhere.",
      },
      clarityDelivery: {
        score: 35,
        evidenceQuote: "Um, so we had a project",
        reason: "Opens with fillers.",
      },
      ownership: {
        score: 20,
        evidenceQuote: "we got it done in the end",
        reason: "Only 'we' — no personal actions.",
      },
      roleFit: {
        score: null,
        evidenceQuote: null,
        reason: "Role not provided, so roleFit cannot be scored.",
      },
    },
    overall: 99,
    feedback: {
      strength: {
        text: "You carried the story to a finish: “we got it done in the end”.",
        quote: "we got it done in the end",
      },
      priorityFix: {
        text: "Name the project and your part in it — you only said “we had a project”.",
        quote: "we had a project",
      },
      rewrittenSentence: {
        original: "we had a project and it was kind of hard",
        improved:
          "I led a campus housing portal project that was blocked by a slow approval queue",
      },
      vsLastAttempt: null,
      askUser: "What was the project, and what was your part in it?",
    },
    confidence: "medium",
  };
}

describe("shouldScore cost gate", () => {
  it("rejects an empty transcript", () => {
    expect(shouldScore("")).toBe(false);
  });
  it("rejects a one-word answer", () => {
    expect(shouldScore("Um")).toBe(false);
  });
  // The spec's weak fixture is 24 words — under the 30-word guardrail the
  // route answers insufficient_data locally (no API call, no cost).
  it("rejects the weak fixture transcript (< 30 words)", () => {
    expect(shouldScore(WEAK_TRANSCRIPT)).toBe(false);
  });
  it("accepts the strong and off-topic fixture transcripts", () => {
    expect(shouldScore(STRONG_TRANSCRIPT)).toBe(true);
    expect(shouldScore(OFF_TOPIC_TRANSCRIPT)).toBe(true);
  });
});

describe("weak fixture (model output pipeline)", () => {
  const parsed = parseInterviewFeedback(weakModelOutput(), WEAK_TRANSCRIPT);

  it("parses and keeps a verbatim quote for every scored skill", () => {
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe("scored");
    const skills = parsed!.skills!;
    for (const s of Object.values(skills)) {
      if (s.score !== null) {
        expect(s.evidenceQuote).toBeTruthy();
        expect(
          WEAK_TRANSCRIPT.toLowerCase().includes(
            s.evidenceQuote!.toLowerCase(),
          ),
        ).toBe(true);
      }
    }
  });

  it("expects low STAR and measurable impact", () => {
    const skills = parsed!.skills!;
    expect(skills.starCar.score).toBeLessThan(40);
    expect(skills.measurableImpact.score).toBeLessThan(40);
  });

  it("keeps the askUser question about the project", () => {
    expect(parsed!.feedback!.askUser).toBe(
      "What was the project, and what was your part in it?",
    );
  });

  it("recomputes overall in code (never the model's 99)", () => {
    // (25 + 15 + 10 + 35 + 20) / 5 valid skills = 21
    expect(parsed!.overall).toBe(21);
  });

  it("roleFit stays n/a (null) when the role was not provided", () => {
    expect(parsed!.skills!.roleFit.score).toBeNull();
  });
});

/** A scored model response whose quotes are verbatim from STRONG_TRANSCRIPT. */
function strongModelOutput(): unknown {
  return {
    status: "scored",
    insufficientReason: null,
    skills: {
      structuredThinking: {
        score: 80,
        evidenceQuote: "Cart abandonment was at 62%",
        reason: "Opens with the problem, then the plan.",
      },
      starCar: {
        score: 85,
        evidenceQuote:
          "I ran five user interviews, found the address form was the blocker",
        reason: "Clear Action; Result quantified.",
      },
      measurableImpact: {
        score: 92,
        evidenceQuote: "abandonment dropped to 41%",
        reason: "Hard numbers before and after.",
      },
      clarityDelivery: {
        score: 78,
        evidenceQuote: "rebuilt it as a single step",
        reason: "Concise; no filler detected.",
      },
      ownership: {
        score: 88,
        evidenceQuote: "I led a four-person team building a checkout flow",
        reason: "First-person ownership throughout.",
      },
      roleFit: {
        score: 75,
        evidenceQuote: "campus startup",
        reason: "Ties to product delivery for a startup.",
      },
    },
    overall: 1,
    feedback: {
      strength: {
        text: "You own the outcome: “abandonment dropped to 41%” is exactly how impact should sound.",
        quote: "abandonment dropped to 41%",
      },
      priorityFix: {
        text: "Name the trade-off you made when rebuilding the form as a single step.",
        quote: "rebuilt it as a single step",
      },
      rewrittenSentence: {
        original: "Cart abandonment was at 62%, so I ran five user interviews",
        improved:
          "I cut cart abandonment from 62% to 41% by running five user interviews and rebuilding the address form as a single step",
      },
      vsLastAttempt:
        "Your impact is up: last time the result had no number; this time abandonment dropped to 41%.",
      askUser: null,
    },
    confidence: "high",
  };
}

describe("strong fixture (model output pipeline)", () => {
  const parsed = parseInterviewFeedback(strongModelOutput(), STRONG_TRANSCRIPT);

  it("expects high ownership, impact and STAR", () => {
    const skills = parsed!.skills!;
    expect(skills.ownership.score).toBeGreaterThanOrEqual(81);
    expect(skills.measurableImpact.score).toBeGreaterThanOrEqual(81);
    expect(skills.starCar.score).toBeGreaterThanOrEqual(61);
  });

  it("keeps a rewrittenSentence built from their own words and facts", () => {
    const improved = parsed!.feedback!.rewrittenSentence.improved;
    expect(improved).toContain("62%");
    expect(improved).toContain("41%");
    expect(improved).toContain("five user interviews");
  });

  it("carries the comparison with the last attempt", () => {
    expect(parsed!.feedback!.vsLastAttempt).toContain(
      "abandonment dropped to 41%",
    );
  });

  it("recomputes overall in code (never the model's 1)", () => {
    // (80 + 85 + 92 + 78 + 88 + 75) / 6 = 83
    expect(parsed!.overall).toBe(83);
  });
});

describe("off-topic fixture (model output pipeline)", () => {
  it("expects low roleFit with a verbatim quote", () => {
    const raw = {
      status: "scored",
      insufficientReason: null,
      skills: {
        structuredThinking: {
          score: 30,
          evidenceQuote: "I believe teamwork is the most important value",
          reason: "No structure around the claim.",
        },
        starCar: {
          score: 0,
          evidenceQuote: null,
          reason: "No situation, task, action or result.",
        },
        measurableImpact: {
          score: 0,
          evidenceQuote: null,
          reason: "No outcome of any kind.",
        },
        clarityDelivery: {
          score: 55,
          evidenceQuote: "I always give my best every single day",
          reason: "Fluent but generic.",
        },
        ownership: {
          score: 35,
          evidenceQuote: "I always give my best",
          reason: "First person, but no decision named.",
        },
        roleFit: {
          score: 25,
          evidenceQuote: "teamwork is the most important value",
          reason: "Nothing ties this to the role, industry or objective.",
        },
      },
      overall: 50,
      feedback: {
        strength: {
          text: "You speak confidently.",
          quote: "I always give my best",
        },
        priorityFix: {
          text: "Replace the generalities with one real example.",
          quote: "teamwork is the most important value",
        },
        rewrittenSentence: {
          original: "I always give my best every single day",
          improved:
            "I give my best by owning one concrete outcome — name yours with a number",
        },
        vsLastAttempt: null,
        askUser: "What is one concrete example from the role you want?",
      },
      confidence: "medium",
    };
    const parsed = parseInterviewFeedback(raw, OFF_TOPIC_TRANSCRIPT);
    expect(parsed).not.toBeNull();
    expect(parsed!.skills!.roleFit.score).toBeLessThan(41);
    expect(parsed!.overall).not.toBeNull();
    expect(parsed!.overall!).toBeLessThan(50);
  });
});

describe("insufficient data passthrough", () => {
  it("keeps the model's insufficient_data verdict", () => {
    const raw = {
      status: "insufficient_data",
      insufficientReason: "Transcript is empty.",
      skills: null,
      overall: null,
      feedback: null,
      confidence: "low",
    };
    const parsed = parseInterviewFeedback(raw, "");
    expect(parsed!.status).toBe("insufficient_data");
    expect(parsed!.overall).toBeNull();
    expect(parsed!.skills).toBeNull();
  });

  it("rejects a malformed shape (route retries once)", () => {
    expect(
      parseInterviewFeedback({ status: "scored" }, "some transcript"),
    ).toBeNull();
  });
});

describe("guardrails", () => {
  it("drops any score whose quote is not in the transcript and recomputes overall", () => {
    const raw = strongModelOutput() as InterviewFeedback;
    // Forge an invented quote on the impact skill.
    raw.skills!.measurableImpact.evidenceQuote =
      "we doubled revenue overnight which never happened";
    const parsed = parseInterviewFeedback(raw, STRONG_TRANSCRIPT)!;
    expect(parsed.skills!.measurableImpact.score).toBeNull();
    expect(parsed.skills!.measurableImpact.reason).toBe(
      "No verifiable evidence in transcript.",
    );
    // Overall now averages the 5 surviving skills: (80+85+78+88+75)/5 = 81
    expect(parsed.overall).toBe(81);
  });

  it("withholds the headline when fewer than 4 skills survive", () => {
    const fb = InterviewFeedbackSchema.parse({
      status: "scored",
      insufficientReason: null,
      skills: {
        structuredThinking: { score: 50, evidenceQuote: "x", reason: "r" },
        starCar: { score: 60, evidenceQuote: "x", reason: "r" },
        measurableImpact: { score: 70, evidenceQuote: "x", reason: "r" },
        clarityDelivery: { score: null, evidenceQuote: null, reason: "n/a" },
        ownership: { score: null, evidenceQuote: null, reason: "n/a" },
        roleFit: { score: null, evidenceQuote: null, reason: "n/a" },
      },
      overall: 90,
      feedback: null,
      confidence: "low",
    });
    validate(fb, "x");
    expect(fb.overall).toBeNull();
  });
});

describe("measured signals (computed in code, never by the model)", () => {
  it("counts words, fillers and wpm from the transcript + duration", () => {
    const m = computeInterviewMeasured(
      "Um, this is my answer and um I really like how it went, you know?",
      60,
    );
    expect(m.wordCount).toBe(15);
    expect(m.wordsPerMinute).toBe(15);
    expect(m.fillerCount).toBe(4);
    expect([...m.fillerList].sort()).toEqual(["like", "um", "you know"]);
    expect(m.durationSec).toBe(60);
  });

  it("reports zero wpm when the duration is unusable", () => {
    const m = computeInterviewMeasured(
      "One two three four five six seven eight nine ten eleven twelve thirteen fourteen",
      0,
    );
    expect(m.wordsPerMinute).toBe(0);
  });
});

describe("drill + timestamp guardrails", () => {
  it("defaults missing atSec/drill to null", () => {
    const parsed = parseInterviewFeedback(weakModelOutput(), WEAK_TRANSCRIPT)!;
    expect(parsed.feedback!.strength.atSec).toBeNull();
    expect(parsed.feedback!.priorityFix.atSec).toBeNull();
    expect(parsed.feedback!.priorityFix.drill).toBeNull();
  });

  it("keeps a valid drill, but forces any invented atSec to null", () => {
    const raw = weakModelOutput() as InterviewFeedback;
    raw.feedback!.priorityFix.atSec = 12;
    raw.feedback!.strength.atSec = 4;
    raw.feedback!.priorityFix.drill = {
      title: "Own the story in 60 seconds",
      steps: [
        "Rewrite the opening as “I led …”",
        "Add one number to the Result",
      ],
      minutes: 4,
    };
    const parsed = parseInterviewFeedback(raw, WEAK_TRANSCRIPT)!;
    expect(parsed.feedback!.priorityFix.drill!.title).toBe(
      "Own the story in 60 seconds",
    );
    expect(parsed.feedback!.priorityFix.drill!.steps).toHaveLength(2);
    // Interviews have no camera timeline — invented timestamps are dropped.
    expect(parsed.feedback!.strength.atSec).toBeNull();
    expect(parsed.feedback!.priorityFix.atSec).toBeNull();
  });

  it("drops a drill with no usable steps but keeps the scorecard", () => {
    const raw = weakModelOutput() as InterviewFeedback;
    raw.feedback!.priorityFix.drill = {
      title: "  ",
      steps: ["   "],
      minutes: 3,
    };
    const parsed = parseInterviewFeedback(raw, WEAK_TRANSCRIPT)!;
    expect(parsed.feedback!.priorityFix.drill).toBeNull();
    expect(parsed.status).toBe("scored");
    expect(parsed.overall).not.toBeNull();
  });
});

describe("recent-sessions pass-through", () => {
  it("forwards the user's own baseline in the scorer payload", () => {
    const payload = buildInterviewScorerInput({
      question: "Tell me about a tough project.",
      transcript: STRONG_TRANSCRIPT,
      role: "Product Manager",
      industry: "Fintech",
      projects: "",
      objective: "",
      previousAttempts: [],
      recentSessions: [
        {
          at: 1_700_000_000_000,
          overall: 71,
          skills: { clarity: 70, ownership: 66 },
          title: "Product Manager interview",
        },
      ],
      measured: computeInterviewMeasured(STRONG_TRANSCRIPT, 45),
    });
    expect(payload.recentSessions).toEqual([
      {
        at: 1_700_000_000_000,
        overall: 71,
        skills: { clarity: 70, ownership: 66 },
        title: "Product Manager interview",
      },
    ]);
    expect(payload.previousAttempts).toEqual([]);
  });
});

