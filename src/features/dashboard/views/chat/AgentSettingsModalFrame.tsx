"use client";

import type { ReactNode } from "react";
import { Bot, Check, Settings2, X } from "lucide-react";
import {
  AsOrb,
  Badge,
  Btn,
  PANEL_ICONS,
  TextInput,
  panelDetail,
  panelTitle,
} from "./AgentSettingsModalPrimitives";
import styles from "./AgentSettingsModal.module.css";

type AgentSettingsModalFrameProps = {
  activePanel: string;
  activePanels: string[];
  agentCreateMachine?: { name?: string } | null;
  agentSettingsTitle?: string;
  agentSettingsWorkerImage?: string;
  agentStatus: string;
  closeAgentSettingsModal: () => void;
  currentName: string;
  description: string;
  displayName: string;
  footNote: string;
  isAutopilotSettings: boolean;
  onPrimaryAction: () => void;
  panelContent: ReactNode;
  primaryActionBusy: boolean;
  primaryActionDisabled: boolean;
  primaryActionLabel: string;
  roleModalAgent?: { description?: string; machineId?: string; machineName?: string } | null;
  runtimeLabel: string;
  setAgentSettingsPanel: (panel: string) => void;
  updateName: (name: string) => void;
  workerSubtitle: string;
};

export function AgentSettingsModalFrame({
  activePanel,
  activePanels,
  agentCreateMachine,
  agentSettingsTitle,
  agentSettingsWorkerImage,
  agentStatus,
  closeAgentSettingsModal,
  currentName,
  description,
  displayName,
  footNote,
  isAutopilotSettings,
  onPrimaryAction,
  panelContent,
  primaryActionBusy,
  primaryActionDisabled,
  primaryActionLabel,
  roleModalAgent,
  runtimeLabel,
  setAgentSettingsPanel,
  updateName,
  workerSubtitle,
}: AgentSettingsModalFrameProps) {
  return (
    <div
      role="presentation"
      className={styles.root}
      data-theme="dark"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeAgentSettingsModal();
      }}
    >
      <section className="as-modal" role="dialog" aria-modal="true" aria-labelledby="agent-settings-title">
        <header className="as-head">
          <div>
            <span className="fb-eyebrow">{agentSettingsTitle || (agentCreateMachine ? "Add agent" : "Agent settings")}</span>
            <h3 id="agent-settings-title">{displayName}</h3>
            <p>{description}</p>
          </div>
          <button type="button" className="fb-iconbtn" onClick={closeAgentSettingsModal} aria-label="Close agent settings">
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="as-body">
          <aside className="as-rail fr-scroll">
            <div className="as-id">
              <AsOrb state={isAutopilotSettings ? "duty" : "idle"} iconSrc={agentSettingsWorkerImage} />
              <TextInput
                value={currentName}
                onChange={(event) => updateName(event.target.value)}
                placeholder={displayName}
                aria-label="Agent name"
                autoFocus={Boolean(agentCreateMachine)}
                className="as-name-input"
              />
              <div className="as-id-badges">
                <Badge tone="honey"><Bot size={11} aria-hidden="true" />{runtimeLabel}</Badge>
                <Badge>{workerSubtitle || agentStatus}</Badge>
              </div>
              <div className="as-id-meta">
                <span className={["fr-dot", isAutopilotSettings ? "live" : ""].filter(Boolean).join(" ")} />
                <span>{agentCreateMachine ? agentCreateMachine.name : roleModalAgent?.machineName || roleModalAgent?.machineId || "This Mac"} - {agentStatus}</span>
              </div>
            </div>

            <nav className="as-nav fr-scroll" role="tablist" aria-label="Agent settings sections">
              {activePanels.map((panel) => {
                const NavIcon = PANEL_ICONS[panel] ?? Settings2;
                const active = panel === activePanel;
                return (
                  <button key={panel} type="button" className="as-tab" data-active={active || undefined} role="tab" aria-selected={active} onClick={() => setAgentSettingsPanel(panel)}>
                    <span className="ico"><NavIcon size={17} aria-hidden={true} /></span>
                    <span>
                      <span className="lbl">{panelTitle(panel)}</span>
                      <span className="det">{panelDetail(panel)}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="as-pane fr-scroll">
            {panelContent}
          </main>
        </div>

        <footer className="as-foot">
          <span className="as-foot-note">
            <Check size={13} aria-hidden="true" /> {footNote}
          </span>
          <div className="acts">
            <Btn onClick={closeAgentSettingsModal}>Cancel</Btn>
            <Btn
              variant="primary"
              disabled={primaryActionBusy || primaryActionDisabled}
              onClick={() => void onPrimaryAction()}
            >
              <Check size={14} aria-hidden="true" />{primaryActionLabel}
            </Btn>
          </div>
        </footer>
      </section>
    </div>
  );
}
