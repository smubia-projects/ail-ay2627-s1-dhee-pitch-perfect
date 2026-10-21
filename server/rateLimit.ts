import { createRateLimiter } from "./rateLimitEngine.js";

/**
 * Rate-limit adapter: the shared engine (rateLimitEngine.js) with this project's
 * slug and one bucket per LLM route. The engine handles X-Forwarded-For, central
 * config from the control sheet, event mode, the kill switch (503) and fail-open.
 * Without Upstash credentials it is a no-op, which is what local dev wants.
 */
const limiter = createRateLimiter({
  // Slug = full project folder name (matches the central control-sheet rows).
  project: "ail-ay2627-s1-dhee-pitch-perfect",
  buckets: {
    score: Number(process.env.RATE_LIMIT_SCORE_MAX || 5),
    generate_questions: Number(process.env.RATE_LIMIT_GENERATE_QUESTIONS_MAX || 5),
    evaluate: Number(process.env.RATE_LIMIT_EVALUATE_MAX || 5),
    parse_rubric: Number(process.env.RATE_LIMIT_PARSE_RUBRIC_MAX || 5),
  },
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN,
  defaultWindow: Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 432000),
});

export const limitScore = limiter("score");
export const limitGenerateQuestions = limiter("generate_questions");
export const limitEvaluate = limiter("evaluate");
export const limitParseRubric = limiter("parse_rubric");
