import type { Run, XThread } from "./sim-data";

export type SimulationPublishResult = { ok: true } | { ok: false; error: string };

export function simulationPublishBlocker(
  run: Run,
  thread: XThread | null,
  hasPublisher: boolean,
): string | null {
  if (run.template !== "x-thread") return "Only X-thread simulations can be published.";
  if (!hasPublisher) return "Publishing is not connected for this simulation.";
  if (run.state === "live") return "Wait for the simulation to finish before publishing.";
  if (run.state === "failed") return "This simulation failed and cannot be published.";
  if (run.agents < 1) return "No author bee produced this thread.";
  if (!thread?.tweets.some((tweet) => tweet.text.trim().length > 0)) {
    return "No X posts were generated for this run.";
  }
  return null;
}
