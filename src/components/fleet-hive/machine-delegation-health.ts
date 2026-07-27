/* machine-delegation-health.ts — the missing signal behind the "everything is
   green while every delegation fails" gap.

   Fleet cell colour is derived from collector-reported SESSION activity: an
   agent shows "working" because it has a live session, even if that session is
   wedged, and a machine is "healthy" if a single light probe succeeds. Neither
   sees the truth that lives on the Work Board — a machine that bounces every
   delegated task to needs-human (hel1-2, 2026-07-05: 6 unpinned agents, chat
   cap 1, linkd 502 `dial …:8787: connect`, all work failing while the cell
   stayed green and the watchdog reported "5 healthy").

   This joins the Work Board back onto the fleet: for each machine, how many
   needs-human tasks are attributable to it right now, and why. Pure and shape-
   minimal so the hermetic suite can exercise it without the fleet data module. */

export type MachineDelegationHealth = {
  /** needs-human tasks currently attributable to this machine. */
  blocked: number;
  /** blocked >= threshold — the cell should read as degraded, not healthy. */
  degraded: boolean;
  /** one representative failure line for the badge tooltip. */
  sampleFailure?: string;
};

export type MachineLite = { id: string; name: string; agentNames: string[] };
export type DelegationTaskLite = {
  status: string;
  assignee?: string | null;
  result?: string | null;
  lastFailureReason?: string | null;
};

/** Loose machine-name match: the failure text names the box (e.g. machine
 *  "hivemindos-ubuntu-8gb-hel1-2"), compared on alphanumerics so punctuation and
 *  case never break the join. */
function nameHit(haystack: string, machineName: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const box = norm(machineName);
  return box.length >= 4 && norm(haystack).includes(box);
}

function firstLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/**
 * Per-machine delegation health from the current board. A needs-human task is
 * attributed to a machine when its failure text names that machine, OR (fallback)
 * when its assignee is one of the machine's agents. Machine-name evidence wins so
 * a task is counted once against the box that actually failed it; assignee-only
 * attribution catches failures that don't echo the machine name.
 */
export function deriveMachineDelegationHealth(
  machines: MachineLite[],
  tasks: DelegationTaskLite[],
  opts: { degradedThreshold?: number } = {},
): Map<string, MachineDelegationHealth> {
  const threshold = Math.max(1, opts.degradedThreshold ?? 3);
  const out = new Map<string, MachineDelegationHealth>();
  for (const m of machines) out.set(m.id, { blocked: 0, degraded: false });

  const blocked = tasks.filter((t) => t.status === "needs-human");
  for (const task of blocked) {
    const failure = `${task.lastFailureReason ?? ""} ${task.result ?? ""}`.trim();
    const assignee = (task.assignee ?? "").trim().toLowerCase();

    // 1) machine named in the failure text — the box that actually rejected it.
    const named = failure ? machines.filter((m) => nameHit(failure, m.name)) : [];
    let targets = named;
    // 2) fallback: the failure didn't name a box, so credit the assignee's machine.
    if (targets.length === 0 && assignee) {
      targets = machines.filter((m) => m.agentNames.some((n) => n.trim().toLowerCase() === assignee));
    }
    for (const m of targets) {
      const entry = out.get(m.id)!;
      entry.blocked += 1;
      if (!entry.sampleFailure && failure) entry.sampleFailure = firstLine(failure);
    }
  }

  for (const entry of out.values()) entry.degraded = entry.blocked >= threshold;
  return out;
}
