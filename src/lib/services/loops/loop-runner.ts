import type { LoopContractSnapshot, LoopEvaluationRubric, LoopEvalGate, LoopReceipt, LoopSpec } from "@/lib/types/loops";
// Reserved/mock/non-routable URL detection is shared with the deliverable UI and
// the kanban extractor via ONE pure module (single source of truth). This module
// is the canonical (strictest) behavior; re-exported below so loops/index.ts keeps
// surfacing `isReservedOrMockUrl` and stays client-safe (the helper is pure).
import { isReservedOrMockUrl } from "@/lib/net/reserved-urls";
// Deliverable content acceptance — the platform-wide "is this outward deliverable
// actually good, or a placeholder skeleton?" gate. Pure + dependency-injected, so
// importing it keeps this module client-safe.
import {
  evaluateDeliverableAcceptance,
  summarizeAcceptanceViolations,
  type DeliverableContentFetcher,
} from "@/lib/services/deliverables/deliverable-acceptance";
import { evaluationOutputFingerprint } from "@/lib/services/evaluation/control-plane";

export { isReservedOrMockUrl };

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
  confidence?: number;
  axes?: Array<{ id: string; score: number; evidence?: string[] }>;
  evaluator?: { agentId?: string; model?: string; runtime?: string; independent: boolean };
};

export type LoopGateJudge = (input: {
  gate: LoopEvalGate;
  output: string;
  goal: string;
  successCriteria: string[];
  contract?: LoopContractSnapshot;
  evaluationRubric?: LoopEvaluationRubric;
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

export type LoopArtifactVerifier = (input: {
  gate: LoopEvalGate;
  artifact: string;
}) => Promise<{ ok: boolean; evidence?: string[]; error?: string }>;

export type LoopUrlProbeResult = {
  /** HTTP status if any response was received (any method). */
  status?: number;
  /** True ONLY when the host definitively does not resolve (DNS NXDOMAIN), not for transient failures. */
  dnsFailed?: boolean;
  /** Transient/network reason when no usable HTTP response arrived (timeout, connect reset). */
  error?: string;
};

/**
 * Probes whether a claimed-live URL actually serves a page. Injected by the server
 * (a real `fetch`); omitted in client bundles and replaced by a fake in hermetic
 * tests — the runner itself never touches the network. See `makeLiveUrlProber`.
 */
export type LoopUrlProber = (input: { url: string }) => Promise<LoopUrlProbeResult>;

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
  /** Trusted existence/reachability check for artifact gates. Path-shaped text alone never passes. */
  verifyArtifact?: LoopArtifactVerifier;
  /** Liveness prober for URLs the worker CLAIMS are live. Omit → reserved/mock domains are still rejected (pure). */
  probeUrl?: LoopUrlProber;
  /** Content fetcher for the deliverable-acceptance gate. Omit → the gate is a no-op (kill-switch). */
  fetchContent?: DeliverableContentFetcher;
  now?: number;
};

export type RunLoopGatesResult = {
  receipts: LoopReceipt[];
  /** Required gates that still have no passing receipt after this run. */
  unsatisfiedRequiredGateIds: string[];
};

const MIN_EVIDENCE_CHARS = 40;

// Stable identity for the live-URL integrity receipt. The id is stable so a clean
// retry OVERWRITES a prior failure (mergeLoopReceipts keys by id) instead of the old
// failure persisting forever. The verifier tag is informational (not in the registry).
const LIVE_URL_RECEIPT_ID = "lr_live-url-integrity";
const LIVE_URL_GATE_ID = "live-url-integrity";
const LIVE_URL_VERIFIER = "integrity:live-url";
/** Cap on how many claimed-live URLs one run will verify — bounds work + network. */
const MAX_LIVE_URL_CHECKS = 6;

// Stable identity for the deliverable-acceptance integrity receipt (same overwrite-on-retry
// contract as the live-URL receipt). A failing one is a hard-fail → blocks completion.
const ACCEPTANCE_RECEIPT_ID = "lr_deliverable-acceptance";
const ACCEPTANCE_GATE_ID = "deliverable-acceptance";
const ACCEPTANCE_VERIFIER = "integrity:deliverable-acceptance";

// The integrity receipts only the SERVER's in-process gate run (runLoopGates) may
// legitimately produce. A client — the dashboard, or an agent completing a task
// through the /api/kanban HTTP route or MCP — must not be able to POST a `passed`
// receipt carrying one of these identities to overwrite a stored hard-fail and
// self-complete a task the gate parked to needs-human. The worker completes
// in-process (not via the HTTP route), so stripping these at the route boundary
// closes the forge without touching the legitimate server path.
const PROTECTED_INTEGRITY_RECEIPT_IDS = new Set<string>([LIVE_URL_RECEIPT_ID, ACCEPTANCE_RECEIPT_ID]);
const PROTECTED_INTEGRITY_GATE_IDS = new Set<string>([LIVE_URL_GATE_ID, ACCEPTANCE_GATE_ID]);
const PROTECTED_INTEGRITY_VERIFIERS = new Set<string>([LIVE_URL_VERIFIER, ACCEPTANCE_VERIFIER]);

export function isProtectedIntegrityReceipt(
  receipt: { id?: unknown; gateId?: unknown; verifier?: unknown } | null | undefined,
): boolean {
  if (!receipt || typeof receipt !== "object") return false;
  const id = typeof receipt.id === "string" ? receipt.id : "";
  const gateId = typeof receipt.gateId === "string" ? receipt.gateId : "";
  const verifier = typeof receipt.verifier === "string" ? receipt.verifier : "";
  return (
    PROTECTED_INTEGRITY_RECEIPT_IDS.has(id) ||
    PROTECTED_INTEGRITY_GATE_IDS.has(gateId) ||
    PROTECTED_INTEGRITY_VERIFIERS.has(verifier)
  );
}

/** Drop any client-supplied receipt that claims a server-only integrity identity. */
export function stripProtectedIntegrityReceipts<T extends { id?: unknown; gateId?: unknown; verifier?: unknown }>(
  receipts: T[] | undefined | null,
): T[] {
  if (!Array.isArray(receipts)) return [];
  return receipts.filter((receipt) => !isProtectedIntegrityReceipt(receipt));
}

export async function runLoopGates(input: RunLoopGatesInput): Promise<RunLoopGatesResult> {
  const gates = input.loop?.evalGates ?? [];
  const output = String(input.output ?? "");
  const now = input.now ?? Date.now();
  // NB: do NOT early-return on an empty gate list — the live-URL integrity check below
  // runs on the output regardless of gates, so a task with no (or only optional) gates
  // can still be blocked for claiming a dead/fabricated live URL. The gate loop below is
  // a no-op when there are no gates.

  const selfReport = parseLoopSelfReport(output);
  const artifacts = input.artifacts?.length ? input.artifacts : detectArtifacts(output);
  // A reserved/example/mock URL must NOT count as a durable artifact — a placeholder
  // link is worse than no link (e.g. `https://demo.…example/paid?session_id=mock_…`).
  const routableArtifacts = artifacts.filter((item) => !/^https?:\/\//i.test(item) || !isReservedOrMockUrl(item));
  const goal = input.loop?.goal ?? "";
  const successCriteria = input.loop?.successCriteria ?? [];
  const evidenceRequired = input.loop?.evidenceRequired ?? [];

  // ── Pass 1 (sequential, gate order): self-report resolution ────────────────
  // Self-report matching consumes the shared usedReports set in GATE ORDER — one
  // report entry satisfies at most one gate and earlier gates have priority — so
  // this pass must stay sequential. Synchronous receipt-kind gates resolve here
  // too. Gates needing an independent evaluation (command run, artifact
  // probe/stat, judge chat) are deferred as thunks for the concurrent pass 2.
  const usedReports = new Set<LoopSelfReportEntry>();
  const gateReceipts: Array<LoopReceipt | undefined> = new Array(gates.length).fill(undefined);
  const deferred: Array<{ index: number; evaluate: () => Promise<LoopReceipt | undefined> }> = [];
  gates.forEach((gate, index) => {
    // Pre-phase human approval is never machine-satisfiable; leave it pending.
    if (gate.kind === "human") return;

    // An `agent:judge` gate is INDEPENDENT by definition — the builder must not get to
    // satisfy (or skip) its own judge via a self-report. Always route it to the judge.
    if (!isServerAuthoritativeGate(gate)) {
      const reported = matchSelfReport(selfReport, gate, usedReports);
      if (reported) {
        usedReports.add(reported); // one self-report entry can satisfy at most one gate.
        gateReceipts[index] = receiptFor(gate, reported.status, reported.summary ?? `Worker reported ${gate.title} as ${reported.status}.`, reported.evidence, "self-report", now);
        return;
      }
    }

    // Command gates are identified by carrying a shell command, NOT by `kind` —
    // the registry tags command:test/command:playwright as kind "test", yet they
    // still run a command. (verifier-registry.ts)
    const command = typeof gate.command === "string" ? gate.command.trim() : "";
    if (command) {
      const runCommand = input.runCommand;
      if (runCommand) {
        deferred.push({
          index,
          evaluate: async () => {
            const run = await runCommand({ gate, command }).catch((error): LoopGateCommandResult => ({
              ok: false,
              exitCode: undefined,
              output: error instanceof Error ? error.message : String(error),
            }));
            const evidence = [command, run.output ? truncate(run.output, 600) : `exit ${run.exitCode ?? "?"}`].filter(Boolean);
            return receiptFor(gate, run.ok ? "passed" : "failed", run.ok ? `\`${command}\` passed.` : `\`${command}\` failed (exit ${run.exitCode ?? "?"}).`, evidence, "command", now);
          },
        });
      }
      // No runner here (remote workspace) and no self-report → leave pending; required gates fail closed.
      return;
    }

    if (gate.kind === "artifact") {
      if (!routableArtifacts.length) {
        gateReceipts[index] = receiptFor(gate, "failed", "No durable artifact (real path or routable URL) was found in the worker output.", [], "artifact", now);
        return;
      }
      deferred.push({
        index,
        evaluate: async () => {
          const verifiedEvidence: string[] = [];
          let verifiedArtifact: string | undefined;
          for (const artifact of routableArtifacts) {
            let verification: { ok: boolean; evidence?: string[]; error?: string } | undefined;
            if (/^https?:\/\//i.test(artifact) && input.probeUrl) {
              const probe = await input.probeUrl({ url: artifact }).catch((error): LoopUrlProbeResult => ({ error: error instanceof Error ? error.message : String(error) }));
              verification = {
                ok: typeof probe.status === "number" && probe.status >= 200 && probe.status < 400,
                evidence: [`${artifact} — HTTP ${probe.status ?? "unreachable"}`],
                error: probe.error,
              };
            } else if (input.verifyArtifact) {
              verification = await input.verifyArtifact({ gate, artifact }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
            }
            if (verification?.ok) {
              verifiedArtifact = artifact;
              verifiedEvidence.push(...(verification.evidence ?? []));
              break;
            }
          }
          if (verifiedArtifact) {
            return receiptFor(gate, "passed", `Verified durable artifact: ${verifiedArtifact}`, [verifiedArtifact, ...verifiedEvidence], "artifact", now);
          }
          // No trusted verifier or no verified candidate: leave the required gate pending.
          return undefined;
        },
      });
      return;
    }

    if (gate.kind === "agent") {
      const judge = input.judge;
      if (judge) {
        deferred.push({
          index,
          evaluate: async () => {
            const verdict = await judge({ gate, output, goal, successCriteria, contract: input.loop?.contract, evaluationRubric: input.loop?.evaluationRubric }).catch((error) => ({
              accepted: false,
              summary: error instanceof Error ? error.message : String(error),
            }) as LoopJudgeVerdict);
            const accepted = judgeVerdictPasses(verdict, input.loop?.evaluationRubric);
            return receiptFor(
              gate,
              accepted ? "passed" : "failed",
              verdict.summary || (accepted ? "Independent judge accepted the result." : "Independent judge or rubric rejected the result."),
              verdict.evidence ?? [],
              "judge",
              now,
              {
                confidence: verdict.confidence,
                axes: verdict.axes,
                evaluator: verdict.evaluator,
              },
            );
          },
        });
      }
      // No judge reachable → leave pending; required judge gates fail closed.
      return;
    }

    if (gate.kind === "receipt") {
      // Governance/policy receipts must not be auto-passed from raw text: a spend or
      // approval claim needs an explicit self-report or judge. Without one, stay pending.
      if (gate.verifier === "governance:policy") return;
      // When the worker emitted an explicit receipt set, absence is meaningful. Do not
      // let the JSON/fence itself become generic prose evidence for every unmatched gate.
      if (selfReport.length) return;
      const matchedEvidence = evidenceRequired.filter((hint) => output.toLowerCase().includes(hint.toLowerCase().slice(0, 24)));
      if (output.trim().length >= MIN_EVIDENCE_CHARS) {
        const evidence = [truncate(output.trim(), 600), ...matchedEvidence].filter(Boolean);
        gateReceipts[index] = receiptFor(gate, "passed", "Worker output recorded as evidence.", evidence, "evidence", now);
      } else {
        gateReceipts[index] = receiptFor(gate, "failed", "Worker output was too thin to count as an evidence receipt.", [], "evidence", now);
      }
      return;
    }

    // Unknown/other test-kind gates (e.g. evo:score) need a real benchmark; leave pending.
  });

  // ── Pass 2 (concurrent): independent evaluations + integrity checks ────────
  // Command runs, artifact probes, and judge chats are independent of each other
  // and of the two output-level integrity checks, so they run concurrently — a
  // slow judge chat no longer serializes behind a slow test run. Receipts are
  // reassembled in original gate order below.
  const [integrityReceipts] = await Promise.all([
    runIntegrityGates({ output, probeUrl: input.probeUrl, fetchContent: input.fetchContent, now }),
    Promise.all(deferred.map(async ({ index, evaluate }) => {
      gateReceipts[index] = await evaluate();
    })),
  ]);

  const outputFingerprint = evaluationOutputFingerprint(output);
  const boundReceipts: LoopReceipt[] = [
    ...gateReceipts
      .filter((receipt): receipt is LoopReceipt => Boolean(receipt))
      .map((receipt) => ({
        ...receipt,
        metadata: {
          ...receipt.metadata,
          authority: "server",
          outputFingerprint,
        },
      })),
    // runIntegrityGates already binds authority + fingerprint for this output.
    ...integrityReceipts,
  ];
  const passedGateIds = new Set(boundReceipts.filter((r) => r.status === "passed" && r.gateId).map((r) => r.gateId));
  const unsatisfiedRequiredGateIds = gates
    .filter((gate) => gate.required && gate.status !== "passed" && !passedGateIds.has(gate.id))
    .map((gate) => gate.id);

  return { receipts: boundReceipts, unsatisfiedRequiredGateIds };
}

export type RunIntegrityGatesInput = {
  /** Raw text whose live-URL / deliverable claims are verified. */
  output: string;
  /** Liveness prober for claimed-live URLs. Omit → reserved/mock domains are still rejected (pure). */
  probeUrl?: LoopUrlProber;
  /** Content fetcher for the deliverable-acceptance gate. Omit → the gate is a no-op (kill-switch). */
  fetchContent?: DeliverableContentFetcher;
  now?: number;
};

/**
 * Runs ONLY the two output-level integrity checks and returns their stable-id
 * receipts, already bound to server authority + this output's fingerprint (the
 * exact shape `runLoopGates` emits). Shared by BOTH completion enforcement
 * points — the in-process gate run (`runLoopGates`, autonomous worker) and the
 * untrusted HTTP/MCP completion path (POST /api/kanban "complete" →
 * `completeTask`) — so an agent completing over HTTP gets the same honest
 * verification as an in-process pickup. Empty result → nothing was claimed.
 *
 * - Live-URL integrity: a deliverable/outcome that CLAIMS a live URL must not
 *   pass with a dead or fabricated link. Emits a stable-id receipt so a clean
 *   retry overwrites a prior failure. A violation is a HARD fail — it blocks
 *   completion (→ needs-human) regardless of whether any loop gate is
 *   "required" (see loopCompletionBlock). Only affirmatively-false evidence
 *   blocks: a missing URL never does. Reserved/mock/non-public domains are
 *   caught with NO network; a dead real URL (404/410/NXDOMAIN) needs the
 *   injected prober.
 * - Deliverable content acceptance: a claimed outward deliverable (preview
 *   site, landing/offer page) must not pass as a PLACEHOLDER/wireframe
 *   skeleton — a real bug (2026-07-07) shipped a restaurant preview to a live
 *   prospect with fake "menu" items and no prices. Fetches the customer-facing
 *   URL(s) and runs the typed acceptance contract for the kind. An affirmative
 *   rejection is a HARD fail, exactly like a dead live URL. Unfetchable/
 *   ambiguous content never blocks, and a missing fetcher (the kill-switch)
 *   makes it a no-op.
 */
export async function runIntegrityGates(input: RunIntegrityGatesInput): Promise<LoopReceipt[]> {
  const output = String(input.output ?? "");
  const now = input.now ?? Date.now();
  const [liveUrl, acceptance] = await Promise.all([
    evaluateLiveUrlClaims(output, input.probeUrl),
    evaluateDeliverableAcceptance({ output, fetchContent: input.fetchContent }),
  ]);

  const receipts: LoopReceipt[] = [];
  if (liveUrl.checked.length) {
    const failed = liveUrl.violations.length > 0;
    receipts.push({
      id: LIVE_URL_RECEIPT_ID,
      gateId: LIVE_URL_GATE_ID,
      status: failed ? "failed" : "passed",
      summary: failed
        ? `Claimed live URL failed verification: ${truncate(liveUrl.violations.map((v) => `${v.url} — ${v.reason}`).join("; "), 300)}`
        : `Verified ${liveUrl.checked.length} claimed live URL(s) as reachable.`,
      evidence: (failed ? liveUrl.violations.map((v) => `${v.url} — ${v.reason}`) : liveUrl.checked).filter(Boolean).slice(0, 8),
      verifier: LIVE_URL_VERIFIER,
      metadata: failed ? { source: "live-url", hardFail: true } : { source: "live-url" },
      createdAt: now,
    });
  }

  if (acceptance.checked.length) {
    const failed = acceptance.violations.length > 0;
    receipts.push({
      id: ACCEPTANCE_RECEIPT_ID,
      gateId: ACCEPTANCE_GATE_ID,
      status: failed ? "failed" : "passed",
      summary: failed
        ? `Deliverable failed acceptance: ${truncate(summarizeAcceptanceViolations(acceptance.violations), 300)}`
        : `Verified ${acceptance.checked.length} deliverable(s) meet their acceptance contract.`,
      evidence: (failed
        ? acceptance.violations.map((v) => `${v.url} — ${v.verdict.violations.map((x) => x.code).join(", ")}`)
        : acceptance.checked.map((c) => `${c.url} — ${c.verdict.signals.join(", ") || "acceptable"}`)
      ).filter(Boolean).slice(0, 8),
      verifier: ACCEPTANCE_VERIFIER,
      metadata: failed ? { source: "deliverable-acceptance", hardFail: true } : { source: "deliverable-acceptance" },
      createdAt: now,
    });
  }

  if (!receipts.length) return receipts;
  const outputFingerprint = evaluationOutputFingerprint(output);
  return receipts.map((receipt) => ({
    ...receipt,
    metadata: {
      ...receipt.metadata,
      authority: "server",
      outputFingerprint,
    },
  }));
}

function isServerAuthoritativeGate(gate: LoopEvalGate): boolean {
  return gate.kind === "agent"
    || gate.kind === "artifact"
    || Boolean(gate.command?.trim())
    || gate.verifier === "governance:policy"
    || Boolean(gate.verifier?.startsWith("evo:"));
}

function judgeVerdictPasses(verdict: LoopJudgeVerdict, rubric?: LoopEvaluationRubric): boolean {
  if (!verdict.accepted || verdict.evaluator?.independent !== true) return false;
  if (!rubric) return true;
  const axes = new Map((verdict.axes ?? []).map((axis) => [axis.id, Math.max(0, Math.min(1, axis.score))]));
  if (!rubric.axes.every((axis) => axes.has(axis.id))) return false;
  if (rubric.axes.some((axis) => axis.scoreFloor !== undefined && (axes.get(axis.id) ?? 0) < axis.scoreFloor)) return false;
  const totalWeight = rubric.axes.reduce((sum, axis) => sum + Math.max(0, axis.weight), 0) || 1;
  const score = rubric.axes.reduce((sum, axis) => sum + (axes.get(axis.id) ?? 0) * Math.max(0, axis.weight), 0) / totalWeight;
  return score >= rubric.passThreshold;
}

/**
 * Renders the loop's contract into a worker-facing instruction block so the agent
 * knows what evidence it must return for each gate, and asks it to emit a parseable
 * `loop-receipts` JSON array. Empty string when there is nothing to gate on.
 */
export function loopContractForPrompt(loop?: LoopSpec): string {
  if (!loop) return "";
  const gates = (loop.evalGates ?? []).filter((gate) => gate.kind !== "human");
  if (!gates.length && !(loop.evidenceRequired?.length) && !loop.contract && !loop.evaluationRubric) return "";
  const lines: string[] = [];
  lines.push("This task is governed by a loop contract. To COMPLETE it (not just describe it), satisfy the negotiated done contract and provide evidence.");
  if (loop.contract) {
    lines.push("", `Negotiated contract: ${loop.contract.title}`);
    if (loop.contract.plannerAssertions.length) {
      lines.push("Planner assertions:");
      for (const item of loop.contract.plannerAssertions) lines.push(`- ${item}`);
    }
    if (loop.contract.evaluatorPushback.length) {
      lines.push("Evaluator pushback:");
      for (const item of loop.contract.evaluatorPushback) lines.push(`- ${item}`);
    }
    if (loop.contract.agreedDone.length) {
      lines.push("Agreed done means:");
      for (const item of loop.contract.agreedDone) lines.push(`- ${item}`);
    }
    if (loop.contract.artifacts.length) {
      lines.push("Expected artifacts:");
      for (const item of loop.contract.artifacts) lines.push(`- ${item}`);
    }
  }
  if (loop.evaluationRubric) {
    lines.push("", `Evaluator rubric: ${loop.evaluationRubric.title} (scale ${loop.evaluationRubric.scale}, pass >= ${loop.evaluationRubric.passThreshold})`);
    for (const axis of loop.evaluationRubric.axes) {
      lines.push(`- ${axis.title} (${Math.round(axis.weight * 100)}%${axis.scoreFloor !== undefined ? `, floor ${axis.scoreFloor}` : ""}): ${axis.description}`);
    }
    if (loop.evaluationRubric.notes?.length) {
      lines.push("Rubric notes:");
      for (const note of loop.evaluationRubric.notes) lines.push(`- ${note}`);
    }
  }
  if (gates.length) lines.push("", "Eval gates:");
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

// ── Live-URL claim verification ──────────────────────────────────────────────
// `isReservedOrMockUrl` (reserved TLD / example.* apex-or-subdomain / non-public
// host / mock marker) is the shared, pure helper imported + re-exported at the top
// of this file (src/lib/net/reserved-urls.ts) — the single source of truth.

/** A third-party reference/docs page an agent READ, not a live deliverable it produced. */
function isReferenceDocUrl(url: string): boolean {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return host.startsWith("docs.") || /\/api-reference\/|\/rate-limit/.test(url.toLowerCase());
}

// A URL is "presented as a live deliverable" when its shape is one operators click
// expecting a live page (payment / booking / preview / a deploy host), OR the output
// uses live-claiming language anywhere. Generic across companies; reference docs excluded.
const DELIVERABLE_URL_SHAPE = /(?:\/(?:paid|checkout|pay|book|order|sign-?up)\b|\/preview\/|buy\.stripe\.com|cal\.com|calendly\.com|\.workers\.dev|\.vercel\.app|\.netlify\.app|\.pages\.dev|\.onrender\.com|\.fly\.dev|\.web\.app|\.firebaseapp\.com)/i;
const LIVE_CLAIM_LANGUAGE = /\b(?:is\s+live|now\s+live|went\s+live|go(?:es|ing)?\s+live|live\s+(?:at|url|link|site|page|payment)|deployed|published|launched|is\s+now\s+available|(?:payment|booking|checkout|preview)\s+link|you\s+can\s+(?:pay|book|purchase|sign\s?-?up|order))\b/i;

type LiveUrlViolation = { url: string; reason: string };

/**
 * Finds URLs the worker presents as live customer-facing deliverables and verifies them.
 * - reserved/mock/non-public host → violation with NO network (option b, always on);
 * - else, if it is deliverable-shaped and a prober is injected, probe it and treat ONLY a
 *   definitive not-found (404/410 or NXDOMAIN) as a violation. Timeouts, 401/403, 429, and
 *   5xx are NOT fabrication — never block on a slow or gated host (option a).
 * Empty `checked` → nothing was claimed live (the common case; emits no receipt).
 */
async function evaluateLiveUrlClaims(output: string, probeUrl?: LoopUrlProber): Promise<{ checked: string[]; violations: LiveUrlViolation[] }> {
  const claimsLive = LIVE_CLAIM_LANGUAGE.test(output);
  const candidates = detectArtifacts(output).filter((u) => /^https?:\/\//i.test(u) && !isReferenceDocUrl(u));
  const checked: string[] = [];
  const violations: LiveUrlViolation[] = [];
  const seen = new Set<string>();
  for (const url of candidates) {
    const deliverableShaped = DELIVERABLE_URL_SHAPE.test(url);
    if (!deliverableShaped && !claimsLive) continue; // not presented as a live deliverable
    const key = url.replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    if (checked.length >= MAX_LIVE_URL_CHECKS) break; // bounded N
    checked.push(url);
    if (isReservedOrMockUrl(url)) {
      violations.push({ url, reason: "reserved / example / mock / non-public host — never a real live page" });
      continue; // no network for a URL we already know is fake
    }
    if (deliverableShaped && probeUrl) {
      const result = await probeUrl({ url }).catch((error): LoopUrlProbeResult => ({ error: error instanceof Error ? error.message : String(error) }));
      if (result.status === 404 || result.status === 410) violations.push({ url, reason: `returned HTTP ${result.status} (page does not exist)` });
      else if (result.dnsFailed) violations.push({ url, reason: "domain does not resolve" });
      // else: reachable, gated, slow, or transiently down → not treated as fabrication.
    }
  }
  return { checked, violations };
}

function receiptFor(
  gate: LoopEvalGate,
  status: LoopReceipt["status"],
  summary: string,
  evidence: string[],
  source: string,
  now: number,
  metadata?: Record<string, unknown>,
): LoopReceipt {
  return {
    id: `lr_${gate.id}`,
    gateId: gate.id,
    status,
    summary,
    evidence: evidence.filter(Boolean).slice(0, 8),
    verifier: gate.verifier,
    metadata: { source, ...metadata },
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
