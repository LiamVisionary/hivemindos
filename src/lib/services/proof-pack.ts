import type { GitLawbProof } from "@/lib/types/gitlawb";

export type ProofPackStatus = "verified" | "evaluated" | "needs-attention" | "unverified";

export type ProofPackInput = {
  taskId: string;
  title: string;
  result?: string;
  deliverables?: Array<{ id: string; label: string; kind: string; path?: string; url?: string }>;
  receipts?: Array<{ title: string; status: "passed" | "failed" | "skipped"; evidence?: string[] }>;
  proofs?: GitLawbProof[];
  agentName?: string | null;
  machineName?: string;
  completedAt?: number;
  updatedAt?: number;
};

export type ProofPack = {
  id: string;
  status: ProofPackStatus;
  headline: string;
  provenance: string[];
  checks: { passed: number; failed: number; skipped: number; evidence: number };
  artifacts: number;
  verifiedClaims: string[];
  unverifiedClaims: string[];
};

export function buildProofPack(input: ProofPackInput): ProofPack {
  const receipts = input.receipts ?? [];
  const proofs = input.proofs ?? [];
  const passed = receipts.filter((receipt) => receipt.status === "passed").length;
  const failed = receipts.filter((receipt) => receipt.status === "failed").length;
  const skipped = receipts.filter((receipt) => receipt.status === "skipped").length;
  const evidence = receipts.reduce((count, receipt) => count + (receipt.evidence?.filter(Boolean).length ?? 0), 0);
  const signed = proofs.some((proof) => proof.status === "verified" && proof.id.startsWith("work-receipt:"));
  const evaluated = passed > 0 && failed === 0;
  const status: ProofPackStatus = failed > 0 ? "needs-attention" : signed && evaluated ? "verified" : evaluated ? "evaluated" : "unverified";
  const verifiedClaims: string[] = [];
  if (input.deliverables?.length) verifiedClaims.push(`${input.deliverables.length} deliverable${input.deliverables.length === 1 ? "" : "s"} recorded on the Work Board.`);
  if (input.result?.trim()) verifiedClaims.push("The agent recorded a result for this task.");
  if (passed) verifiedClaims.push(`${passed} verification check${passed === 1 ? "" : "s"} passed.`);
  if (signed) verifiedClaims.push("A cryptographically verified work receipt identifies the producing agent.");
  const unverifiedClaims: string[] = [];
  if (!signed) unverifiedClaims.push("No verified signed work receipt is attached.");
  if (!receipts.length) unverifiedClaims.push("No eval-gate receipts are recorded.");
  if (skipped) unverifiedClaims.push(`${skipped} verification check${skipped === 1 ? " was" : "s were"} skipped.`);
  if (failed) unverifiedClaims.push(`${failed} verification check${failed === 1 ? " failed" : "s failed"}.`);
  const provenance = [
    input.agentName ? `Agent: ${input.agentName}` : "Agent identity not recorded",
    input.machineName ? `Machine: ${input.machineName}` : "Machine not recorded",
    ...(proofs.filter((proof) => proof.status === "verified").map((proof) => proof.title || `${proof.kind} proof verified`)),
  ];
  return {
    id: `proof-pack:${input.taskId}`,
    status,
    headline: status === "verified" ? "Verified outcome" : status === "evaluated" ? "Evaluated, unsigned outcome" : status === "needs-attention" ? "Verification needs attention" : "Outcome not independently verified",
    provenance,
    checks: { passed, failed, skipped, evidence },
    artifacts: input.deliverables?.length ?? 0,
    verifiedClaims,
    unverifiedClaims,
  };
}
