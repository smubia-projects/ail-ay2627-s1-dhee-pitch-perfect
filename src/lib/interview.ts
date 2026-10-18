/**
 * Shared types & Gemini schemas for the Interview Coach engine:
 * STAR-structured question generation and answer evaluation
 * (pacing/initiation, STAR structure, strategic alignment, directness).
 */

import { Type, type Schema } from "@google/genai";

// ---------------------------------------------------------------------------
// Question generation
// ---------------------------------------------------------------------------

/** Inputs accepted by POST /api/interview/generate-questions. */
export interface QuestionGenerationInput {
  /** Full job description text. */
  jobDescription: string;
  /** Candidate resume/CV text. */
  resume: string;
  /** Target role title, e.g. "Senior Product Manager". */
  targetRole: string;
  /** Company news / press-release context for strategic alignment. */
  companyNews: string;
}

/** Target STAR elements for one generated question. */
export interface StarPointers {
  situation: string;
  task: string;
  action: string;
  result: string;
}

export interface GeneratedQuestion {
  /** Stable id, e.g. "q1". */
  id: string;
  question: string;
  /** Primary competency being probed. */
  competency: string;
  starPointers: StarPointers;
}

/** Output of POST /api/interview/generate-questions. */
export interface GeneratedQuestions {
  /** Which engine produced this: Gemini, or the offline fallback. */
  engine?: "gemini" | "local";
  role: string;
  questions: GeneratedQuestion[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Gemini response schemas (strict JSON output)
// ---------------------------------------------------------------------------

/** Schema for POST /api/interview/generate-questions. */
export const GENERATE_QUESTIONS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    role: {
      type: Type.STRING,
      description: "The target role the questions are tailored to.",
    },
    questions: {
      type: Type.ARRAY,
      minItems: "5",
      maxItems: "5",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: 'Exactly "q1"…"q5".' },
          question: {
            type: Type.STRING,
            description: "A realistic interview question a hiring manager would ask.",
          },
          competency: {
            type: Type.STRING,
            description:
              'Primary competency probed, e.g. "Leadership", "Stakeholder management", "Execution under pressure".',
          },
          starPointers: {
            type: Type.OBJECT,
            properties: {
              situation: {
                type: Type.STRING,
                description: "What a strong Situation paragraph should cover.",
              },
              task: {
                type: Type.STRING,
                description: "What a strong Task statement must make clear.",
              },
              action: {
                type: Type.STRING,
                description: "Which personal actions/verbs the story should demonstrate.",
              },
              result: {
                type: Type.STRING,
                description: "What measurable outcome the Result should prove.",
              },
            },
            required: ["situation", "task", "action", "result"],
          },
        },
        required: ["id", "question", "competency", "starPointers"],
      },
    },
    summary: {
      type: Type.STRING,
      description: "1–2 sentence summary of the question set and its focus.",
    },
  },
  required: ["role", "questions", "summary"],
};





// ---------------------------------------------------------------------------
// Local question generation (no API key required)
// ---------------------------------------------------------------------------

const LOCAL_QUESTION_TEMPLATES: Array<{
  competency: string;
  situation: string;
  task: string;
  action: string;
  result: string;
}> = [
  {
    competency: "Ownership & impact",
    situation:
      "a high-stakes project where the outcome directly affected your team or customers",
    task: "the responsibility you personally carried and why it mattered",
    action:
      "the specific decisions and actions YOU took (first-person: I led, I built, I decided)",
    result: "a measurable outcome — %, $, time saved, or growth you drove",
  },
  {
    competency: "Problem solving",
    situation: "an ambiguous or broken process you encountered",
    task: "the goal you set to fix or improve it",
    action:
      "how you analyzed options, what you chose, and how you convinced others",
    result: "the quantifiable improvement and what you learned",
  },
  {
    competency: "Leadership & influence",
    situation: "a moment of conflict, misalignment, or a hard trade-off",
    task: "the outcome you needed from people who didn't report to you",
    action:
      "how you communicated, negotiated, and kept the team moving forward",
    result: "the relationship and business result, with numbers if possible",
  },
  {
    competency: "Resilience & learning",
    situation: "a project that failed or badly surprised you",
    task: "the recovery plan you owned after the setback",
    action:
      "the concrete changes you made to your approach, tools, or communication",
    result: "the measurable bounce-back and the lesson you now apply everywhere",
  },
  {
    competency: "Role craft & excellence",
    situation: "the hardest individual-contributor challenge in your discipline",
    task: "the standard of quality you committed to",
    action:
      "the craft decisions, trade-offs, and execution details you personally handled",
    result: "how the outcome performed against that standard (with metrics)",
  },
];

/**
 * Deterministic in-browser question generator — used when the Gemini
 * route is unreachable or no API key is configured. Tailors wording to
 * the target role and job description keywords.
 */
export function generateQuestionsLocally(
  input: QuestionGenerationInput,
): GeneratedQuestions {
  const role = input.targetRole.trim() || "the target role";
  const keywords = (input.jobDescription + " " + input.resume)
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((w) => w.length > 3)
    .slice(0, 8);

  const questions: GeneratedQuestion[] = LOCAL_QUESTION_TEMPLATES.map(
    (template, index) => ({
      id: `q${index + 1}`,
      question:
        index === 0
          ? `Tell me about a time you made a big impact as a ${role}.`
          : `Describe a situation testing your ${template.competency.toLowerCase()} as a ${role}.`,
      competency: template.competency,
      starPointers: {
        situation: template.situation,
        task: template.task,
        action: template.action,
        result: template.result,
      },
    }),
  );

  return {
    engine: "local",
    role,
    questions,
    summary: keywords.length
      ? `Five STAR questions tailored to ${role}, weighted toward the skills your materials emphasize (${keywords.slice(0, 5).join(", ")}).`
      : `Five STAR questions tailored to the ${role} role.`,
  };
}

