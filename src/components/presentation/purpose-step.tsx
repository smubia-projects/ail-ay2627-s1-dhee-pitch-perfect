"use client";

/**
 * Presentation Coach · Step 1 — Purpose Selection.
 * Mane asks "What is the purpose of the presentation?" and offers the three
 * curated purposes plus an "Other" custom questionnaire (core objective,
 * key takeaway, CTA, audience profile, format & logistics, persona & style).
 */

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  ClipboardList,
  GraduationCap,
  ListChecks,
  Rocket,
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
import {
  DEFAULT_CUSTOM_QUESTIONNAIRE,
  PURPOSE_OPTIONS,
  type CustomQuestionnaire,
  type PurposeId,
  type PurposeSelection,
} from "@/lib/manestage";

const OPTION_ICON: Record<PurposeId, React.ComponentType<{ className?: string }>> = {
  "case-study": ClipboardList,
  "startup-pitch": Rocket,
  academic: GraduationCap,
  custom: ListChecks,
};

export function PurposeStep({
  value,
  onContinue,
}: {
  value: PurposeSelection;
  onContinue: (selection: PurposeSelection) => void;
}) {
  const [selected, setSelected] = React.useState<PurposeId>(value.id);
  const [custom, setCustom] = React.useState<CustomQuestionnaire>(
    value.custom ?? DEFAULT_CUSTOM_QUESTIONNAIRE,
  );
  const [error, setError] = React.useState<string | null>(null);

  function patch(next: Partial<CustomQuestionnaire>): void {
    setCustom((c) => ({ ...c, ...next }));
  }

  function handleContinue(): void {
    // Custom: every field is optional — empty ones show as "No goal provided"
    // in the results instead of being invented.
    if (selected === "custom") {
      setError(null);
      onContinue({ id: "custom", custom });
      return;
    }
    setError(null);
    onContinue({ id: selected, custom: null });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-5"
    >
      {/* Mane asks the workflow question */}
      <div className="flex items-start gap-3 rounded-none border border-iris-700/20 bg-iris-100/70 p-4">
        <Mane attire="presenter" size={96} />
        <SpeechBubble
          className="mt-2 flex-1"
          text="What's the purpose of your talk? Pick the closest one. I'll build the scoring around it."
        />
      </div>

      {/* Purpose option cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {PURPOSE_OPTIONS.map((option) => {
          const Icon = OPTION_ICON[option.id];
          const active = selected === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => setSelected(option.id)}
              className={cn(
                "flex flex-col gap-2 rounded-none border p-4 text-left transition-colors",
                active
                  ? "border-iris-600 bg-iris-50 shadow-[0_8px_20px_rgba(139,90,60,0.4)] ring-2 ring-iris-500/40"
                  : "border-iris-700/20 bg-card hover:border-iris-700/45",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
                  <Icon className="size-4 text-iris-700" />
                  {option.id === "custom" ? "Other (Custom)" : option.label}
                </span>
                {active && (
                  <Badge className="border-iris-600/50 bg-iris-100 text-iris-800">
                    Selected
                  </Badge>
                )}
              </span>
              <span className="text-sm text-ink-900/65">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>

      {/* Other → custom questionnaire */}
      <AnimatePresence initial={false}>
        {selected === "custom" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Card className="border-iris-700/25">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-base">
                  <ListChecks className="size-4 text-iris-700" />
                  A few questions for you
                </CardTitle>
                <CardDescription>
                  Three quick prompts. They flow into the rubric, the live room,
                  and the contextual feedback after your run.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {/* Numbered quick-questionnaire */}
                <ol className="flex flex-col gap-4">
                  <li className="flex flex-col gap-1.5">
                    <label
                      htmlFor="custom-objective"
                      className="text-sm font-medium text-ink-900"
                    >
                      1. Tell Mane about the objective of the presentation
                    </label>
                    <Input
                      id="custom-objective"
                      value={custom.objectiveText}
                      placeholder="What should this talk achieve?"
                      onChange={(e) => patch({ objectiveText: e.target.value })}
                    />
                  </li>
                  <li className="flex flex-col gap-1.5">
                    <label
                      htmlFor="custom-takeaway"
                      className="text-sm font-medium text-ink-900"
                    >
                      2. Key takeaways
                    </label>
                    <Input
                      id="custom-takeaway"
                      value={custom.keyTakeaway}
                      placeholder="The one thing the audience should remember"
                      onChange={(e) => patch({ keyTakeaway: e.target.value })}
                    />
                  </li>
                  <li className="flex flex-col gap-1.5">
                    <label
                      htmlFor="custom-audience"
                      className="text-sm font-medium text-ink-900"
                    >
                      3. Audience
                    </label>
                    <Input
                      id="custom-audience"
                      value={custom.audience.type}
                      placeholder="Who are you talking to?"
                      onChange={(e) =>
                        patch({
                          audience: { ...custom.audience, type: e.target.value },
                        })
                      }
                    />
                  </li>
                </ol>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
      {error && (
        <p className="rounded-none border border-iris-700/30 bg-iris-100 px-4 py-3 text-sm text-iris-900">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button size="lg" onClick={handleContinue}>
          Looks good, next
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </motion.div>
  );
}