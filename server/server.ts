import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { evaluateHandler } from "./routes/evaluate";
import { generateQuestionsHandler } from "./routes/generate-questions";
import { parseRubricHandler } from "./routes/parse-rubric";
import { scoreHandler } from "./routes/score";

/**
 * Pitch Perfect (Manestage) API (Cloud Run). API-only: the Next.js frontend is
 * deployed separately on Vercel and calls these routes via NEXT_PUBLIC_API_BASE.
 * MediaPipe telemetry and Web Speech captions stay in the browser.
 *
 *   GET  /api/health                        -> {"status":"ok"}
 *   POST /api/score                         -> score one interview answer / presentation run
 *   POST /api/interview/generate-questions  -> 5 tailored questions with STAR pointers
 *   POST /api/presentation/evaluate         -> point-by-point presentation scorecard
 *   POST /api/presentation/parse-rubric     -> rubric (+ optional PDF slides) -> structured rubric
 */

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    // No CORS_ORIGINS set (local dev) -> allow any origin. Otherwise only the listed ones.
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)),
  }),
);

// Text payloads (transcripts, rubrics, telemetry summaries) are capped well under 1 MB by the
// routes; parse-rubric may carry a base64 PDF of up to 10 MB (~13.4 MB encoded). Both sit
// under Cloud Run's 32 MB request limit.
const json = express.json({ limit: "1mb" });
const jsonWithPdf = express.json({ limit: "15mb" });

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/score", json, scoreHandler);
app.post("/api/interview/generate-questions", json, generateQuestionsHandler);
app.post("/api/presentation/evaluate", json, evaluateHandler);
app.post("/api/presentation/parse-rubric", jsonWithPdf, parseRubricHandler);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found. This is the Pitch Perfect API; the app itself is on the frontend." });
});

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = Number((err as { status?: number }).status) || 500;
  if (status === 413) return res.status(413).json({ error: "That request is too large." });
  if (status === 400) return res.status(400).json({ error: "Request body must be valid JSON." });
  console.error(err);
  return res.status(500).json({ error: "Something went wrong on the server." });
};
app.use(onError);

const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log(`Pitch Perfect API listening on 0.0.0.0:${port}`);
});
