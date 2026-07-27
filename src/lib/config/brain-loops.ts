/**
 * The safe, read-only "second brain" loops offered as a one-click enable once
 * the fleet has a working Queen Bee. Ids match the Foundation Workflow
 * schedules seeded by scripts/seed-vault-foundation.mjs (`foundation:<slug>`),
 * which ship disabled: enabling costs scheduled model tokens, so it must stay
 * an explicit user choice rather than a silent default.
 */
export type OnboardingBrainLoop = {
  /** Shared schedule id as seeded into the vault. */
  scheduleId: string;
  /** Short user-facing loop name (also used when naming blocked loops). */
  label: string;
};

export const ONBOARDING_BRAIN_LOOPS: readonly OnboardingBrainLoop[] = [
  { scheduleId: "foundation:daily-context-generator", label: "Daily Context" },
  { scheduleId: "foundation:weekly-synthesis", label: "Weekly Synthesis" },
] as const;

export function onboardingBrainLoopLabels(): string[] {
  return ONBOARDING_BRAIN_LOOPS.map((loop) => loop.label);
}
