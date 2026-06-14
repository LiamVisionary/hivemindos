export type BrainActorKind = "human" | "agent";
export type BrainCollaborationMode = "personal" | "agent-to-agent" | "human-collective";
export type BrainWriteOperation = "compile" | "fix-health" | "dismiss-health" | "direct-edit";

export type SharedContributionPolicyInput = {
  domain?: string;
  actorKind?: BrainActorKind;
  collaborationMode?: BrainCollaborationMode;
  operation?: BrainWriteOperation;
  readonly?: boolean;
  optedInDomain?: string;
};

export type SharedContributionPolicy = {
  canWrite: boolean;
  domain: string;
  actorKind: BrainActorKind;
  collaborationMode: BrainCollaborationMode;
  operation: BrainWriteOperation;
  isSharedMirror: boolean;
  readonly: boolean;
  reason: string;
  guidance: string;
  contributionTarget?: string;
};

function normalizeDomain(domain?: string) {
  return (domain || "shared-brain").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "shared-brain";
}

export function resolveSharedContributionPolicy(input: SharedContributionPolicyInput = {}): SharedContributionPolicy {
  const domain = normalizeDomain(input.domain);
  const actorKind = input.actorKind ?? "agent";
  const collaborationMode = input.collaborationMode ?? (actorKind === "human" ? "personal" : "agent-to-agent");
  const operation = input.operation ?? "compile";
  const isSharedMirror = domain.startsWith("shared-");
  const readonly = input.readonly === true;
  const contributionTarget = normalizeDomain(input.optedInDomain || "work");

  if (readonly) {
    return {
      canWrite: false,
      domain,
      actorKind,
      collaborationMode,
      operation,
      isSharedMirror,
      readonly,
      reason: "The target domain is explicitly marked read-only.",
      guidance: "Write into a writable personal or project domain, then use the owning sync/contribution workflow to publish it.",
      contributionTarget,
    };
  }

  if (isSharedMirror && collaborationMode === "human-collective") {
    return {
      canWrite: false,
      domain,
      actorKind,
      collaborationMode,
      operation,
      isSharedMirror,
      readonly,
      reason: "Human collective shared-brain mirrors are pulled outputs, not direct write targets.",
      guidance: `Save the contribution to the contributor's opted-in personal domain, such as "${contributionTarget}", then push contributions and let synthesis rebuild the shared mirror.`,
      contributionTarget,
    };
  }

  return {
    canWrite: true,
    domain,
    actorKind,
    collaborationMode,
    operation,
    isSharedMirror,
    readonly,
    reason: isSharedMirror
      ? "Shared-looking domain names do not block normal agent-to-agent work unless the domain is explicitly read-only or the caller selected human-collective mode."
      : "The target domain is writable under the selected collaboration mode.",
    guidance: collaborationMode === "agent-to-agent"
      ? "Agent-to-agent contributions keep HivemindOS' normal shared-vault, handoff, and memory permissions. Use review gates for risky side effects, not for ordinary internal knowledge writes."
      : "Write normally, then sync through the configured vault owner.",
    contributionTarget,
  };
}
