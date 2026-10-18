import { describe, expect, it } from "vitest";

import { scriptCoveragePct } from "@/lib/presentation";

/**
 * Script-vs-delivered coverage (P3): share of the script's distinct content
 * words that reached the transcript. Feeds the scorer's drift rule.
 */

const SCRIPT =
  "Welcome everyone to our quarterly update. Today I will share the three growth levers behind our referral program: incentives, timing and reminders. We grew signups eighteen percent last quarter, and retention improved across every cohort we touched together.";

describe("scriptCoveragePct", () => {
  it("returns null when no script was provided", () => {
    expect(scriptCoveragePct("", "anything at all")).toBeNull();
  });

  it("returns null for a script too thin to judge", () => {
    expect(scriptCoveragePct("Hello there.", "Hello there.")).toBeNull();
  });

  it("reports 100 when the transcript is the script itself", () => {
    expect(scriptCoveragePct(SCRIPT, SCRIPT)).toBe(100);
  });

  it("drops sharply when whole sections never arrive", () => {
    const delivered =
      "Welcome everyone to our quarterly update. Today I will share the three growth levers behind our referral program: incentives, timing and reminders.";
    const coverage = scriptCoveragePct(SCRIPT, delivered);
    expect(coverage).not.toBeNull();
    expect(coverage!).toBeLessThan(60);
  });

  it("counts matching content words case-insensitively", () => {
    const coverage = scriptCoveragePct(SCRIPT, SCRIPT.toUpperCase());
    expect(coverage).toBe(100);
  });
});
