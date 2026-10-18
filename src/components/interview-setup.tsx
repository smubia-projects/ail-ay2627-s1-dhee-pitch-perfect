"use client";

/**
 * Interview setup form: paste Job Description, Resume, Target Role and
 * Company News, then trigger Gemini to generate 5 targeted STAR questions.
 * Reports the generated set (and inputs needed downstream, e.g. company
 * news for strategic alignment) via `onGenerated`.
 */

import * as React from "react";
import { CircleCheck, LoaderCircle, Sparkles, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { GeneratedQuestions, QuestionGenerationInput } from "@/lib/interview";

export type InterviewSetupValue = QuestionGenerationInput;

export function InterviewSetup({
  onGenerated,
}: {
  /** Called with the generated questions and the inputs used. */
  onGenerated: (questions: GeneratedQuestions, inputs: InterviewSetupValue) => void;
}) {
  const [targetRole, setTargetRole] = React.useState("");
  const [jobDescription, setJobDescription] = React.useState("");
  const [resume, setResume] = React.useState("");
  const [companyNews, setCompanyNews] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [generated, setGenerated] = React.useState<GeneratedQuestions | null>(null);

  async function handleGenerate(): Promise<void> {
    const inputs: InterviewSetupValue = {
      targetRole: targetRole.trim(),
      jobDescription: jobDescription.trim(),
      resume: resume.trim(),
      companyNews: companyNews.trim(),
    };
    if (!inputs.targetRole && !inputs.jobDescription && !inputs.resume) {
      setError("Add a target role, job description, or resume first.");
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      const response = await fetch("/api/interview/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputs),
      });
      const data = (await response.json()) as GeneratedQuestions & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? `Question generation failed (${response.status}).`);
      }
      setGenerated(data);
      onGenerated(data, inputs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Question generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  const hasInputs =
    targetRole.trim().length > 0 ||
    jobDescription.trim().length > 0 ||
    resume.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="size-4" />
          Interview setup
        </CardTitle>
        <CardDescription>
          Paste the job description, your resume, and company news — Gemini
          generates 5 targeted questions with STAR pointers.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="target-role">
              Target role
            </label>
            <Input
              id="target-role"
              value={targetRole}
              placeholder="e.g. Senior Product Manager"
              onChange={(event) => setTargetRole(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="company-news">
              Company news / press releases
            </label>
            <Textarea
              id="company-news"
              rows={3}
              value={companyNews}
              placeholder="Recent company news for strategic alignment (optional)…"
              onChange={(event) => setCompanyNews(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="resume">
              Resume
            </label>
            <Textarea
              id="resume"
              rows={3}
              value={resume}
              placeholder="Paste your resume / CV text…"
              onChange={(event) => setResume(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="job-description">
            Job description
          </label>
          <Textarea
            id="job-description"
            rows={5}
            value={jobDescription}
            placeholder="Paste the full job description…"
            onChange={(event) => setJobDescription(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void handleGenerate()} disabled={generating || !hasInputs}>
            {generating ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {generating ? "Generating…" : "Generate 5 questions"}
          </Button>
          {generated && (
            <Badge variant="secondary" className="gap-1">
              <CircleCheck className="size-3" />
              {generated.questions.length} questions for {generated.role}
            </Badge>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {generated && generated.summary && (
          <p className="text-sm text-muted-foreground">{generated.summary}</p>
        )}
      </CardContent>
    </Card>
  );
}
