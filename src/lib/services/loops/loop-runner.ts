import type { LoopEvalGate, LoopReceipt, LoopSpec } from "@/lib/types/loops";

/**
 * Loop runner.
 *
 * Turns an autonomous worker's text output into concrete {@link LoopReceipt}s so
 * that loop eval gates can actually be satisfied (or honestly blocked) instead of
 * staying perpetually pending metadata. This is the missing executor between
 * `verifier-registry.ts` (which only DEFINES gates) and `loop-engine.ts`
 * (`applyLoopReceipts` / `loopCompletionBlock`, which CONSUME receipts).
 *
 * Design rules:
 *  - PURE + dependency-injected. No `child_process`/`fs`/`fetch` at module scope,
 *    so it stays safe to import from client bundles (loops/index.ts is). The
 *    server passes in a `judge` (independent reviewer) and `runCommand` (shell)
 *    when it has them; without them, gates that need real execution stay
 *    unsatisfied rather than being faked.
 *  - FAIL CLOSED. A passing receipt is only ever emitted when there is real
 *    evidence: a worker self-report, a detected artifact, an accepting judge, a
 *    zero-exit command, or substantive evidence text. Never fabricate a pass.
 */

export type LoopJudgeVerdict = {
  accepted: boolean;
  summary?: string;
  evidence?: string[];
};

export type LoopGateJudge = (input: {
  gate: LoopEvalGate;
  output: string;
  goal: string;
  successCriteria: string[];
}) => Promise<LoopJudgeVerdict>;

export type LoopGateCommandResult = {
  ok: boolean;
  exitCode?: number;
  output?: string;
};

export type LoopGateCommandRunner = (input: {
  gate: LoopEvalGate;
  command: string;
}) => Promise<LoopGateCommandResult>;

export type RunLoopGatesInput = {
  loop?: LoopSpec;
  /** Raw text the worker returned for the task. */
  output: string;
  /** Optional pre-detected artifact references (paths/urls); falls back to scanning `output`. */
  artifacts?: string[];
  /** Independent reviewer for `agent`/judge gates. Omit if no judge is reachable. */
  judge?: LoopGateJudge;
  /** Shell executor for `command` gates whose workspace is reachable here. Omit for remote work. */
  runCommand?: LoopGateCommandRunner;
  now?: number;
};

export type RunLoopGatesResult = {
  receipts: LoopReceipt[];
  /** Required gates that still have no passing receipt after this run. */
  unsatisfiedRequiredGateIds: string[];
};

const MIN_EVIDENCE_CHARS = 40;

export async function runLoopGates(input: RunLoopGatesInput): Promise<RunLoopGatesResult> {
  const gates = input.loop?.evalGates ?? [];
  const output = String(input.output ?? "");
  const now = input.now ?? Date.now();
  if (!gates.length) return { receipts: [], unsatisfiedRequiredGateIds: [] };

  const selfReport = parseLoopSelfReport(output);
  const artifacts = input.artifacts?.length ? input.artifacts : detectArtifacts(output);
  const goal = input.loop?.goal ?? "";
  const successCriteria = input.loop?.successCriteria ?? [];
  const evidenceRequired = input.loop?.evidenceRequired ?? [];

  const receipts: LoopReceipt[] = [];
  const usedReports = new Set<LoopSelfReportEntry>();
  for (const gate of gates) {
    // Pre-phase human approval is never machine-satisfiable; leave it pending.
    if (gate.kind === "human") continue;

    // An `agent:judge` gate is INDEPENDENT by definition — the builder must not get to
    // satisfy (or skip) its own judge via a self-report. Always route it to the judge.
    if (gate.kind !== "agent") {
      const reported = matchSelfReport(selfReport, gate, usedReports);
      if (reported) {
        usedReports.add(reported); // one self-report entry can satisfy at most one gate.
        receipts.push(receiptFor(gate, reported.status, reported.summary ?? `Worker reported ${gate.title} as ${reported.status}.`, reported.evidence, "self-report", now));
        continue;
      }
    }

    // Command gates are identified by carrying a shell command, NOT by `kind` —
    // the registry tags command:test/command:playwright as kind "test", yet they
    // still run a command. (verifier-registry.ts)
    const command = typeof gate.command === "string" ? gate.command.trim() : "";
    if (command) {
      if (input.runCommand) {
        const run = await input.runCommand({ gate, command }).catch((error): LoopGateCommandResult => ({
          ok: false,
          exitCode: undefined,
          output: error instanceof Error ? error.message : String(error),
        }));
        const evidence = [command, run.output ? truncate(run.output, 600) : `exit ${run.exitCode ?? "?"}`].filter(Boolean);
        receipts.push(receiptFor(gate, run.ok ? "passed" : "failed", run.ok ? `\`${command}\` passed.` : `\`${command}\` failed (exit ${run.exitCode ?? "?"}).`, evidence, "command", now));
      }
      // No runner here (remote workspace) and no self-report → leave pending; required gates fail closed.
      continue;
    }

    if (gate.kind === "artifact") {
      if (artifacts.length) {
        receipts.push(receiptFor(gate, "passed", `Durable artifact detected: ${artifacts[0]}`, artifacts.slice(0, 6), "artifact", now));
      } else {
        receipts.push(receiptFor(gate, "failed", "No durable artifact (path or URL) was found in the worker output.", [], "artifact", now));
      }
      continue;
    }

    if (gate.kind === "agent") {
      if (input.judge) {
        const verdict = await input.judge({ gate, output, goal, successCriteria }).catch((error) => ({
          accepted: false,
          summary: error instanceof Error ? error.message : String(error),
        }) as LoopJudgeVerdict);
        receipts.push(receiptFor(gate, verdict.accepted ? "passed" : "failed", verdict.summary || (verdict.accepted ? "Independent judge accepted the result." : "Independent judge rejected the result."), verdict.evidence ?? [], "judge", now));
      }
      // No judge reachable → leave pending; required judge gates fail closed.
      continue;
    }

    if (gate.kind === "receipt") {
      // Governance/policy receipts must not be auto-passed from raw text: a spend or
      // approval claim needs an explicit self-report or judge. Without one, stay pending.
      if (gate.verifier === "governance:policy") continue;
      const matchedEvidence = evidenceRequired.filter((hint) => output.toLowerCase().includes(hint.toLowerCase().slice(0, 24)));
      if (output.trim().length >= MIN_EVIDENCE_CHARS) {
        const evidence = [truncate(output.trim(), 600), ...matchedEvidence].filter(Boolean);
        receipts.push(receiptFor(gate, "passed", "Worker output recorded as evidence.", evidence, "evidence", now));
      } else {
        receipts.push(receiptFor(gate, "failed", "Worker output was too thin to count as an evidence receipt.", [], "evidence", now));
      }
      continue;
    }

    // Unknown/other test-kind gates (e.g. evo:score) need a real benchmark; leave pending.
  }

  const passedGateIds = new Set(receipts.filter((r) => r.status === "passed" && r.gateId).map((r) => r.gateId));
  const unsatisfiedRequiredGateIds = gates
    .filter((gate) => gate.required && gate.status !== "passed" && !passedGateIds.has(gate.id))
    .map((gate) => gate.id);

  return { receipts, unsatisfiedRequiredGateIds };
}

/**
 * Renders the loop's contract into a worker-facing instruction block so the agent
 * knows what evidence it must return for each gate, and asks it to emit a parseable
 * `loop-receipts` JSON array. Empty string when there is nothing to gate on.
 */
export function loopContractForPrompt(loop?: LoopSpec): string {
  if (!loop) return "";
  const gates = (loop.evalGates ?? []).filter((gate) => gate.kind !== "human");
  if (!gates.length && !(loop.evidenceRequired?.length)) return "";
  const lines: string[] = [];
  lines.push("This task is governed by a loop contract. To COMPLETE it (not just describe it), you must satisfy these eval gates:");
  for (const gate of gates) {
    lines.push(`- [${gate.id}] ${gate.title}${gate.required ? " (required)" : " (optional)"} — ${gateEvidenceHint(gate)}`);
  }
  if (loop.successCriteria?.length) {
    lines.push("", "Success criteria:");
    for (const criterion of loop.successCriteria) lines.push(`- ${criterion}`);
  }
  if (loop.evidenceRequired?.length) {
    lines.push("", "Evidence required:");
    for (const evidence of loop.evidenceRequired) lines.push(`- ${evidence}`);
  }
  lines.push(
    "",
    "Always end with a plain-text final answer (the deliverable + your evidence). Then append a fenced block exactly like this so your verification is recorded (one entry per gate you verified; status is passed|failed|skipped):",
    "```loop-receipts",
    '[{"gateId":"<gate id above>","status":"passed","summary":"what you verified","evidence":["command output, file path, url, or quote"]}]',
    // Do NOT push yourself into a long agentic tool loop you cannot finish — that is the
    // signature of the empty / "no final response" failure that strands these tasks.
    "```",
    "If you can quickly run a command/lint/typecheck/test gate in THIS chat, paste the real output as evidence. If you cannot run it here, mark that gate \"skipped\" with a one-line reason and move on — do NOT stall in a long tool loop. Never claim a command passed without real output.",
  );
  return lines.join("\n");
}

function gateEvidenceHint(gate: LoopEvalGate): string {
  if (gate.kind === "command") return `if quick, run \`${gate.command ?? "the gate command"}\` and report exit status + output; otherwise mark skipped with a reason`;
  if (gate.kind === "artifact") return "include a durable artifact path or URL in your output";
  if (gate.kind === "agent") return "an independent judge will review your output against the success criteria";
  if (gate.verifier === "governance:policy") return "confirm spend/approvals/external actions stayed inside policy";
  return "include concrete evidence (what changed and how you verified it)";
}

export type LoopSelfReportEntry = {
  gateId?: string;
  verifier?: string;
  title?: string;
  status: "passed" | "failed" | "skipped";
  summary?: string;
  evidence: string[];
};

/** Extracts worker-emitted gate receipts from a ```loop-receipts (or JSON) fenced block. */
export function parseLoopSelfReport(output: string): LoopSelfReportEntry[] {
  const text = String(output ?? "");
  const candidates: string[] = [];
  const fenced = text.matchAll(/```(?:loop-receipts|json)?\s*\n([\s\S]*?)```/gi);
  for (const match of fenced) candidates.push(match[1]);
  // Also tolerate a bare top-level JSON array of receipt-shaped objects.
  const bare = text.match(/\[\s*\{[\s\S]*"status"[\s\S]*\}\s*\]/);
  if (bare) candidates.push(bare[0]);

  for (const candidate of candidates) {
    const parsed = tryParseReceiptArray(candidate);
    if (parsed.length) return parsed;
  }
  return [];
}

function tryParseReceiptArray(raw: string): LoopSelfReportEntry[] {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    return [];
  }
  const array = Array.isArray(value) ? value : Array.isArray((value as { receipts?: unknown })?.receipts) ? (value as { receipts: unknown[] }).receipts : null;
  if (!array) return [];
  const entries: LoopSelfReportEntry[] = [];
  for (const item of array) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const status = String(record.status ?? "").toLowerCase();
    if (status !== "passed" && status !== "failed" && status !== "skipped") continue;
    entries.push({
      gateId: cleanString(record.gateId),
      verifier: cleanString(record.verifier),
      title: cleanString(record.title ?? record.gate),
      status: status as LoopSelfReportEntry["status"],
      summary: cleanString(record.summary ?? record.note),
      evidence: toStringArray(record.evidence),
    });
  }
  return entries;
}

function matchSelfReport(report: LoopSelfReportEntry[], gate: LoopEvalGate, used: Set<LoopSelfReportEntry>): LoopSelfReportEntry | undefined {
  return (
    report.find((entry) => !used.has(entry) && entry.gateId && entry.gateId === gate.id) ??
    report.find((entry) => !used.has(entry) && entry.verifier && gate.verifier && entry.verifier === gate.verifier) ??
    report.find((entry) => !used.has(entry) && entry.title && titleMatches(entry.title, gate))
  );
}

function titleMatches(reportTitle: string, gate: LoopEvalGate): boolean {
  const left = reportTitle.toLowerCase().trim();
  return left === gate.title.toLowerCase().trim() || (gate.verifier ? left === gate.verifier.toLowerCase() : false);
}

/** Detects durable artifact references (file paths / URLs) in free text. */
export function detectArtifacts(text: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:file:\/\/\/[^\s"'<>]+|https?:\/\/[^\s"'<>]+|\/(?:Users|Volumes|tmp|var|private|home|opt)\/[^\s"'<>]+)/gi;
  for (const match of String(text ?? "").matchAll(pattern)) found.add(match[0].replace(/[),.;]+$/, ""));
  return [...found].slice(0, 12);
}

function receiptFor(
  gate: LoopEvalGate,
  status: LoopReceipt["status"],
  summary: string,
  evidence: string[],
  source: string,
  now: number,
): LoopReceipt {
  return {
    id: `lr_${gate.id}`,
    gateId: gate.id,
    status,
    summary,
    evidence: evidence.filter(Boolean).slice(0, 8),
    verifier: gate.verifier,
    metadata: { source },
    createdAt: now,
  };
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean).slice(0, 8);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}
