"use client";

/**
 * Interview Coach · Step 2 — Question Set Calibration.
 * AI-generated questions from the context (Gemini route with a local
 * fallback) that the user can edit in place, delete, or extend with their
 * own custom questions before taking the stage.
 */

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";

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
import { Mane } from "@/components/mascot/mane";
import { SpeechBubble } from "@/components/mascot/speech-bubble";
import { cn } from "@/lib/utils";
import type { GeneratedQuestion } from "@/lib/interview";
import { industryLabel, type InterviewContext } from "@/lib/interview-manestage";

export function QuestionStep({
  context,
  questions,
  onQuestionsChange,
  generating,
  error,
  engine,
  onGenerate,
  onContinue,
}: {
  context: InterviewContext;
  questions: GeneratedQuestion[];
  onQuestionsChange: (next: GeneratedQuestion[]) => void;
  generating: boolean;
  error: string | null;
  /** Which engine produced the current set (shown as a badge). */
  engine: "gemini" | "local" | null;
  onGenerate: () => void;
  onContinue: () => void;
}) {
  const [customDraft, setCustomDraft] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);

  function updateQuestion(id: string, text: string): void {
    onQuestionsChange(
      questions.map((q) => (q.id === id ? { ...q, question: text } : q)),
    );
  }

  function removeQuestion(id: string): void {
    onQuestionsChange(questions.filter((q) => q.id !== id));
  }

  function addCustom(): void {
    const text = customDraft.trim();
    if (!text) return;
    onQuestionsChange([
      ...questions,
      {
        id: `custom-${Date.now().toString(36)}`,
        question: text,
        competency: "User-added",
        starPointers: {
          situation: "set the scene briefly",
          task: "name your responsibility",
          action: "your first-person actions",
          result: "the measurable outcome",
        },
      },
    ]);
    setCustomDraft("");
  }

  const canContinue = questions.length > 0 && !generating;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-5"
    >
      {/* Mane intro */}
      <div className="flex items-start gap-3 rounded-none border border-iris-700/20 bg-iris-100/70 p-4">
        <Mane attire="interview" size={96} />
        <SpeechBubble
          className="mt-2 flex-1"
          text={`Here are your questions for the ${context.role || "the role"} job in ${industryLabel(context)}. Edit any line, delete what you don't like, or add your own.`}
        />
      </div>

      <Card className="border-iris-700/25">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 font-display text-base">
            <Sparkles className="size-4 text-iris-700" />
            Tailored question set
            {engine && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[11px]",
                  engine === "gemini"
                    ? "border-iris-600/60 bg-iris-100 text-iris-800"
                    : "border-ink-300 bg-ink-50 text-ink-700",
                )}
              >
                {engine === "gemini" ? "Gemini-generated" : "Local generator"}
              </Badge>
            )}
            <Badge
              variant="outline"
              className="ml-auto tabular-nums text-ink-700"
            >
              {questions.length} question{questions.length === 1 ? "" : "s"}
            </Badge>
          </CardTitle>
          <CardDescription>
            I wrote these from your context. Edit them to make them yours.
            Each one comes with STAR tips.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {generating && (
            <p className="flex items-center gap-2 rounded-none border border-iris-700/20 bg-iris-50 px-3 py-2.5 text-sm text-iris-900">
              <LoaderCircle className="size-4 animate-spin" />
              Mane is drafting questions from your context…
            </p>
          )}
          {error && (
            <p className="rounded-none border border-iris-700/30 bg-iris-100 px-3 py-2.5 text-sm text-iris-900">
              {error}
            </p>
          )}

          {questions.length === 0 && !generating && (
            <p className="py-6 text-center text-sm text-ink-900/60">
              No questions yet. Hit Generate with AI below, or add your own
              to build the set.
            </p>
          )}

          {questions.map((q, i) => {
            const editing = editingId === q.id;
            return (
              <div
                key={q.id}
                className="flex flex-col gap-2 rounded-none border border-iris-700/20 bg-card p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-none bg-iris-500 text-xs font-bold text-[#2a2118] tabular-nums">
                    {i + 1}
                  </span>
                  <Badge
                    variant="outline"
                    className="border-iris-600/50 bg-iris-100 text-iris-800"
                  >
                    <Target className="size-3" />
                    {q.competency}
                  </Badge>
                  <span className="ml-auto flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={editing ? "Stop editing" : "Edit question"}
                      onClick={() =>
                        setEditingId((cur) => (cur === q.id ? null : q.id))
                      }
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Delete question"
                      className="text-iris-800 hover:text-iris-900"
                      onClick={() => removeQuestion(q.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </span>
                </div>

                {editing ? (
                  <textarea
                    autoFocus
                    value={q.question}
                    onChange={(e) => updateQuestion(q.id, e.target.value)}
                    onBlur={() => setEditingId(null)}
                    rows={2}
                    className="w-full rounded-none border border-iris-600/50 bg-card p-2.5 font-sans text-sm text-ink-900 outline-none focus:ring-2 focus:ring-iris-500/40"
                  />
                ) : (
                  <p className="font-display text-sm font-medium text-ink-900">
                    {q.question}
                  </p>
                )}

                <details className="rounded-none border border-iris-700/15 bg-iris-50/60 px-3 py-2 text-xs text-ink-900/70">
                  <summary className="cursor-pointer font-semibold text-iris-800">
                    STAR pointers for a strong answer
                  </summary>
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    <li>
                      <span className="font-semibold">S:</span>{" "}
                      {q.starPointers.situation}
                    </li>
                    <li>
                      <span className="font-semibold">T:</span>{" "}
                      {q.starPointers.task}
                    </li>
                    <li>
                      <span className="font-semibold">A:</span>{" "}
                      {q.starPointers.action}
                    </li>
                    <li>
                      <span className="font-semibold">R:</span>{" "}
                      {q.starPointers.result}
                    </li>
                  </ul>
                </details>
              </div>
            );
          })}

          {/* Add custom question */}
          <div className="flex flex-col gap-2 rounded-none border border-dashed border-iris-700/40 bg-iris-50/50 p-3">
            <label
              htmlFor="custom-question"
              className="text-sm font-medium text-ink-900"
            >
              Add your own question
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="custom-question"
                className="flex-1"
                value={customDraft}
                placeholder="e.g. Walk me through how you'd prioritise a backlog with competing stakeholders."
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
              />
              <Button
                variant="secondary"
                disabled={!customDraft.trim()}
                onClick={addCustom}
              >
                <Plus className="size-4" />
                Add
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          disabled={generating}
          onClick={onGenerate}
          className="border-iris-700/40 text-iris-900"
        >
          <RefreshCw className={cn("size-4", generating && "animate-spin")} />
          Generate with AI
        </Button>
        <Button size="lg" disabled={!canContinue} onClick={onContinue}>
          Take the stage
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </motion.div>
  );
}