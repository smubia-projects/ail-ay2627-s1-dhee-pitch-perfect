/** POST /api/interview/generate-questions — JSON: { targetRole, jobDescription, resume, companyNews }. Returns 5 STAR-guided questions. */

import type { Request, Response } from "express";

import {
  chatCompletion,
  generateWithRetry,
  getModel,
  jsonSchemaFormat,
} from "@/lib/openrouter";
import {
  GENERATE_QUESTIONS_SCHEMA,
  type GeneratedQuestions,
  type QuestionGenerationInput,
} from "@/lib/interview";
import { MAX_RUBRIC_CHARS, MAX_SLIDE_CHARS, trimForPrompt } from "@/lib/presentation";

/** Company-news context shares the slide-text size budget. */
const MAX_COMPANY_NEWS_CHARS = MAX_SLIDE_CHARS;

export async function generateQuestionsHandler(req: Request, res: Response) {
  // express.json() has already parsed (and size-capped) the body.
  const body = (req.body ?? {}) as QuestionGenerationInput;

  const jobDescription = (body.jobDescription ?? "").trim();
  const resume = (body.resume ?? "").trim();
  const targetRole = (body.targetRole ?? "").trim();
  const companyNews = (body.companyNews ?? "").trim();

  if (!jobDescription && !resume && !targetRole) {
    return res.status(400).json({ error: "Provide a job description, resume, or target role." });
  }
  if (jobDescription.length > MAX_RUBRIC_CHARS) {
    return res.status(400).json({ error: `Job description exceeds ${MAX_RUBRIC_CHARS.toLocaleString()} characters.` });
  }
  if (resume.length > MAX_RUBRIC_CHARS) {
    return res.status(400).json({ error: `Resume exceeds ${MAX_RUBRIC_CHARS.toLocaleString()} characters.` });
  }

  console.info(
    `[agent:interview-generate] step=received role="${targetRole || "(derive)"}" jdChars=${jobDescription.length} resumeChars=${resume.length} companyNewsChars=${companyNews.length}`,
  );

  if (!(process.env.API_KEY || process.env.OPENROUTER_API_KEY)?.trim()) {
    return res.status(500).json({ error: "Question generation is not configured (OPENROUTER_API_KEY missing)." });
  }

  const sections = [
    `You are an expert technical recruiter and interview coach generating questions for a mock interview.

TASK
Produce EXACTLY 5 interview questions for the target role, tailored to the job description and resume below.

REQUIREMENTS
- Questions must be realistic things a hiring manager for this role would actually ask (mix behavioral, role-specific, and one strategic/company-aware question when company news is provided).
- Cover a spread of competencies (no two questions probe the same competency).
- Each question needs a "competency" (primary skill judged) and "starPointers" telling the candidate what a STRONG STAR answer must include:
  • situation — the context a brief (1–2 sentence) Situation should establish;
  • task — the responsibility/Goal the Task must make explicit;
  • action — the personal actions and active verbs the Action should demonstrate (prefer first-person ownership);
  • result — the measurable outcome a convincing Result must prove.
- ids must be exactly "q1"…"q5" in order.
- "role" echoes the target role (derive it from the job description title if not given).
- "summary" is 1–2 sentences describing the set's focus.

OUTPUT: JSON only matching the provided schema.`,
    `TARGET ROLE:\n${targetRole || "(derive from the job description)"}`,
    `JOB DESCRIPTION:\n${jobDescription ? trimForPrompt(jobDescription, MAX_RUBRIC_CHARS) : "(not provided)"}`,
    `RESUME:\n${resume ? trimForPrompt(resume, MAX_RUBRIC_CHARS) : "(not provided)"}`,
    `COMPANY NEWS / PRESS RELEASE CONTEXT:\n${companyNews ? trimForPrompt(companyNews, MAX_COMPANY_NEWS_CHARS) : "(none provided — skip the company-aware question and leave alignment out)"}`,
  ];

  try {
    const prompt = sections.join("\n\n");
    console.info(
      `[agent:interview-generate] step=calling-llm model=${getModel()} promptChars=${prompt.length}`,
    );
    const text = await generateWithRetry(() =>
      chatCompletion({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        maxTokens: 4096,
        responseFormat: jsonSchemaFormat("interview_questions", GENERATE_QUESTIONS_SCHEMA),
      }),
    );
    const parsed = JSON.parse(text) as GeneratedQuestions;

    const questions: GeneratedQuestions = {
      role: typeof parsed.role === "string" ? parsed.role : targetRole,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      questions: Array.isArray(parsed.questions)
        ? parsed.questions.slice(0, 5).filter((q) => q && typeof q.question === "string")
        : [],
    };
    if (questions.questions.length === 0) {
      return res.status(502).json({ error: "Model returned no questions — try adding a job description." });
    }

    console.info(
      `[agent:interview-generate] step=questions-generated count=${questions.questions.length} role="${questions.role}"`,
    );
    return res.json(questions);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Question generation failed.";
    console.error(`[agent:interview-generate] step=failed error="${message.slice(0, 200)}"`);
    return res.status(502).json({ error: `AI question generation failed: ${message}` });
  }
}

