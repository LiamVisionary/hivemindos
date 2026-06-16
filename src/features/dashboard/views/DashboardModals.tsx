"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CloseIconButton } from "@/components/ui/close-icon-button";
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
  const { Button, Check, ChevronLeft, Copy, CopyPlus, FileText, FolderOpen, HETZNER_IMAGE_OPTIONS, HETZNER_LOCATION_OPTIONS, HETZNER_SERVER_TYPE_OPTIONS, LoaderCircle, Plus, SetupCell, copyMachineInitCommand, copySetupCommand, displayAgents, duplicateAgent, duplicateAgentDraft, fleetClass, initializeMachineProject, kanbanClass, loadMachineDirectories, machineDirectoryBrowser, machineInitCopiedKey, machineInitDraft, machineInitOpen, machineInitStatus, machineInitToken, machineInitTokenStatus, openHetznerEnvFile, saveHetznerToken, selectedHetznerServerType, setDuplicateAgentDraft, setMachineDirectoryBrowser, setMachineInitDraft, setMachineInitOpen, setMachineInitToken, setMachineInitTokenStatus, setSetupMachineKey, setupCollectorCommand, setupCommandCopied, setupMachine } = props;
  const [machineInitView, setMachineInitView] = useState<"env" | "create">("env");
  const portalTarget = typeof document === "undefined" ? null : document.body;

  if (!portalTarget) return null;

  const closeMachineInitModal = () => {
    setMachineInitView("env");
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
        <div
          className={fleetClass("setupModalBackdrop")}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMachineInitModal();
          }}
        >
          <section className={fleetClass("setupModal")} role="dialog" aria-modal="true" aria-labelledby="machine-init-title">
            <div className={fleetClass("setupModalHeader")}>
              <div>
                <p className="eyebrow">Initialize machine</p>
                <h2 id="machine-init-title">New Hetzner agent box</h2>
                <p>Initializes a Hetzner VPS with the runtime agent of your choice and HivemindOS, then prepares it to join your fleet.</p>
              </div>
              <CloseIconButton aria-label="Close machine initializer" onClick={closeMachineInitModal} />
            </div>

            {!machineInitStatus.result ? (
              <div className={fleetClass("machineInitSteps")} aria-label="Machine initializer steps">
                <span className={fleetClass("machineInitStep", machineInitView === "env" && "active", machineInitTokenStatus.validated && "done")}>
                  <Check aria-hidden="true" />
                  Env setup
                </span>
                <span className={fleetClass("machineInitStep", machineInitView === "create" && "active")}>
                  <Plus aria-hidden="true" />
                  Machine
                </span>
              </div>
            ) : null}

            {!machineInitStatus.result && machineInitView === "env" ? (
              <section className={fleetClass("machineInitEmpty")}>
                <div>
                  <strong>Connect Hetzner Cloud</strong>
                  <p>Paste your HCLOUD_TOKEN and validate it with Hetzner Cloud. Once the token passes a live API check, this app saves it locally and unlocks machine creation.</p>
                </div>
                <label className={fleetClass("agentSettingsField")}>
                  <span>HCLOUD_TOKEN</span>
                  <input
                    {...secretInputProps}
                    value={machineInitToken}
                    onChange={(event) => {
                      setMachineInitToken(event.target.value);
                      setMachineInitTokenStatus({});
                    }}
                    placeholder="Paste token"
                    className={maskedSecretValueClass}
                  />
                </label>
                <div className={fleetClass("machineInitTokenActions")}>
                  <Button type="button" variant="secondary" onClick={saveHetznerToken} disabled={Boolean(machineInitTokenStatus.busyAction) || !machineInitToken.trim()}>
                    {machineInitTokenStatus.busyAction === "save" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
                    {machineInitTokenStatus.busyAction === "save" ? "Validating" : "Validate and save"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={openHetznerEnvFile} disabled={Boolean(machineInitTokenStatus.busyAction)}>
                    {machineInitTokenStatus.busyAction === "open" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <FileText aria-hidden="true" />}
                    Open env file
                  </Button>
                </div>
                {machineInitTokenStatus.error || machineInitTokenStatus.message ? (
                  <p className={machineInitTokenStatus.error ? fleetClass("machineInitTokenError") : fleetClass("machineInitTokenOk")}>
                    {machineInitTokenStatus.error ?? machineInitTokenStatus.message}
                  </p>
                ) : null}
                <div className={fleetClass("setupModalActions", "machineInitViewActions")}>
                  <Button type="button" onClick={() => setMachineInitView("create")} disabled={!machineInitTokenStatus.validated || Boolean(machineInitTokenStatus.busyAction)}>
                    <Check aria-hidden="true" />
                    Next
                  </Button>
                </div>
              </section>
            ) : null}

            {machineInitView === "create" || machineInitStatus.result ? (
            <form className={fleetClass("machineInitForm")} onSubmit={initializeMachineProject}>
              <label className={fleetClass("agentSettingsField")}>
                <span>Machine name</span>
                <input
                  value={machineInitDraft.projectName}
                  onChange={(event) => setMachineInitDraft((current) => ({ ...current, projectName: event.target.value }))}
                  placeholder="seo-worker-1"
                  required
                />
              </label>
              <label className={fleetClass("agentSettingsField")}>
                <span>Server type</span>
                <select
                  value={machineInitDraft.serverType}
                  onChange={(event) => setMachineInitDraft((current) => ({ ...current, serverType: event.target.value }))}
                >
                  {HETZNER_SERVER_TYPE_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className={fleetClass("agentSettingsField")}>
                <span>Location</span>
                <select
                  value={machineInitDraft.serverLocation}
                  onChange={(event) => setMachineInitDraft((current) => ({ ...current, serverLocation: event.target.value }))}
                >
                  {HETZNER_LOCATION_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className={fleetClass("agentSettingsField")}>
                <span>Image</span>
                <select
                  value={machineInitDraft.serverImage}
                  onChange={(event) => setMachineInitDraft((current) => ({ ...current, serverImage: event.target.value }))}
                >
                  {HETZNER_IMAGE_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className={fleetClass("agentSettingsField")}>
                <span>Runtime agent</span>
                <select
                  value={machineInitDraft.runtimeAgent}
                  onChange={(event) => setMachineInitDraft((current) => ({ ...current, runtimeAgent: event.target.value as AgentRuntime }))}
                >
                  <option value="hermes">Hermes</option>
                  <option value="openclaw">OpenClaw</option>
                  <option value="aeon">Aeon</option>
                </select>
              </label>
              <div className={fleetClass("machineInitCost")}>
                <span>Estimated compute</span>
                <strong>from €{selectedHetznerServerType.monthlyEur.toFixed(2)}/mo</strong>
                <dl className={fleetClass("machineInitSpecs")} aria-label={`${selectedHetznerServerType.label} compute specs`}>
                  <div>
                    <dt>vCPU</dt>
                    <dd>{selectedHetznerServerType.cores}</dd>
                  </div>
                  <div>
                    <dt>RAM</dt>
                    <dd>{selectedHetznerServerType.memoryGb} GB</dd>
                  </div>
                  <div>
                    <dt>SSD</dt>
                    <dd>{selectedHetznerServerType.diskGb} GB</dd>
                  </div>
                  <div>
                    <dt>CPU</dt>
                    <dd>{selectedHetznerServerType.cpu}</dd>
                  </div>
                </dl>
                <p>{selectedHetznerServerType.detail}. Public IPv4, VAT, location premiums, and current availability can change; verify with the generated live Hetzner commands before provisioning.</p>
              </div>
              <div className={fleetClass("setupModalActions")}>
                {!machineInitStatus.result ? (
                  <Button type="button" variant="secondary" onClick={() => setMachineInitView("env")} disabled={machineInitStatus.busy}>
                    <ChevronLeft aria-hidden="true" />
                    Back
                  </Button>
                ) : null}
                <Button type="submit" disabled={machineInitStatus.busy}>
                  {machineInitStatus.busy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Plus aria-hidden="true" />}
                  {machineInitStatus.busy ? "Initializing" : "Initialize"}
                </Button>
              </div>
            </form>
            ) : null}

            {machineInitStatus.error ? (
              <div className={fleetClass("machineInitError")}>{machineInitStatus.error}</div>
            ) : null}

            {machineInitStatus.result ? (
              <div className={fleetClass("machineInitResult")}>
                <div>
                  <strong>{machineInitStatus.result.serverName}</strong>
                  <span>{machineInitStatus.result.projectDir}</span>
                </div>
                {[
                  ["editEnv", "Add token", machineInitStatus.result.commands.editEnv],
                  ["listServerTypes", "Server types", machineInitStatus.result.commands.listServerTypes],
                  ["listLocations", "Locations", machineInitStatus.result.commands.listLocations],
                  ["provision", "Provision", machineInitStatus.result.commands.provision],
                  ["verify", "Verify SSH", machineInitStatus.result.commands.verify],
                  ["bootstrap", "Bootstrap HivemindOS", machineInitStatus.result.commands.bootstrap],
                  ["destroy", "Destroy", machineInitStatus.result.commands.destroy],
                ].filter((item): item is [string, string, string] => Boolean(item)).map(([key, label, command]) => (
                  <div key={key} className={fleetClass("machineInitCommand")}>
                    <span>{label}</span>
                    <pre>{command}</pre>
                    <Button type="button" size="sm" variant="secondary" onClick={() => copyMachineInitCommand(key, command)}>
                      {machineInitCopiedKey === key ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      {machineInitCopiedKey === key ? "Copied" : "Copy"}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </div>
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
