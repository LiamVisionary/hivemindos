/**
 * Per-agent authority: what claims an agent carries and whether it stands as
 * its own approver.
 *
 * The claim vocabulary answers "may this agent do this category of thing"; the
 * risk rungs in `authorizeOperation` answer "does a human sign off". This module
 * is how an operator sets both per agent, so a company CEO/CTO agent can be
 * given standing authority while a research agent stays read-only — without
 * either becoming `local:admin`, which would short-circuit the whole system.
 *
 * Deliberate limit: no preset can skip a `confirmation` whose `when` is not
 * `"unless-auto-policy-allows"`. Those are per-action product gates — sending
 * USDC, executing a trade, publishing, driving the computer — and they stay
 * gated for every agent regardless of authority. An autonomous agent can run the
 * company; it cannot silently move money. Change that per action, not here.
 */
import type { ChatPermissionMode } from "@/lib/types/chat-permissions";
import {
  AGENT_AUTHORITY_PRESETS,
  DEFAULT_AGENT_AUTHORITY,
  DEFAULT_RUNTIME_AGENT_CLAIMS,
  LOCAL_ADMIN_CLAIM,
  type AgentAuthorityPreset,
  type PrincipalContext,
} from "@/lib/types/principal";

export { AGENT_AUTHORITY_PRESETS, DEFAULT_AGENT_AUTHORITY };
export type { AgentAuthorityPreset };

/** Read-only research work: look at things, never change them. */
export const RESTRICTED_AGENT_CLAIMS = [
  "connectors:read",
  "filesystem:read",
  "network:invoke",
  "brain:read",
  "telemetry:read",
  "artifacts:read",
] as const;

export type AgentAuthorityProfile = {
  preset: AgentAuthorityPreset;
  claims: string[];
  /**
   * Threaded into `authorizeOperation`. `auto`/`bypass` mean the operator has
   * pre-approved the risk rungs for this agent.
   */
  permissionMode: ChatPermissionMode;
  /** Whether this agent may settle its own pending approvals. */
  selfApproves: boolean;
};

export function agentAuthorityProfile(preset: AgentAuthorityPreset = DEFAULT_AGENT_AUTHORITY): AgentAuthorityProfile {
  if (preset === "restricted") {
    return {
      preset,
      claims: [...RESTRICTED_AGENT_CLAIMS],
      permissionMode: "manual",
      selfApproves: false,
    };
  }
  if (preset === "autonomous") {
    return {
      preset,
      // `actions:approve` is what makes the agent its own authority. It is never
      // a default — the operator grants it per agent, deliberately.
      claims: [...DEFAULT_RUNTIME_AGENT_CLAIMS, "actions:approve"],
      permissionMode: "bypass",
      selfApproves: true,
    };
  }
  return {
    preset: "standard",
    claims: [...DEFAULT_RUNTIME_AGENT_CLAIMS],
    permissionMode: "manual",
    selfApproves: false,
  };
}

export function normalizeAgentAuthorityPreset(value: unknown): AgentAuthorityPreset {
  const preset = String(value ?? "").trim();
  return (AGENT_AUTHORITY_PRESETS as readonly string[]).includes(preset)
    ? (preset as AgentAuthorityPreset)
    : DEFAULT_AGENT_AUTHORITY;
}

/**
 * Build the principal a runtime agent acts under.
 *
 * `principalId` is server-assigned by the caller from the agent record — never
 * from a caller-supplied `agentId` argument, which an agent can set to anything.
 * No preset grants `local:admin`: that claim short-circuits every check, so
 * handing it to an agent would silently disable the authority system this module
 * exists to express.
 */
export function runtimeAgentPrincipal(input: {
  agentId: string;
  displayName?: string;
  preset?: AgentAuthorityPreset;
  workspaceId?: string;
}): PrincipalContext {
  const profile = agentAuthorityProfile(input.preset ?? DEFAULT_AGENT_AUTHORITY);
  const claims = profile.claims.filter((claim) => claim !== LOCAL_ADMIN_CLAIM);
  return {
    principalId: `agent:${input.agentId}`,
    displayName: input.displayName?.trim() || input.agentId,
    kind: "runtime-agent",
    source: "runtime",
    workspaceId: input.workspaceId?.trim() || "default",
    claims,
  };
}
