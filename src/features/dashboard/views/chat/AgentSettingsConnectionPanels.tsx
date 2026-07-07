"use client";

import {
  BrainCircuit,
  Check,
  FolderOpen,
  Pencil,
  PlugZap,
  Settings2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  Badge,
  Btn,
  Field,
  GroupLabel,
  PanelHead,
  TextInput,
  Toggle,
} from "./AgentSettingsModalPrimitives";

export function AgentSettingsAeonConnectionPanel({
  aeonOauthConnecting,
  aeonSettings,
  browseAgentRuntimeFolder,
  openAeonGithubOauth,
  updateAeonSettings,
}: any) {
  return (
    <div className="as-panel-section">
      <div>
        <GroupLabel>Connection mode</GroupLabel>
        <div className="as-mode-seg" role="tablist" aria-label="Connection mode">
          {[
            { id: "local", label: "Local repo", sub: "Use files on this Mac", Icon: FolderOpen },
            { id: "github", label: "GitHub", sub: "Use repo and branch", Icon: Upload },
            { id: "a2a", label: "A2A", sub: "Use gateway URL", Icon: PlugZap },
          ].map((mode) => {
            const active = aeonSettings.mode === mode.id;
            return (
              <button key={mode.id} type="button" data-active={active || undefined} onClick={() => updateAeonSettings({ aeonMode: mode.id })}>
                <mode.Icon size={15} aria-hidden="true" />
                <span>{mode.label}</span>
                <small>{mode.sub}</small>
              </button>
            );
          })}
        </div>
      </div>
      {aeonSettings.mode === "github" ? (
        <div className="as-block accent">
          <div className="as-github-connect">
            <Upload size={17} aria-hidden="true" />
            <div>
              <strong>Connect with GitHub OAuth</strong>
              <p>Saves GH_GLOBAL with repo, workflow, hook, org, and email access.</p>
            </div>
            <Btn variant="primary" sm disabled={aeonOauthConnecting} onClick={openAeonGithubOauth}>{aeonOauthConnecting ? "Opening..." : "Connect GitHub"}</Btn>
          </div>
          <details className="fb-disc" open={Boolean(aeonSettings.repo)}>
            <summary>Advanced repo values</summary>
            <div className="as-2col">
              <Field label="GitHub repo"><TextInput className="fb-mono" value={aeonSettings.repo} onChange={(event) => updateAeonSettings({ aeonRepo: event.target.value })} placeholder="owner/repo" /></Field>
              <Field label="Branch"><TextInput className="fb-mono" value={aeonSettings.branch} onChange={(event) => updateAeonSettings({ aeonBranch: event.target.value })} placeholder="main" /></Field>
            </div>
          </details>
        </div>
      ) : null}
      {aeonSettings.mode === "a2a" ? (
        <details className="fb-disc" open>
          <summary>Advanced gateway URL</summary>
          <Field label="A2A gateway URL"><TextInput className="fb-mono" value={aeonSettings.a2aUrl} onChange={(event) => updateAeonSettings({ a2aUrl: event.target.value, gatewayUrl: event.target.value })} placeholder="http://127.0.0.1:41241" /></Field>
        </details>
      ) : null}
      {aeonSettings.mode === "local" ? (
        <div className="as-block">
          <div className="as-folder">
            <span className="tile"><FolderOpen size={19} aria-hidden="true" /></span>
            <div className="grow">
              <span className="fb-eyebrow">AEON repo folder</span>
              <code className="path">{aeonSettings.path || "Choose a folder"}</code>
            </div>
            <Btn sm onClick={() => void browseAgentRuntimeFolder?.()}><FolderOpen size={14} aria-hidden="true" />Browse</Btn>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AgentSettingsMemoryPanel({
  agentCreateDraft,
  agentCreateMachine,
  agentRuntimeFolderBrowsing,
  agentRuntimeFolderEditing,
  agentRuntimeFolderStatus,
  browseAgentRuntimeFolder,
  isAutopilotSettings,
  roleModalAgent,
  runtimeFolderValue,
  setAgentCreateDraft,
  setAgentRuntimeFolderEditing,
  setAgentRuntimeFolderStatus,
  sharedVault,
  updateAgentProfile,
}: any) {
  const shared = agentCreateMachine ? agentCreateDraft.useSharedVault : roleModalAgent?.useSharedVault !== false;
  return (
    <div className="as-panel">
      <PanelHead eyebrow="Memory" title="Brain and workspace" sub="Where this agent remembers, and the local folder it reads and writes." />
      <div className="as-mem-card" data-on={shared || undefined}>
        <div className="as-mem-head">
          <span className="tile"><BrainCircuit size={19} aria-hidden="true" /></span>
          <div className="grow">
            <div className="t">Shared Obsidian brain</div>
            <div className="s">{shared ? "One vault backs this agent's memory, tasks, and context." : "Off - this agent keeps its own isolated memory."}</div>
          </div>
          <Toggle on={shared} onChange={() => {
            if (agentCreateMachine) setAgentCreateDraft((current: any) => ({ ...current, useSharedVault: !shared }));
            else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { useSharedVault: !shared });
          }} />
        </div>
        {shared ? (
          <div className="as-mem-detail">
            <div className="as-mem-path">
              <FolderOpen size={15} aria-hidden="true" />
              <code>{sharedVault?.enabled ? sharedVault.vaultPath || "Auto-detected vault" : "Shared brain is off in Vault settings"}</code>
            </div>
            <div className="as-mem-chips">
              {["Memory", "Kanban", "Notifications", "Context"].map((label) => <span key={label} className="as-mem-chip"><Check size={11} aria-hidden="true" />{label}</span>)}
            </div>
          </div>
        ) : null}
      </div>
      {!agentCreateMachine && roleModalAgent ? (
        <div className="as-folder">
          <span className="tile"><FolderOpen size={19} aria-hidden="true" /></span>
          <div className="grow">
            <span className="fb-eyebrow">{isAutopilotSettings ? "AEON repo folder" : "Runtime folder"}</span>
            <code className="path">{runtimeFolderValue.trim() || "Managed by runtime"}</code>
            <div className="desc">{isAutopilotSettings ? "The local AEON repo the dashboard reads and mirrors into Obsidian." : "Used as this agent's local memory and workspace folder."}</div>
          </div>
          <div className="acts">
            <button type="button" className="fb-iconbtn" disabled={agentRuntimeFolderBrowsing} onClick={() => void browseAgentRuntimeFolder()} aria-label="Browse runtime folder"><FolderOpen size={15} aria-hidden="true" /></button>
            <button type="button" className="fb-iconbtn" onClick={() => setAgentRuntimeFolderEditing((current: boolean) => !current)} aria-label="Edit runtime folder path"><Pencil size={15} aria-hidden="true" /></button>
          </div>
        </div>
      ) : null}
      {agentRuntimeFolderEditing && roleModalAgent ? (
        <details className="fb-disc" open>
          <summary>Advanced folder path</summary>
          <div className="as-row">
            <TextInput
              className="fb-mono"
              value={runtimeFolderValue}
              onChange={(event) => {
                updateAgentProfile(roleModalAgent.id, isAutopilotSettings ? { aeonLocalPath: event.target.value, localDataDir: event.target.value } : { localDataDir: event.target.value });
                setAgentRuntimeFolderStatus("");
              }}
              placeholder={isAutopilotSettings ? "~/.aeon or ~/my-aeon-repo" : "Leave blank to use the runtime default"}
            />
            <Btn variant="primary" sm onClick={() => setAgentRuntimeFolderEditing(false)}><Check size={13} aria-hidden="true" />Done</Btn>
          </div>
        </details>
      ) : null}
      {agentRuntimeFolderStatus ? <p className="as-status">{agentRuntimeFolderStatus}</p> : null}
    </div>
  );
}

export function AgentSettingsSecurityPanel() {
  return (
    <div className="as-panel">
      <PanelHead eyebrow="Security" title="Guards and redaction" sub="Always-on protections that run locally before anything reaches a runtime." />
      {[
        ["Secret redaction", "Sensitive env values stay masked in runtime-facing prompts.", ShieldCheck],
        ["Local-first paths", "Machine and directory access keeps collector boundaries intact.", FolderOpen],
        ["Scoped tools", "Runtime actions appear only for capabilities the current adapter exposes.", Settings2],
      ].map(([title, body, SecurityIcon]) => (
        <article key={title as string} className="as-sec">
          <span className="tile"><SecurityIcon size={19} aria-hidden="true" /></span>
          <div><h5>{title as string}</h5><p>{body as string}</p></div>
          <Badge tone="live"><Check size={11} aria-hidden="true" />Active</Badge>
        </article>
      ))}
    </div>
  );
}
