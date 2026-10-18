"use client";

/**
 * Presentation Coach · Step 2 — Rubric Customization.
 * Curated system rubrics for the chosen purpose with percentage sliders for
 * weightage/emphasis, plus user-added custom criteria (e.g. a professor's
 * rubric). Weights are normalized for display and flow into the rubric.
 */

import * as React from "react";
import { motion } from "framer-motion";
import { ArrowRight, Plus, RotateCcw, SlidersHorizontal, X } from "lucide-react";

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
  PURPOSE_OPTIONS,
  RUBRIC_PRESETS,
  normalizeWeights,
  type PurposeSelection,
  type RubricCriterion,
} from "@/lib/manestage";

const GROUP_BADGE: Record<string, string> = {
  content: "border-iris-500/50 bg-iris-100 text-iris-800",
  delivery: "border-iris-600/50 bg-iris-200/70 text-iris-900",
  structure: "border-ink-300 bg-ink-100 text-ink-800",
  audience: "border-iris-400/60 bg-[#FFF6EC] text-iris-900",
  custom: "border-iris-700/60 bg-iris-700 text-[#FFFFFF]",
};

export function RubricStep({
  purpose,
  criteria,
  onChange,
  onContinue,
}: {
  purpose: PurposeSelection;
  criteria: RubricCriterion[];
  onChange: (criteria: RubricCriterion[]) => void;
  onContinue: () => void;
}) {
  const [draftLabel, setDraftLabel] = React.useState("");
  const [draftDescription, setDraftDescription] = React.useState("");
  const [draftWeight, setDraftWeight] = React.useState(15);

  const shares = React.useMemo(() => normalizeWeights(criteria), [criteria]);
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const purposeLabel =
    PURPOSE_OPTIONS.find((o) => o.id === purpose.id)?.label ?? "Presentation";

  function setWeight(id: string, weight: number): void {
    onChange(criteria.map((c) => (c.id === id ? { ...c, weight } : c)));
  }

  function addCustom(): void {
    const label = draftLabel.trim();
    if (!label) return;
    onChange([
      ...criteria,
      {
        id: `custom-${Date.now().toString(36)}`,
        label,
        description: draftDescription.trim() || "Custom criterion",
        weight: draftWeight,
        group: "custom",
        custom: true,
      },
    ]);
    setDraftLabel("");
    setDraftDescription("");
    setDraftWeight(15);
  }

  function removeCustom(id: string): void {
    onChange(criteria.filter((c) => c.id !== id));
  }

  function resetPreset(): void {
    onChange(RUBRIC_PRESETS[purpose.id].map((c) => ({ ...c })));
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-5"
    >
      {/* Mane guides the weightage step */}
      <div className="flex items-start gap-3 rounded-none border border-iris-700/20 bg-iris-100/70 p-4">
        <Mane attire="presenter" size={96} />
        <SpeechBubble
          className="mt-2 flex-1"
          text="Here's what I'll score for this talk. Slide each one to change how much it counts. Got your own criteria? Add them below."
        />
      </div>

      <Card className="border-iris-700/25">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 font-display text-base">
            <SlidersHorizontal className="size-4 text-iris-700" />
            {purposeLabel}: what counts
            <Badge
              variant="outline"
              className="ml-auto tabular-nums text-ink-700"
            >
              raw total {totalWeight}
            </Badge>
          </CardTitle>
          <CardDescription>
            Each slider sets how much that item counts. The percentages add up
          on their own. Set one to 0 and it won&apos;t count.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {shares.map((criterion) => (
            <div
              key={criterion.id}
              className={cn(
                "flex flex-col gap-2 rounded-none border p-3",
                criterion.weight === 0
                  ? "border-dashed border-ink-300/60 opacity-60"
                  : "border-iris-700/20 bg-card",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-sm font-semibold text-ink-900">
                  {criterion.label}
                </span>
                <Badge
                  variant="outline"
                  className={cn("text-[11px]", GROUP_BADGE[criterion.group])}
                >
                  {criterion.group}
                </Badge>
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-ink-900/60 tabular-nums">
                    {criterion.share}% of rubric
                  </span>
                  <span className="rounded-none bg-iris-100 px-2 py-0.5 text-sm font-bold text-iris-800 tabular-nums">
                    {criterion.weight}
                  </span>
                  {criterion.custom && (
                    <button
                      type="button"
                      aria-label={`Remove ${criterion.label}`}
                      className="rounded-none p-1 text-iris-800 hover:bg-iris-200"
                      onClick={() => removeCustom(criterion.id)}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </span>
              </div>
              <p className="text-xs text-ink-900/60">{criterion.description}</p>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={criterion.weight}
                aria-label={`${criterion.label} weight`}
                className="h-2 w-full cursor-pointer appearance-none rounded-none bg-iris-200 accent-[#8b5a3c]"
                onChange={(e) => setWeight(criterion.id, Number(e.target.value))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Add custom rubric criteria */}
      <Card className="border-dashed border-iris-700/40 bg-iris-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-base">
            <Plus className="size-4 text-iris-700" />
            Add a custom criterion
          </CardTitle>
          <CardDescription>
            Your professor&apos;s marking scheme, client requests, or
            anything I didn&apos;t list above.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="custom-criterion-label"
                className="text-sm font-medium text-ink-900"
              >
                Criterion name
              </label>
              <Input
                id="custom-criterion-label"
                value={draftLabel}
                placeholder="e.g. Figures numbered & referenced aloud"
                onChange={(e) => setDraftLabel(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="custom-criterion-desc"
                className="text-sm font-medium text-ink-900"
              >
                What &ldquo;met&rdquo; looks like
              </label>
              <Input
                id="custom-criterion-desc"
                value={draftDescription}
                placeholder="e.g. Every chart axis is named before interpretation"
                onChange={(e) => setDraftDescription(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label
              htmlFor="custom-criterion-weight"
              className="text-sm font-medium text-ink-900"
            >
              Weight
            </label>
            <input
              id="custom-criterion-weight"
              type="range"
              min={5}
              max={50}
              step={5}
              value={draftWeight}
              className="h-2 w-48 cursor-pointer appearance-none rounded-none bg-iris-200 accent-[#8b5a3c]"
              onChange={(e) => setDraftWeight(Number(e.target.value))}
            />
            <span className="rounded-none bg-iris-100 px-2 py-0.5 text-sm font-bold text-iris-800 tabular-nums">
              {draftWeight}
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={!draftLabel.trim()}
              onClick={addCustom}
            >
              <Plus className="size-4" />
              Add criterion
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={resetPreset}>
          <RotateCcw className="size-4" />
          Reset to the original list
        </Button>
        <Button size="lg" onClick={onContinue}>
          Next: add your slides
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </motion.div>
  );
}