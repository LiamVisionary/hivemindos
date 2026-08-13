// Self-healing for infrastructure-stranded company tasks.
//
// A Queen Bee pickup chain that fails ONLY on infrastructure (collector down or
// restarting, machine at chat capacity, machine offline, dispatch race) says
// nothing about the work itself — but once the task's retry attempts are spent,
// `failTask` parks it in needs-human, where it stays forever unless a human
// clicks. Zero-human companies must recover from that on their own: humans are
// only for real asks (keys, decisions, approvals).
//
// This sweep runs every driver tick. For each needs-human task whose exhausted
// result is 100% infrastructure failures, it health-checks the task's target
// collector and — only when the machine is confirmed back — re-queues the task
// through the same answer rail a human would use, with a fresh attempt budget.
// Each rescue stamps a timestamped marker into the body; after
// MAX_RESCUES_PER_TASK stamps within a rolling 24h window the task stays with
// the human, so a machine that keeps dying cannot ping-pong a task forever —
// while a long saturation evening doesn't permanently spend the task's budget
// (recovery resumes the next day). Kill switch: HIVEMINDOS_COMPANY_INFRA_RESCUE=0.
import { answerHumanTask, readBoard } from "@/lib/services/kanban/local-kanban-store";
import { booleanEnv } from "@/lib/config/env";
import type { KanbanTask } from "@/lib/types/kanban";
import { isInfrastructurePickupFailure } from "./autonomous-worker";

export const INFRA_RESCUE_MARKER = "Automatic infrastructure rescue";

const DELEGATE_EXHAUSTED = /exhausted all eligible delegates/i;
const DEFAULT_MAX_RESCUES_PER_TASK = 3;
const DEFAULT_MAX_PER_SWEEP = 10;
const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;

export type InfraRescueDeps = {
  /** Injected for tests: true when the collector at `url` answers /health ok. */
  probeHealth?: (collectorUrl: string) => Promise<boolean>;
  maxRescuesPerTask?: number;
  maxPerSweep?: number;
  vaultPath?: string | null;
  kanbanFolder?: string | null;
};

export type InfraRescueResult = {
  rescued: Array<{ taskId: string; title: string }>;
  /** Infra-stranded candidates left alone (machine still down, or rescue budget spent). */
  skipped: number;
};

/** The "- <agent>: <reason>" lines under the exhausted result's "Failures:" section. */
export function exhaustedFailureLines(result: string): string[] {
  const lines: string[] = [];
  let inFailures = false;
  for (const raw of result.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^Failures:/i.test(line)) { inFailures = true; continue; }
    if (!inFailures) continue;
    if (line === "") continue;
    if (/^ACTION\s*NEEDED/i.test(line)) break;
    lines.push(line.replace(/^[-*]\s*/, ""));
  }
  return lines;
}

/**
 * True when a needs-human result is an exhausted delegate chain whose EVERY
 * failure line is infrastructure — nothing about the work itself failed.
 */
export function isInfrastructureOnlyExhaustion(result: string | undefined): boolean {
  if (!result || !DELEGATE_EXHAUSTED.test(result)) return false;
  const lines = exhaustedFailureLines(result);
  return lines.length > 0 && lines.every((line) => isInfrastructurePickupFailure(line));
}

// A claimed run whose host process died (dev-server restart/reload killed the
// in-process pickup or dispatch stream) never fails itself — the stale-claim
// reclaim sweeps it with a retryable reason until the attempt budget strands
// the card (live 2026-07-05: t_mr7nml51_xvj4a, "Reclaimed after 3824s" × 2 +
// pickup timeouts = 3/3 → needs-human). The work never ran; that is
// infrastructure. Matches transitionTaskAfterFailure's exact stranded format;
// non-infra reasons (agent-error, manual) deliberately do NOT match.
const RECLAIM_STALL_STRANDING =
  /^Reclaimed after \d+s without worker progress\. Failure reason: (?:timeout|runtime-offline|runtime-recovery|local-directory-error)\./;

// A task stranded by a SINGLE-delegate pickup failure carries a one-line result
// ("Queen Bee autonomous pickup failed for <agent>: <reason>") instead of the
// multi-delegate exhausted format above. Live 2026-07-16: 74 of WEBS's 115
// needs-human tasks had exactly this shape (57 "no final response", 17 timeout)
// and 0 matched the exhausted matcher — the rescue built for them never fired.
// The captured <reason> goes through the same shared infra vocabulary, so
// content failures (eval gates, provider-config errors) still stay with the human.
const SINGLE_PICKUP_STRANDING =
  /^(?:Queen Bee )?[Aa]utonomous pickup failed for [^:\n]+:\s*(.+)$/;

/** True when a needs-human result was stranded by infrastructure of any recorded shape. */
export function isInfraStrandedResult(result: string | undefined): boolean {
  if (!result) return false;
  const trimmed = result.trim();
  if (isInfrastructureOnlyExhaustion(result) || RECLAIM_STALL_STRANDING.test(trimmed)) return true;
  const single = SINGLE_PICKUP_STRANDING.exec(trimmed.split(/\r?\n/, 1)[0] ?? "");
  return Boolean(single && isInfrastructurePickupFailure(single[1]));
}

const RESCUE_WINDOW_MS = 24 * 60 * 60 * 1000;
// answerHumanTask writes this exact stamp header for our stampLabel.
const RESCUE_STAMP = /— Automatic rescue \(([^)]+)\) —/g;

/** Rescues within the rolling window; an unparseable stamp counts (fail toward the cap). */
function recentRescueCount(task: KanbanTask, now: number): number {
  let count = 0;
  for (const match of (task.body ?? "").matchAll(RESCUE_STAMP)) {
    const at = Date.parse(match[1]);
    if (Number.isNaN(at) || now - at <= RESCUE_WINDOW_MS) count += 1;
  }
  return count;
}

function rescueAnswer(task: KanbanTask): string {
  return [
    `${INFRA_RESCUE_MARKER}: this task was stranded by infrastructure — a delegate chain failing only on transport/capacity/offline machines or a dispatch race, or a claimed run whose host process died mid-claim (stale-claim reclaim). The work itself never ran and never failed.`,
    `The target machine's collector now answers its health check, so the task is re-queued for autonomous pickup with a fresh attempt budget.`,
    task.targetMachine?.collectorUrl ? `Verified collector: ${task.targetMachine.collectorUrl}` : null,
    `Re-attempt the task from its existing body. If pickup fails on infrastructure again, this rescue repeats automatically (up to ${DEFAULT_MAX_RESCUES_PER_TASK} times per rolling 24h); if the WORK fails, escalate with details as usual.`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

async function defaultProbeHealth(collectorUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${collectorUrl.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(DEFAULT_HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => null) as { ok?: unknown } | null;
    return body === null || body.ok !== false;
  } catch {
    return false;
  }
}

/**
 * Re-queue needs-human tasks that were stranded by infrastructure-only pickup
 * failures, when (and only when) their target collector is healthy again.
 * Returns what was rescued so the driver can log it.
 */
export async function rescueInfraStrandedTasks(deps: InfraRescueDeps = {}): Promise<InfraRescueResult> {
  const result: InfraRescueResult = { rescued: [], skipped: 0 };
  if (!booleanEnv("HIVEMINDOS_COMPANY_INFRA_RESCUE", true)) return result;
  const probeHealth = deps.probeHealth ?? defaultProbeHealth;
  const maxRescues = deps.maxRescuesPerTask ?? DEFAULT_MAX_RESCUES_PER_TASK;
  const maxPerSweep = deps.maxPerSweep ?? DEFAULT_MAX_PER_SWEEP;
  const storageOptions = { vaultPath: deps.vaultPath, kanbanFolder: deps.kanbanFolder };

  const board = await readBoard(null, storageOptions);
  const candidates = board.tasks.filter(
    (task) => task.status === "needs-human" && isInfraStrandedResult(task.result),
  );
  // One health probe per distinct collector per sweep.
  const healthByUrl = new Map<string, Promise<boolean>>();

  const now = Date.now();
  for (const task of candidates) {
    if (result.rescued.length >= maxPerSweep) { result.skipped += 1; continue; }
    if (recentRescueCount(task, now) >= maxRescues) { result.skipped += 1; continue; }
    const collectorUrl = task.targetMachine?.collectorUrl?.trim();
    if (!collectorUrl) { result.skipped += 1; continue; }
    if (!healthByUrl.has(collectorUrl)) healthByUrl.set(collectorUrl, probeHealth(collectorUrl));
    const healthy = await healthByUrl.get(collectorUrl)!.catch(() => false);
    if (!healthy) { result.skipped += 1; continue; }
    try {
      await answerHumanTask(null, task.id, {
        // Machine-written rescue, not an operator decision.
        origin: "automation",
        answer: rescueAnswer(task),
        author: "company-autonomy-driver",
        stampLabel: "Automatic rescue",
        resetAttempts: true,
      }, storageOptions);
      result.rescued.push({ taskId: task.id, title: task.title });
    } catch {
      // Another actor moved the task between read and answer — leave it to them.
      result.skipped += 1;
    }
  }
  return result;
}
