"use client";

import { Check, KeyRound, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import {
  AGENT_AUTHORITY_PRESETS,
  DEFAULT_AGENT_AUTHORITY,
  type AgentAuthorityPreset,
} from "@/lib/types/principal";
import { Badge, PanelHead } from "./AgentSettingsModalPrimitives";

type PresetCopy = {
  title: string;
  summary: string;
  detail: string;
  tone: "plain" | "live" | "honey";
  badge: string;
};

/**
 * Copy is deliberately behavioural rather than a claim list — an operator picks
 * a level by what the agent will be able to DO, not by which claim strings it
 * holds. The claim sets themselves live in
 * src/lib/services/security/agent-authority.ts.
 */
const PRESET_COPY: Record<AgentAuthorityPreset, PresetCopy> = {
  restricted: {
    title: "Restricted",
    summary: "Read-only. Can research, cannot change anything.",
    detail:
      "Reads files, searches the web, and queries the shared brain. Anything that writes, spends, publishes, or touches another machine is refused outright rather than queued for you.",
    tone: "plain",
    badge: "Read only",
  },
  standard: {
    title: "Standard",
    summary: "Does ordinary work freely. Outward actions wait for you.",
    detail:
      "Runs Work Board tasks, writes files, indexes repositories, and updates the dashboard without asking. Anything that reaches outward — money, credentials, publishing, another machine — lands in your Needs You lane first.",
    tone: "live",
    badge: "Default",
  },
  autonomous: {
    title: "Autonomous",
    summary: "Acts as its own authority. For a CEO or CTO agent you trust to run itself.",
    detail:
      "Approves its own risk decisions instead of queueing them, so a company can keep moving while you are away. Use this for an agent you have deliberately put in charge — not as a way to quiet a noisy approval queue.",
    tone: "honey",
    badge: "Own authority",
  },
};

function normalizePreset(value: unknown): AgentAuthorityPreset {
  const preset = String(value ?? "").trim();
  return (AGENT_AUTHORITY_PRESETS as readonly string[]).includes(preset)
    ? (preset as AgentAuthorityPreset)
    : DEFAULT_AGENT_AUTHORITY;
}

export function AgentSettingsPermissionsPanel({
  roleModalAgent,
  updateAgentProfile,
}: {
  roleModalAgent?: (Pick<AgentProfile, "id" | "name"> & { authority?: AgentAuthorityPreset; companyQueenOf?: string }) | null;
  updateAgentProfile: (agentId: string, patch: Partial<AgentProfile>) => unknown;
}) {
  const selected = normalizePreset(roleModalAgent?.authority);
  const isCompanyCeo = Boolean(roleModalAgent?.companyQueenOf);

  return (
    <div className="as-panel">
      <PanelHead
        eyebrow="Permissions"
        title="Authority level"
        sub="How much this agent can decide on its own, and what still comes to you."
      />

      {AGENT_AUTHORITY_PRESETS.map((preset) => {
        const copy = PRESET_COPY[preset];
        const active = preset === selected;
        const recommended = isCompanyCeo && preset === "autonomous";
        return (
          <button
            key={preset}
            type="button"
            className="as-choice"
            data-active={active || undefined}
            aria-pressed={active}
            disabled={!roleModalAgent?.id}
            onClick={() => {
              if (!roleModalAgent?.id || active) return;
              updateAgentProfile(roleModalAgent.id, { authority: preset });
            }}
          >
            <span className="t">
              <span>{copy.title}</span>
              {active ? (
                <Badge tone={copy.tone}>
                  <Check size={11} aria-hidden="true" />
                  Selected
                </Badge>
              ) : (
                <Badge tone="plain">{recommended ? "Suggested for a CEO agent" : copy.badge}</Badge>
              )}
            </span>
            <span className="s">{copy.summary}</span>
            <span className="s">{copy.detail}</span>
          </button>
        );
      })}

      {/*
        The load-bearing promise. An autonomous agent can run a company; it
        cannot silently move money, because per-action confirmation contracts
        are not skippable by any authority level or permission mode. Saying so
        here is what makes "Autonomous" a safe thing to click.
      */}
      <article className="as-sec">
        <span className="tile">
          <Wallet size={19} aria-hidden="true" />
        </span>
        <div>
          <h5>Money and publishing always ask</h5>
          <p>
            Sending funds, executing a trade, posting to a connected social account, driving the
            computer, and deploying to a machine stop for your confirmation at every authority
            level, including Autonomous. Changing that is a per-action decision, not a setting here.
          </p>
        </div>
        <Badge tone="live">
          <ShieldCheck size={11} aria-hidden="true" />
          Enforced
        </Badge>
      </article>

      <article className="as-sec">
        <span className="tile">
          <KeyRound size={19} aria-hidden="true" />
        </span>
        <div>
          <h5>No level grants operator rights</h5>
          <p>
            You keep administrator authority. No agent level can approve on your behalf outside its
            own work, and only Autonomous can settle its own pending decisions.
          </p>
        </div>
        <Badge tone="live">
          <ShieldCheck size={11} aria-hidden="true" />
          Enforced
        </Badge>
      </article>

      {/*
        Honesty gate: nothing reads AgentProfile.authority at dispatch yet, so
        the level is recorded but not applied. Shipping this panel without
        saying so would make the UI assert a control the system does not have.
        Delete this block in the same change that wires dispatch.
      */}
      <article className="as-sec">
        <span className="tile">
          <ShieldAlert size={19} aria-hidden="true" />
        </span>
        <div>
          <h5>Recorded, not yet applied</h5>
          <p>
            Agents currently run with full operator authority, so this level is saved but does not
            change what an agent can do yet. It takes effect when agent-scoped permissions are
            switched on.
          </p>
        </div>
        <Badge tone="honey">Pending</Badge>
      </article>
    </div>
  );
}
