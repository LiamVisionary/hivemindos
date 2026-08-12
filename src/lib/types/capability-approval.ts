export const CAPABILITY_APPROVAL_CONTINUATION_MARKER = "[HIVEMINDOS_CAPABILITY_PLAN_APPROVED]";

export type CapabilityAvailability = "ready" | "setup-required";
export type CapabilityDecision = "use" | "approve-setup" | "reject" | "remove";
export type CapabilityApprovalStatus = "pending" | "approved" | "cancelled";
export type CapabilityApprovalMode = "automatic" | "ask";

export type CapabilitySetupOption =
  | { kind: "installable-service"; serviceId: string; label: string; description: string }
  | { kind: "connection"; providerKey: string; label: string; description: string };

export type CapabilityCandidate = {
  id: string;
  name: string;
  summary: string;
  kind: string;
  availability: CapabilityAvailability;
  locator?: string;
  machineName?: string;
  setupOptions?: CapabilitySetupOption[];
};

export type CapabilityApprovalItem = {
  id: string;
  intent: string;
  label: string;
  reason: string;
  candidates: CapabilityCandidate[];
  selectedCapabilityId: string;
  decision: CapabilityDecision;
  githubUrl?: string;
  instructions?: string;
};

export type CapabilityApprovalPlan = {
  version: 1;
  reviewMode: CapabilityApprovalMode;
  id: string;
  task: string;
  agentId: string;
  agentName: string;
  chatStorageKey: string;
  chatLeaf: string;
  status: CapabilityApprovalStatus;
  items: CapabilityApprovalItem[];
  createdAt: number;
  resolvedAt?: number;
};

export function selectedCapability(item: CapabilityApprovalItem) {
  return item.candidates.find((candidate) => candidate.id === item.selectedCapabilityId) ?? item.candidates[0];
}

export function capabilityPlanRequiresReview(plan: Pick<CapabilityApprovalPlan, "reviewMode">) {
  return plan.reviewMode !== "automatic";
}

export function hasPendingCapabilityApproval(messages: readonly { capabilityApproval?: { status?: CapabilityApprovalStatus; reviewMode?: CapabilityApprovalMode } }[] = []) {
  return messages.some((message) => (
    message.capabilityApproval?.status === "pending" && message.capabilityApproval.reviewMode !== "automatic"
  ));
}
