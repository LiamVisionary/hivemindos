import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  QuantResearchAuditResult,
  QuantResearchCandidateResult,
  QuantResearchRunManifest,
  QuantResearchWorkflowGraph,
} from "@/lib/types/quant-research";

export function buildQuantResearchWorkflow(input: {
  candidateIds: string[];
}): QuantResearchWorkflowGraph {
  const candidateIds = uniqueCandidateIds(input.candidateIds);
  return {
    schemaVersion: 1,
    researchOnly: true,
    stages: [
      {
        id: "idea-generation",
        title: "Generate falsifiable hypotheses",
        mode: "parallel-map",
        roles: ["idea-generator"],
        candidateIds,
      },
      {
        id: "feature-engineering",
        title: "Compile hypotheses into typed signal specifications",
        mode: "parallel-map",
        roles: ["feature-engineer"],
        candidateIds,
      },
      {
        id: "backtesting",
        title: "Run authoritative Rust backtests",
        mode: "parallel-map",
        roles: ["backtester"],
        candidateIds,
      },
      {
        id: "independent-validation",
        title: "Run independent Python validation",
        mode: "parallel-map",
        roles: ["validator"],
        candidateIds,
      },
      {
        id: "robustness-audits",
        title: "Audit regimes and factor residuals",
        mode: "parallel-fan-in",
        roles: ["regime-auditor", "factor-decomposer"],
        candidateIds,
      },
      {
        id: "synthesis",
        title: "Promote only candidates that pass every gate",
        mode: "barrier",
        roles: [],
        candidateIds,
      },
    ],
  };
}

export async function runQuantResearchWorkflow(input: {
  runRoot: string;
  runId: string;
  candidateIds: string[];
  executeCandidate: (
    candidateId: string,
  ) => Promise<QuantResearchCandidateResult>;
  executeAudits: (
    candidate: QuantResearchCandidateResult,
  ) => Promise<QuantResearchAuditResult>;
  now?: () => Date;
}): Promise<QuantResearchRunManifest> {
  const runId = safeRunId(input.runId);
  const graph = buildQuantResearchWorkflow({ candidateIds: input.candidateIds });
  const candidateIds = graph.stages[0]?.candidateIds ?? [];
  if (!candidateIds.length) {
    throw new Error("Quant research workflow needs at least one candidate.");
  }
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runDirectory = resolve(input.runRoot, runId);
  await mkdir(runDirectory, { recursive: true });

  const candidates = await Promise.all(
    candidateIds.map((candidateId) => input.executeCandidate(candidateId)),
  );
  const audits = await Promise.all(
    candidates.map((candidate) => input.executeAudits(candidate)),
  );
  const auditByCandidate = new Map(
    audits.map((audit) => [audit.candidateId, audit]),
  );
  const promotedCandidateIds = candidates
    .filter((candidate) => {
      const audit = auditByCandidate.get(candidate.candidateId);
      return candidate.passed && audit?.regimePassed && audit.factorPassed;
    })
    .map((candidate) => candidate.candidateId);
  const promoted = new Set(promotedCandidateIds);
  const rejectedCandidateIds = candidateIds.filter(
    (candidateId) => !promoted.has(candidateId),
  );
  const manifestPath = join(runDirectory, "manifest.json");
  const reportPath = join(runDirectory, "report.md");
  const manifest: QuantResearchRunManifest = {
    schemaVersion: 1,
    runId,
    researchOnly: true,
    liveTradingEnabled: false,
    status: "completed",
    startedAt,
    completedAt: now().toISOString(),
    graph,
    candidates,
    audits,
    promotedCandidateIds,
    rejectedCandidateIds,
    manifestPath,
    reportPath,
  };
  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await atomicWrite(reportPath, renderResearchReport(manifest));
  return manifest;
}

function uniqueCandidateIds(candidateIds: string[]) {
  return [...new Set(candidateIds.map((value) => value.trim()).filter(Boolean))];
}

function safeRunId(runId: string) {
  const value = runId.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw new Error("runId must contain only letters, numbers, dots, underscores, or hyphens.");
  }
  return value;
}

async function atomicWrite(path: string, content: string) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

export function renderResearchReport(manifest: QuantResearchRunManifest) {
  const promoted = manifest.promotedCandidateIds.length
    ? manifest.promotedCandidateIds.map((id) => `- ${id}`).join("\n")
    : "- None";
  const rejected = manifest.rejectedCandidateIds.length
    ? manifest.rejectedCandidateIds.map((id) => `- ${id}`).join("\n")
    : "- None";
  const auditByCandidate = new Map(
    manifest.audits.map((audit) => [audit.candidateId, audit]),
  );
  const decisions = manifest.candidates.map((candidate) => {
    const audit = auditByCandidate.get(candidate.candidateId);
    const promotedCandidate = manifest.promotedCandidateIds.includes(candidate.candidateId);
    const failedGates = candidate.failedGateIds?.length
      ? candidate.failedGateIds.join(", ")
      : "None";
    return `### ${candidate.candidateId}

- Decision: ${promotedCandidate ? "Promoted for human review" : "Rejected"}
- Failed gates: ${failedGates}
- Regime audit: ${audit?.regimePassed === true ? "Passed" : "Failed"}
- Factor audit: ${audit?.factorPassed === true ? "Passed" : "Failed"}
- Artifact SHA-256: ${candidate.artifactHash}`;
  }).join("\n\n") || "No candidate results were produced.";
  const dataset = manifest.dataset
    ? `- Dataset: ${manifest.dataset.id}
- Source: ${manifest.dataset.source}
- As of: ${manifest.dataset.asOf}
- Bars: ${manifest.dataset.bars}
- Dataset SHA-256: ${manifest.dataset.datasetHash || "Unavailable"}`
    : "- Dataset: Recorded in the request artifact";
  return `# Quant Research Run ${manifest.runId}

Research-only output. Live trading is disabled and no result is a recommendation or promise of future performance.

## Promoted after all gates

${promoted}

## Rejected or incomplete

${rejected}

## Candidate decisions

${decisions}

## Lineage

${dataset}
- Started: ${manifest.startedAt}
- Completed: ${manifest.completedAt}
- Candidate artifacts: ${manifest.candidates.length}
- Independent audit artifacts: ${manifest.audits.length}
`;
}
