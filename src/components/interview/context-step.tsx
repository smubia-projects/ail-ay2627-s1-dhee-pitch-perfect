"use client";

/**
 * Interview Coach · Step 1 — Industry & Context Input.
 * An industry dropdown (with an "Other" free-text option), role/occupation
 * title, and the open-ended context box: how the job was found,
 * commitment level, desire rating, and particulars about relevant personal
 * projects / past work experiences.
 */

import * as React from "react";
import { motion } from "framer-motion";
import { ArrowRight, Briefcase, Heart, Search, Star } from "lucide-react";

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
import { PosturePreference } from "@/components/posture-preference";
import { Mane } from "@/components/mascot/mane";
import { SpeechBubble } from "@/components/mascot/speech-bubble";
import { cn } from "@/lib/utils";
import {
  INDUSTRIES,
  type Commitment,
  type InterviewContext,
} from "@/lib/interview-manestage";

const selectClass =
  "h-9 rounded-none border border-iris-700/30 bg-card px-2.5 font-sans text-sm text-ink-900 outline-none focus:border-iris-600 focus:ring-2 focus:ring-iris-500/40";

export function ContextStep({
  value,
  onChange,
  onContinue,
}: {
  value: InterviewContext;
  onChange: (next: InterviewContext) => void;
  onContinue: () => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [customIndustry, setCustomIndustry] = React.useState(
    value.industry === "Other",
  );

  function patch(next: Partial<InterviewContext>): void {
    onChange({ ...value, ...next });
  }

  function handleContinue(): void {
    if (!value.role.trim()) {
      setError("Name the role you're interviewing for. My questions depend on it.");
      return;
    }
    if (customIndustry && !value.industryCustom.trim()) {
      setError("Type your industry, or pick one from the list.");
      return;
    }
    setError(null);
    onContinue();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-5"
    >
      {/* Mane sets up the context */}
      <div className="flex items-start gap-3 rounded-none border border-iris-700/20 bg-iris-100/70 p-4">
        <Mane attire="interview" size={96} />
        <SpeechBubble
          className="mt-2 flex-1"
          text="First, the basics. Pick your industry or type your own, name the role, and tell me how you found it. The more you share, the better my questions."
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Industry picker (dropdown + “Other” free text — #15: no wheel) */}
        <Card className="border-iris-700/25">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-base">
              <Search className="size-4 text-iris-700" />
              Industry
            </CardTitle>
            <CardDescription>
              Pick from the list, or choose &ldquo;Other&rdquo; and type it
              yourself.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="industry-pick"
                className="text-sm font-medium text-ink-900"
              >
                Your industry
              </label>
              <select
                id="industry-pick"
                className={selectClass}
                value={value.industry}
                onChange={(e) => {
                  const next = e.target.value;
                  setCustomIndustry(next === "Other");
                  patch({ industry: next });
                }}
              >
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
                <option value="Other">Other (type below)</option>
              </select>
            </div>
            {customIndustry && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="industry-custom"
                  className="text-sm font-medium text-ink-900"
                >
                  Your industry
                </label>
                <Input
                  id="industry-custom"
                  value={value.industryCustom}
                  placeholder="e.g. Creative technology studios"
                  onChange={(e) => patch({ industryCustom: e.target.value })}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Role + open-ended context box */}
        <Card className="border-iris-700/25">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Briefcase className="size-4 text-iris-700" />
              Role and context
            </CardTitle>
            <CardDescription>
              Everything here shapes your questions. I also call out your
              projects when an answer misses them.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="role-title" className="text-sm font-medium text-ink-900">
                Role / occupation title
              </label>
              <Input
                id="role-title"
                value={value.role}
                placeholder="e.g. Product Analyst (Summer Intern)"
                onChange={(e) => patch({ role: e.target.value })}
              />
            </div>

            <fieldset className="flex flex-col gap-3 rounded-none border border-iris-700/20 bg-iris-50/60 p-4">
              <legend className="px-1 font-display text-sm font-semibold text-iris-800">
                Context box
              </legend>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="how-found" className="text-sm font-medium text-ink-900">
                    How was the job found?
                  </label>
                  <Input
                    id="how-found"
                    value={value.howFound}
                    placeholder="Referral, LinkedIn post, career fair…"
                    onChange={(e) => patch({ howFound: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="commitment" className="text-sm font-medium text-ink-900">
                    Commitment level
                  </label>
                  <select
                    id="commitment"
                    className={selectClass}
                    value={value.commitment}
                    onChange={(e) =>
                      patch({ commitment: e.target.value as Commitment })
                    }
                  >
                    {(["Internship", "Part-time", "Full-time", "Contract"] as const).map(
                      (c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
                  <Heart className="size-4 text-iris-700" />
                  Desire rating
                </span>
                <span
                  role="radiogroup"
                  aria-label="Desire rating out of 5"
                  className="flex items-center gap-1"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={value.desireRating === n}
                      aria-label={`Desire ${n} of 5`}
                      onClick={() => patch({ desireRating: n })}
                      className="rounded-none p-1"
                    >
                      <Star
                        className={cn(
                          "size-5 transition-colors",
                          n <= value.desireRating
                            ? "fill-iris-500 text-iris-600"
                            : "text-ink-300",
                        )}
                      />
                    </button>
                  ))}
                </span>
                <Badge
                  variant="outline"
                  className="border-iris-600/50 bg-iris-100 text-iris-800"
                >
                  {value.desireRating}/5,{" "}
                  {["cold", "curious", "interested", "keen", "dream role"][
                    value.desireRating - 1
                  ]}
                </Badge>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="context-notes" className="text-sm font-medium text-ink-900">
                  Your projects and past work
                </label>
                <Textarea
                  id="context-notes"
                  rows={5}
                  value={value.contextNotes}
                  placeholder={
                    "e.g. Led the campus housing portal redesign (React, 2k users); internship at a fintech where I owned onboarding funnels; hackathon winner for a queue-optimization tool."
                  }
                  onChange={(e) => patch({ contextNotes: e.target.value })}
                />
                <p className="text-xs text-ink-500">
                  I&apos;ll mention these by name when your answer should have
                  included them.
                </p>
              </div>
            </fieldset>
          </CardContent>
        </Card>

        {/* Sitting vs standing (P2) */}
        <Card className="border border-iris-700/25 bg-card">
          <CardContent>
            <PosturePreference />
          </CardContent>
        </Card>
      </div>

      {error && (
        <p className="rounded-none border border-iris-700/30 bg-iris-100 px-4 py-3 text-sm text-iris-900">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button size="lg" onClick={handleContinue}>
          Generate my question set
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </motion.div>
  );
}