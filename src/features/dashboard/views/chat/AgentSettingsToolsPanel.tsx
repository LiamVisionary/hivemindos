// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { Cpu, Mail, MessageSquare, Repeat2, Search, Send, Sparkles } from "lucide-react";
import { Badge, Btn, PanelHead, TextInput } from "./AgentSettingsModalPrimitives";

const TOOL_DEFS = [
  ["sessionSearch", "Session search", "Search prior work across this runtime.", Search],
  ["backgroundTasks", "Background tasks", "Run work without blocking chat.", Repeat2],
  ["xSearch", "X search", "Fetch X posts through runtime auth.", MessageSquare],
  ["socialPosting", "X posting", "Publish through installed social skills.", Send],
  ["imageGeneration", "AI images", "Generate images through runtime tools.", Sparkles],
  ["ttsGeneration", "TTS", "Generate speech through runtime tools.", Sparkles],
  ["musicGeneration", "Music", "Generate music through runtime tools.", Sparkles],
  ["sfxGeneration", "SFX", "Generate sound effects through runtime tools.", Sparkles],
  ["model3dGeneration", "3D", "Generate 3D assets through runtime tools.", Sparkles],
  ["videoGeneration", "AI video", "Generate videos through runtime tools.", Sparkles],
  ["codexRuntime", "Codex runtime", "Delegate coding to Codex paths.", Cpu],
];

export function AgentSettingsToolsPanel({
  HERMES_UPDATE_INTEGRATION_KEYS,
  agentMailboxBusy,
  agentMailboxError,
  agentMailboxOverview,
  createMailboxForCurrentAgent,
  hermesUpdateRequired,
  refreshRuntimeIntegrations,
  roleModalAgent,
  runtimeCapabilities,
  runtimeIntegrationBusy,
  runtimeIntegrationStatus,
  runtimeSessionQuery,
  runtimeSessionResults,
  searchRuntimeSessionsForAgent,
  setRuntimeSessionQuery,
}) {
  if (!roleModalAgent) {
    return <div className="as-panel"><PanelHead eyebrow="Tools" title="Runtime integrations" /><p className="as-muted">Create the agent first; runtime tools appear after the profile exists.</p></div>;
  }

  const mailbox = agentMailboxOverview?.mailboxes?.[0];
  const mailboxProvider = agentMailboxOverview?.providerStatus;
  const mailboxReady = mailbox?.status === "ready";
  const mailboxStatus = mailboxReady ? "Ready" : mailboxProvider?.ready ? "Ready to create" : "Provider needed";
  const mailboxBlockers = Array.isArray(mailboxProvider?.blockers) ? mailboxProvider.blockers.slice(0, 3) : [];

  return (
    <div className="as-panel">
      <PanelHead
        eyebrow="Tools"
        title="Runtime integrations"
        sub="Adapter-neutral capabilities. Each one appears only when this runtime exposes it."
        action={<Btn sm disabled={runtimeIntegrationBusy === "status"} onClick={() => void refreshRuntimeIntegrations(roleModalAgent)}>{runtimeIntegrationBusy === "status" ? "Refreshing..." : "Refresh"}</Btn>}
      />
      <article className="as-tool as-mailbox" data-ready={mailboxReady || undefined}>
        <span className="tile"><Mail size={18} aria-hidden="true" /></span>
        <div>
          <div className="th"><span className="tn">Agent mailbox</span><Badge tone={mailboxReady ? "live" : "honey"}>{mailboxStatus}</Badge></div>
          <p className="td">{mailboxReady ? mailbox.address : mailboxProvider?.detail || "Create a persistent mailbox for this agent."}</p>
          {mailboxBlockers.map((blocker) => <p key={blocker} className="td">{blocker}</p>)}
          {agentMailboxError ? <p className="as-error">{agentMailboxError}</p> : null}
        </div>
        <Btn variant={mailboxReady ? "ghost" : "primary"} sm disabled={agentMailboxBusy || mailboxReady} onClick={() => void createMailboxForCurrentAgent()}>
          {agentMailboxBusy ? "Creating..." : mailboxReady ? "Created" : "Create mailbox"}
        </Btn>
      </article>
      <div className="as-tools">
        {TOOL_DEFS.map(([key, label, detail, ToolIcon]) => {
          const item = runtimeIntegrationStatus?.integrations?.[key];
          const supported = item?.supported ?? Boolean(runtimeCapabilities(roleModalAgent)[key]);
          const enabled = item?.enabled ?? supported;
          const needsHermesUpdate = roleModalAgent.runtime === "hermes" && supported && hermesUpdateRequired && HERMES_UPDATE_INTEGRATION_KEYS.has(key);
          const statusLabel = needsHermesUpdate ? "Needs Hermes update" : supported ? enabled ? "Ready" : "Needs setup" : "Not exposed";
          return (
            <article key={key} className="as-tool" data-ready={supported && enabled || undefined} data-off={!supported || undefined}>
              <span className="tile"><ToolIcon size={16} aria-hidden="true" /></span>
              <div>
                <div className="th"><span className="tn">{label}</span><Badge tone={supported && enabled ? "live" : supported ? "honey" : undefined}>{statusLabel}</Badge></div>
                <p className="td">{detail}</p>
              </div>
            </article>
          );
        })}
      </div>
      <div className="as-block">
        <div><strong>Search sessions</strong><p className="as-muted">Search readable local session history for this runtime.</p></div>
        <div className="as-row">
          <TextInput value={runtimeSessionQuery} onChange={(event) => setRuntimeSessionQuery(event.target.value)} placeholder="April 15, Codex, Kanban, auth..." />
          <Btn variant="primary" disabled={runtimeIntegrationBusy === "session-search"} onClick={() => void searchRuntimeSessionsForAgent(roleModalAgent)}>{runtimeIntegrationBusy === "session-search" ? "Searching..." : "Search"}</Btn>
        </div>
        {runtimeSessionResults?.length ? (
          <div className="as-sess">
            {runtimeSessionResults.slice(0, 5).map((result, index) => (
              <article key={result.id ?? index} className="as-sess-row">
                <div className="st">{result.title || result.path || "Session result"}</div>
                <p className="se">{result.excerpt || result.path || JSON.stringify(result)}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
