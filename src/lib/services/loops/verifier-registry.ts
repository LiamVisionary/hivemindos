import type { LoopEvalGate, LoopEvalGateKind, LoopEvalGatePhase } from "@/lib/types/loops";

export type LoopVerifierId =
  | "command:lint"
  | "command:typecheck"
  | "command:test"
  | "command:playwright"
  | "artifact:exists"
  | "agent:judge"
  | "human:approval"
  | "receipt:evidence"
  | "evo:score"
  | "governance:policy";

export type LoopVerifierDefinition = {
  id: LoopVerifierId;
  title: string;
  kind: LoopEvalGateKind;
  phase: LoopEvalGatePhase;
  requiredByDefault: boolean;
  command?: string;
  description: string;
};

export const LOOP_VERIFIER_REGISTRY: Record<LoopVerifierId, LoopVerifierDefinition> = {
  "command:lint": {
    id: "command:lint",
    title: "Lint is clean",
    kind: "command",
    phase: "post",
    requiredByDefault: true,
    command: "pnpm run lint",
    description: "Rejects code changes that introduce lint warnings or errors.",
  },
  "command:typecheck": {
    id: "command:typecheck",
    title: "Types compile",
    kind: "command",
    phase: "post",
    requiredByDefault: true,
    command: "pnpm exec tsc --noEmit --pretty false --skipLibCheck",
    description: "Rejects code changes that break TypeScript.",
  },
  "command:test": {
    id: "command:test",
    title: "Focused tests pass",
    kind: "test",
    phase: "post",
    requiredByDefault: true,
    command: "pnpm test",
    description: "Runs the selected test suite or project default tests.",
  },
  "command:playwright": {
    id: "command:playwright",
    title: "Browser smoke passes",
    kind: "test",
    phase: "post",
    requiredByDefault: false,
    command: "pnpm exec playwright test",
    description: "Checks rendered UI behavior for loops that produce a browser surface.",
  },
  "artifact:exists": {
    id: "artifact:exists",
    title: "Expected artifact exists",
    kind: "artifact",
    phase: "post",
    requiredByDefault: true,
    description: "Requires a durable output path, URL, or deliverable receipt.",
  },
  "agent:judge": {
    id: "agent:judge",
    title: "Independent judge accepts",
    kind: "agent",
    phase: "post",
    requiredByDefault: true,
    description: "Uses a checker role separate from the builder role.",
  },
  "human:approval": {
    id: "human:approval",
    title: "Human approval recorded",
    kind: "human",
    phase: "pre",
    requiredByDefault: true,
    description: "Blocks risky or external side effects until a human approves.",
  },
  "receipt:evidence": {
    id: "receipt:evidence",
    title: "Evidence receipt attached",
    kind: "receipt",
    phase: "post",
    requiredByDefault: true,
    description: "Requires a receipt that names what changed and how it was verified.",
  },
  "evo:score": {
    id: "evo:score",
    title: "Evo score improved",
    kind: "test",
    phase: "post",
    requiredByDefault: true,
    description: "Requires an optimizer score receipt from Evo or a compatible benchmark.",
  },
  "governance:policy": {
    id: "governance:policy",
    title: "Governance policy respected",
    kind: "receipt",
    phase: "post",
    requiredByDefault: true,
    description: "Requires evidence that spend, approvals, and external actions stayed inside policy.",
  },
};

export function loopGateFromVerifier(
  verifierId: LoopVerifierId,
  input: {
    id?: string;
    title?: string;
    required?: boolean;
    phase?: LoopEvalGatePhase;
    command?: string;
    now?: number;
  } = {},
): LoopEvalGate {
  const verifier = LOOP_VERIFIER_REGISTRY[verifierId];
  const title = input.title ?? verifier.title;
  const createdAt = input.now ?? Date.now();
  return {
    id: input.id ?? `${verifierId.replace(/[^a-z0-9]+/gi, "-")}-${stableHash(title)}`,
    title,
    kind: verifier.kind,
    phase: input.phase ?? verifier.phase,
    required: input.required ?? verifier.requiredByDefault,
    status: "pending",
    command: input.command ?? verifier.command,
    verifier: verifier.id,
    createdAt,
  };
}

export function listLoopVerifiers(): LoopVerifierDefinition[] {
  return Object.values(LOOP_VERIFIER_REGISTRY);
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 8);
}
