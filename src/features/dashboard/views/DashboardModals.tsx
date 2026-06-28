"use client";

import { createPortal } from "react-dom";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { MachineInitModal } from "./MachineInitModal";
import { maskedSecretValueClass, secretInputProps } from "@/components/ui/secret-input-props";
import type { ComponentType, Dispatch, ElementType, FormEvent, SetStateAction } from "react";
import type { SetupCellProps, SetupStep } from "@/components/cells/SetupCell";
import type { AgentProfile, AgentRuntime } from "@/lib/types/agent-runtime";
import type { KanbanLinkedDirectory, KanbanMachineTarget } from "@/lib/types/kanban";
import type { DuplicateAgentDraft, MachineDirectoryBrowser, MachineGroup, MachineInitStatus, MachineInitTokenStatus } from "@/features/dashboard/dashboard-types";

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;
type SelectOption = { value: string; label: string };
type HetznerServerTypeOption = SelectOption & {
  detail: string;
  monthlyEur: number;
  cores: number;
  memoryGb: number;
  diskGb: number;
  cpu: string;
};
type MachineInitDraft = {
  projectName: string;
  serverType: string;
  serverLocation: string;
  serverImage: string;
  runtimeAgent: AgentRuntime;
};
type IconComponent = ElementType<{
  "aria-hidden"?: boolean | "true" | "false";
  className?: string;
}>;

type DashboardModalsProps = {
  Button: ElementType;
  Check: IconComponent;
  ChevronLeft: IconComponent;
  Copy: IconComponent;
  CopyPlus: IconComponent;
  FileText: IconComponent;
  FolderOpen: IconComponent;
  HETZNER_IMAGE_OPTIONS: readonly SelectOption[];
  HETZNER_LOCATION_OPTIONS: readonly SelectOption[];
  HETZNER_SERVER_TYPE_OPTIONS: readonly HetznerServerTypeOption[];
  LoaderCircle: IconComponent;
  Plus: IconComponent;
  SetupCell: ComponentType<SetupCellProps>;
  copyMachineInitCommand: (key: string, command: string) => void;
  copySetupCommand: (os?: string) => void;
  displayAgents: AgentProfile[];
  duplicateAgent: () => void | Promise<void>;
  duplicateAgentDraft: DuplicateAgentDraft | null;
  fleetClass: ClassNameBuilder;
  initializeMachineProject: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  kanbanClass: ClassNameBuilder;
  loadMachineDirectories: (
    machine: KanbanMachineTarget,
    path: string,
    onChoose?: (directory: KanbanLinkedDirectory) => void,
  ) => void | Promise<void>;
  machineDirectoryBrowser: MachineDirectoryBrowser | null;
  machineInitCopiedKey: string;
  machineInitDraft: MachineInitDraft;
  machineInitOpen: boolean;
  machineInitStatus: MachineInitStatus;
  machineInitToken: string;
  machineInitTokenStatus: MachineInitTokenStatus;
  openHetznerEnvFile: () => void | Promise<void>;
  saveHetznerToken: () => void | Promise<void>;
  selectedHetznerServerType: HetznerServerTypeOption;
  setDuplicateAgentDraft: Dispatch<SetStateAction<DuplicateAgentDraft | null>>;
  setMachineDirectoryBrowser: Dispatch<SetStateAction<MachineDirectoryBrowser | null>>;
  setMachineInitDraft: Dispatch<SetStateAction<MachineInitDraft>>;
  setMachineInitOpen: Dispatch<SetStateAction<boolean>>;
  setMachineInitToken: Dispatch<SetStateAction<string>>;
  setMachineInitTokenStatus: Dispatch<SetStateAction<MachineInitTokenStatus>>;
  setSetupMachineKey: Dispatch<SetStateAction<string>>;
  setupCollectorCommand: (os?: string) => string;
  setupCommandCopied: boolean;
  setupMachine: MachineGroup | null;
};

export function DashboardModals(props: DashboardModalsProps) {
  const { Button, Check, ChevronLeft, Copy, CopyPlus, FolderOpen, HETZNER_IMAGE_OPTIONS, HETZNER_LOCATION_OPTIONS, HETZNER_SERVER_TYPE_OPTIONS, SetupCell, copyMachineInitCommand, copySetupCommand, displayAgents, duplicateAgent, duplicateAgentDraft, fleetClass, initializeMachineProject, kanbanClass, loadMachineDirectories, machineDirectoryBrowser, machineInitCopiedKey, machineInitDraft, machineInitOpen, machineInitStatus, machineInitToken, machineInitTokenStatus, openHetznerEnvFile, saveHetznerToken, selectedHetznerServerType, setDuplicateAgentDraft, setMachineDirectoryBrowser, setMachineInitDraft, setMachineInitOpen, setMachineInitToken, setMachineInitTokenStatus, setSetupMachineKey, setupCollectorCommand, setupCommandCopied, setupMachine } = props;
  const portalTarget = typeof document === "undefined" ? null : document.body;

  if (!portalTarget) return null;

  const closeMachineInitModal = () => {
    setMachineInitOpen(false);
  };

  return createPortal((<>
      {duplicateAgentDraft ? (() => {
        const source = displayAgents.find((agent) => agent.id === duplicateAgentDraft.agentId) ?? null;
        if (!source) return null;
        const updateDraft = (patch: Partial<DuplicateAgentDraft>) => setDuplicateAgentDraft((current) => current ? { ...current, ...patch } : current);
        return (
          <div
            className={fleetClass("setupModalBackdrop")}
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setDuplicateAgentDraft(null);
            }}
          >
            <section className={fleetClass("setupModal", "agentSettingsModal")} role="dialog" aria-modal="true" aria-labelledby="duplicate-agent-title">
              <div className={fleetClass("setupModalHeader")}>
                <div>
                  <p className="eyebrow">Duplicate agent</p>
                  <h2 id="duplicate-agent-title">{source.name}</h2>
                  <p>The copy gets a new agent identity and its own wallet. Runtime sessions are never reused.</p>
                </div>
                <CloseIconButton aria-label="Close duplicate agent" onClick={() => setDuplicateAgentDraft(null)} />
              </div>
              <div className="grid gap-3">
                <label className={fleetClass("toggleRow")}>
                  <input type="checkbox" checked={duplicateAgentDraft.copyMemories} onChange={(event) => updateDraft({ copyMemories: event.target.checked })} />
                  <span><strong>Copy agent memories</strong><small>Forks private agent memory metadata while still using the shared brain normally.</small></span>
                </label>
                <label className={fleetClass("toggleRow")}>
                  <input type="checkbox" checked={duplicateAgentDraft.copyEnv} onChange={(event) => updateDraft({ copyEnv: event.target.checked })} />
                  <span><strong>Copy agent-specific env</strong><small>On by default. Shared hive-env-add variables remain available to both agents.</small></span>
                </label>
                <label className={fleetClass("toggleRow")}>
                  <input type="checkbox" checked={duplicateAgentDraft.copyChats} onChange={(event) => updateDraft({ copyChats: event.target.checked })} />
                  <span><strong>Copy chat history</strong><small>Copies dashboard chat transcripts as reference history for the new agent.</small></span>
                </label>
              </div>
              <div className={fleetClass("setupModalActions")}>
                <Button type="button" variant="secondary" onClick={() => setDuplicateAgentDraft(null)}>
                  Cancel
                </Button>
                <Button type="button" onClick={duplicateAgent}>
                  <CopyPlus aria-hidden="true" />
                  Duplicate
                </Button>
              </div>
            </section>
          </div>
        );
      })() : null}

      {machineInitOpen ? (
        <MachineInitModal
          onClose={closeMachineInitModal}
          draft={machineInitDraft}
          setDraft={setMachineInitDraft}
          token={machineInitToken}
          setToken={setMachineInitToken}
          tokenStatus={machineInitTokenStatus}
          setTokenStatus={setMachineInitTokenStatus}
          saveHetznerToken={saveHetznerToken}
          openHetznerEnvFile={openHetznerEnvFile}
          serverTypeOptions={HETZNER_SERVER_TYPE_OPTIONS}
          locationOptions={HETZNER_LOCATION_OPTIONS}
          imageOptions={HETZNER_IMAGE_OPTIONS}
          selectedServerType={selectedHetznerServerType}
          initializeMachineProject={initializeMachineProject}
          initStatus={machineInitStatus}
          copyCommand={copyMachineInitCommand}
          copiedKey={machineInitCopiedKey}
          secretInputProps={secretInputProps}
          maskedSecretValueClass={maskedSecretValueClass}
        />
      ) : null}

      {setupMachine ? (
        <div
          className={fleetClass("setupModalBackdrop")}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSetupMachineKey("");
          }}
        >
          <section className={fleetClass("setupModal")} role="dialog" aria-modal="true" aria-labelledby="setup-modal-title">
            <div className={fleetClass("setupModalHeader")}>
              <div>
                <p className="eyebrow">Connect machine</p>
                <h2 id="setup-modal-title">{setupMachine.name}</h2>
                <p>
                  {setupMachine.self
                    ? "This is the machine you are using now — it is already running HivemindOS."
                    : "Use this when you are physically on the computer you want to add."}
                </p>
              </div>
              <CloseIconButton aria-label="Close setup instructions" onClick={() => setSetupMachineKey("")} />
            </div>

            <div className={fleetClass("setupGuide")}>
              {/* Progressive setup, "activating cells in a hive" — rule from the
                  design philosophy's Setup Rules section. */}
              <SetupCell
                title="Add this machine"
                subtitle="Run setup locally. Add Tailscale or Hivemind Link when this machine should join Hivemind Sync."
                steps={((): SetupStep[] => {
                  const tailscaleReady = Boolean((setupMachine?.ip && setupMachine.ip !== "127.0.0.1") || setupMachine?.dnsName);
                  const steps: SetupStep[] = [
                    {
                      label: "Optional: Install Tailscale",
                      hint: "Install Tailscale if you want Hivemind Sync over your private machine network.",
                      state: tailscaleReady ? "done" : "pending",
                    },
                    {
                      label: "Connect",
                      hint: setupMachine?.self
                        ? "This machine is already running HivemindOS — its agent bridge starts with local setup."
                        : "Open a terminal (PowerShell on Windows) on the machine and run the setup command.",
                      state: "current",
                      action: (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-7 px-2.5 text-[0.7rem]"
                          onClick={() => copySetupCommand(setupMachine?.os)}
                        >
                          {setupCommandCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                          {setupCommandCopied ? "Copied" : "Copy command"}
                        </Button>
                      ),
                    },
                    {
                      label: "Verify machine",
                      hint: "We auto-detect the local agent bridge once it starts.",
                      state: "pending",
                    },
                    { label: "Configure features", hint: "Wallet caps, provider keys, x402, and debug only when you need them.", state: "pending" },
                  ];
                  if (setupMachine?.collector === "ready") {
                    steps[0].state = tailscaleReady ? "done" : "pending";
                    steps[1].state = "done";
                    steps[2].state = "done";
                    steps[3].state = "current";
                  }
                  return steps;
                })()}
                details={
                  setupMachine?.self ? (
                    <div className="flex flex-col gap-2 text-xs">
                      <p className="text-[var(--muted)]">
                        This is the machine running the HivemindOS dashboard you are using right now. Once an agent runtime is installed on this machine and its local bridge is running, it appears in the Fleet automatically.
                      </p>
                      <p>To re-run local setup from a source checkout:</p>
                      <pre className="overflow-auto rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] p-3 text-[0.78rem] text-[var(--foreground)]">{setupCollectorCommand(setupMachine?.os)}</pre>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 text-xs">
                      <p className="text-[var(--muted)]">
                        Tailscale is optional. Install and sign in only if you want multi-machine collaboration and shared memory; without it, setup continues in local-only mode.
                      </p>
                      <p>
                        Open a terminal on <strong className="text-[var(--foreground)]">{setupMachine?.name}</strong> (PowerShell on Windows), paste this command, then press Enter:
                      </p>
                      <pre className="overflow-auto rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] p-3 text-[0.78rem] text-[var(--foreground)]">{setupCollectorCommand(setupMachine?.os)}</pre>
                      <p className="text-[var(--muted)]">
                        When it finishes, come back here. The dashboard finds the machine on the next scan, and Chat becomes available.
                      </p>
                    </div>
                  )
                }
              />
            </div>

            <div className={fleetClass("setupModalActions")}>
              <Button type="button" onClick={() => setSetupMachineKey("")}>
                <Check aria-hidden="true" />
                Done
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {machineDirectoryBrowser?.open ? (
        <div
          className={kanbanClass("directoryBrowserBackdrop")}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMachineDirectoryBrowser(null);
          }}
        >
          <section className={kanbanClass("directoryBrowser")} role="dialog" aria-modal="true" aria-labelledby="directory-browser-title">
            <div className={kanbanClass("directoryBrowserHeader")}>
              <div>
                <p className="eyebrow">{machineDirectoryBrowser.machine.name}</p>
                <h2 id="directory-browser-title">Choose directory</h2>
                <span>{machineDirectoryBrowser.path}</span>
              </div>
              <CloseIconButton aria-label="Close directory browser" onClick={() => setMachineDirectoryBrowser(null)} />
            </div>
            <div className={kanbanClass("directoryBrowserList")} aria-label="Directories">
              {machineDirectoryBrowser.parentPath ? (
                <button
                  type="button"
                  className={kanbanClass("directoryBrowserParentButton")}
                  onClick={() => void loadMachineDirectories(
                    machineDirectoryBrowser.machine,
                    machineDirectoryBrowser.parentPath || "~",
                    machineDirectoryBrowser.onChoose,
                  )}
                >
                  <ChevronLeft aria-hidden="true" />
                  Parent folder
                </button>
              ) : null}
              {machineDirectoryBrowser.loading ? <p>Loading directories...</p> : null}
              {machineDirectoryBrowser.error ? <p role="alert">{machineDirectoryBrowser.error}</p> : null}
              {!machineDirectoryBrowser.loading && !machineDirectoryBrowser.error ? machineDirectoryBrowser.directories.map((directory) => (
                <button
                  type="button"
                  key={directory.path}
                  data-selected={machineDirectoryBrowser.selectedDirectory?.path === directory.path ? "true" : undefined}
                  onDoubleClick={() => void loadMachineDirectories(machineDirectoryBrowser.machine, directory.path, machineDirectoryBrowser.onChoose)}
                  onClick={() => {
                    setMachineDirectoryBrowser((current) => current && current.machine.key === machineDirectoryBrowser.machine.key
                      ? { ...current, selectedDirectory: directory }
                      : current);
                  }}
                >
                  <FolderOpen aria-hidden="true" />
                  <span>
                    <strong>{directory.name}</strong>
                    <small>{directory.path}</small>
                  </span>
                </button>
              )) : null}
            </div>
            <div className={kanbanClass("directoryBrowserActions")}>
              <button type="button" onClick={() => setMachineDirectoryBrowser(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={!machineDirectoryBrowser.selectedDirectory}
                onClick={() => {
                  const selected = machineDirectoryBrowser.selectedDirectory;
                  if (!selected) return;
                  machineDirectoryBrowser.onChoose?.({
                    id: `${selected.name}-${crypto.randomUUID()}`,
                    name: selected.name,
                    path: selected.path,
                    machineName: machineDirectoryBrowser.machine.name,
                    machineKey: machineDirectoryBrowser.machine.key,
                    lastUsedAt: Date.now(),
                  });
                  setMachineDirectoryBrowser(null);
                }}
              >
                Open
              </button>
            </div>
          </section>
        </div>
      ) : null}
  </>), portalTarget);
}
