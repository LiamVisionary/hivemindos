"use client";

import type { ComponentType, ReactNode } from "react";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { VaultSyncStatus } from "@/features/dashboard/dashboard-types";
import styles from "./BrainConfigPanel.module.css";

const configClass = (...classes: string[]) => classes.map((className) => styles[className]).filter(Boolean).join(" ");

type PathCheckStatus = { ok?: boolean; reason?: string; error?: string } | null;

type BrainConfigButton = ComponentType<{
  type?: "button" | "submit" | "reset";
  size?: string;
  variant?: string;
  disabled?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}>;

type FolderConfigKey = "inboxFolder" | "sharedNotePath" | "kanbanFolder" | "notificationsFolder" | "synthesisFolder" | "brainServicesFolder";

type BrainConfigPanelProps = {
  Button: BrainConfigButton;
  DEFAULT_SHARED_VAULT: SharedVaultConfig;
  checkControlRoomStatus: () => void;
  checkVaultStatus: () => void;
  controlRoomStatus: PathCheckStatus;
  displayAgents: AgentProfile[];
  pairSyncthingVaultSync: () => void;
  runVaultTailnetSync: (dryRun: boolean) => void;
  setVaultPanelMode: (mode: string) => void;
  sharedVault: SharedVaultConfig;
  updateSharedVault: (patch: Partial<SharedVaultConfig>) => void;
  vaultStatus: PathCheckStatus;
  vaultSyncPending: string;
  vaultSyncStatus: VaultSyncStatus | null;
};

function statusCopy(status: PathCheckStatus, success: string, pending: string, failurePrefix: string) {
  if (!status) return { tone: "", text: pending };
  if (status.ok) return { tone: "statusOk", text: success };
  return { tone: "statusBad", text: `${failurePrefix} ${status.reason ?? status.error ?? "check the configured path."}` };
}

export function BrainConfigPanel(props: BrainConfigPanelProps) {
  const {
    Button,
    DEFAULT_SHARED_VAULT,
    checkControlRoomStatus,
    checkVaultStatus,
    controlRoomStatus,
    displayAgents,
    pairSyncthingVaultSync,
    runVaultTailnetSync,
    setVaultPanelMode,
    sharedVault,
    updateSharedVault,
    vaultStatus,
    vaultSyncPending,
    vaultSyncStatus,
  } = props;
  const optedInAgentCount = displayAgents.filter((agent) => agent.useSharedVault !== false).length;
  const vaultCheck = statusCopy(
    vaultStatus,
    "Reachable. Notes can be read by opted-in agents.",
    "Press Check vault path below to verify.",
    "Cannot read this folder -",
  );
  const controlCheck = statusCopy(
    controlRoomStatus,
    "Connected. Agents see the operating manual and registry.",
    "Press Check HivemindOS below to verify.",
    "Not connected -",
  );
  const syncBadge = sharedVault.syncProvider === "syncthing"
    ? "Syncthing"
    : sharedVault.syncProvider === "manual"
      ? "Manual"
      : "External";
  const folders: Array<[string, FolderConfigKey, string]> = [
    ["Inbox", "inboxFolder", sharedVault.inboxFolder],
    ["Shared note", "sharedNotePath", sharedVault.sharedNotePath],
    ["Kanban", "kanbanFolder", sharedVault.kanbanFolder ?? DEFAULT_SHARED_VAULT.kanbanFolder],
    ["Notifications", "notificationsFolder", sharedVault.notificationsFolder ?? DEFAULT_SHARED_VAULT.notificationsFolder],
    ["Synthesis", "synthesisFolder", sharedVault.synthesisFolder ?? DEFAULT_SHARED_VAULT.synthesisFolder],
    ["Brain services", "brainServicesFolder", sharedVault.brainServicesFolder ?? DEFAULT_SHARED_VAULT.brainServicesFolder],
  ];

  return (
    <div className={configClass("fade")}>
      <div className={configClass("intro")}>
        <p className={configClass("eyebrow")}>Brain config</p>
        <h3>How the brain is wired</h3>
        <p>Where memory lives, how it syncs, and which services are switched on. These settings apply across every trusted machine.</p>
      </div>

      <div className={configClass("grid")}>
        <div className={configClass("stack")}>
          <article className={configClass("card")}>
            <div className={configClass("cardHeader")}>
              <div>
                <h4>Shared brain</h4>
                <p>{optedInAgentCount}/{displayAgents.length} agents opted in</p>
              </div>
              <label className={configClass("toggle")}>
                <input
                  type="checkbox"
                  checked={sharedVault.enabled}
                  onChange={(event) => updateSharedVault({ enabled: event.target.checked })}
                />
                {sharedVault.enabled ? "On" : "Off"}
              </label>
            </div>
            <label className={configClass("label")}>
              Vault folder
              <input
                value={sharedVault.vaultPath}
                onChange={(event) => updateSharedVault({ vaultPath: event.target.value })}
                className={configClass("field", "mono")}
              />
              <small className={configClass("muted")}>Where shared notes live. Read-only until the vault is reachable.</small>
            </label>
          </article>

          <article className={configClass("card")}>
            <div className={configClass("cardHeader")}>
              <div>
                <h4>Hivemind sync provider</h4>
                <p>Choose one owner for realtime brain-file syncing.</p>
              </div>
              <span className={configClass("badge")}>{syncBadge}</span>
            </div>
            <label className={configClass("label")}>
              Brain sync owner
              <select
                value={sharedVault.syncProvider}
                onChange={(event) => {
                  // DOM boundary: the <option> values below are exactly this union.
                  const syncProvider = event.target.value as SharedVaultConfig["syncProvider"];
                  updateSharedVault({
                    syncProvider,
                    syncthingAutoPairEnabled: syncProvider === "syncthing" ? sharedVault.syncthingAutoPairEnabled : false,
                  });
                }}
                className={configClass("select")}
              >
                <option value="external">I already use Obsidian Sync, iCloud, Dropbox, Git, or another provider</option>
                <option value="syncthing">Use HivemindOS Syncthing over Tailscale</option>
                <option value="manual">Manual Tailscale SSH repair only</option>
              </select>
            </label>
            <div className={configClass("smallGrid")} style={{ marginTop: 12 }}>
              <label className={configClass("label")}>
                Tailscale machine
                <input
                  value={sharedVault.tailnetSyncHost}
                  onChange={(event) => updateSharedVault({ tailnetSyncHost: event.target.value })}
                  placeholder="user@machine or magicdns-name"
                  className={configClass("field", "mono")}
                />
              </label>
              <label className={configClass("label")}>
                Repair direction
                <select
                  value={sharedVault.tailnetSyncDirection}
                  onChange={(event) => updateSharedVault({ tailnetSyncDirection: event.target.value as "bidirectional" | "push" | "pull" })}
                  className={configClass("select")}
                >
                  <option value="bidirectional">Bidirectional with conflict copies</option>
                  <option value="push">This Mac to Tailnet machine</option>
                  <option value="pull">Tailnet machine to This Mac</option>
                </select>
              </label>
            </div>
            <label className={configClass("label")} style={{ marginTop: 12 }}>
              Remote vault folder override
              <input
                value={sharedVault.tailnetSyncPath}
                onChange={(event) => updateSharedVault({ tailnetSyncPath: event.target.value })}
                placeholder="Leave blank for agent bridge default"
                className={configClass("field", "mono")}
              />
            </label>
            <div className={configClass("toggleRow")} style={{ marginTop: 12 }}>
              {sharedVault.syncProvider === "syncthing" ? (
                <label className={configClass("toggle")}>
                  <input
                    type="checkbox"
                    checked={sharedVault.syncthingAutoPairEnabled}
                    onChange={(event) => updateSharedVault({ syncthingAutoPairEnabled: event.target.checked })}
                  />
                  Auto-pair Syncthing
                </label>
              ) : null}
              <div className={configClass("actions")}>
                {sharedVault.syncProvider === "syncthing" ? (
                  <Button type="button" size="sm" variant="secondary" disabled={Boolean(vaultSyncPending)} onClick={pairSyncthingVaultSync}>
                    {vaultSyncPending === "syncthing" ? "Pairing" : "Pair realtime"}
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="secondary" disabled={Boolean(vaultSyncPending)} onClick={() => runVaultTailnetSync(true)}>
                  {vaultSyncPending === "dry-run" ? "Checking" : "Dry run"}
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={Boolean(vaultSyncPending)} onClick={() => runVaultTailnetSync(false)}>
                  {vaultSyncPending === "sync" ? "Syncing" : "Sync now"}
                </Button>
              </div>
            </div>
            {vaultSyncStatus ? (
              <p className={configClass("muted")} style={{ margin: "12px 0 0", color: vaultSyncStatus.ok ? "var(--brain-live, #6fcdba)" : "var(--brain-danger, #e58e85)" }}>
                {vaultSyncStatus.ok
                  ? vaultSyncStatus.message ?? `${vaultSyncStatus.dryRun ? "Dry run" : "Repair sync"} finished.`
                  : vaultSyncStatus.error ?? vaultSyncStatus.stderr ?? "Hivemind Sync repair failed."}
              </p>
            ) : null}
          </article>
        </div>

        <div className={configClass("stack")}>
          <article className={configClass("card")}>
            <p className={configClass("eyebrow")}>Vault folders</p>
            <div className={configClass("folderRows")}>
              {folders.map(([label, key, value]) => (
                <label key={key} className={configClass("folderRow")}>
                  <span>{label}</span>
                  <input
                    value={value}
                    onChange={(event) => updateSharedVault({ [key]: event.target.value })}
                    className={configClass("field", "mono")}
                  />
                </label>
              ))}
            </div>
          </article>

          <article className={configClass("card", "serviceCard")}>
            <div>
              <strong>Brain service controls</strong>
              <p>GBrain and Syntho runtime settings live beside their service health.</p>
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={() => setVaultPanelMode("brain-services")}>
              Open Brain Services
            </Button>
          </article>

          <label className={configClass("card", "toggle")}>
            <input
              type="checkbox"
              checked={sharedVault.noteTaskImportEnabled}
              onChange={(event) => updateSharedVault({ noteTaskImportEnabled: event.target.checked })}
            />
            Auto-import markdown note tasks into Work Ideas
          </label>

          <article className={configClass("card")}>
            <label className={configClass("card", "toggle")} style={{ marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={sharedVault.runtimeStateSyncEnabled ?? false}
                onChange={(event) => updateSharedVault({ runtimeStateSyncEnabled: event.target.checked })}
              />
              Sync agent runtimes across machines
            </label>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
              Off by default. When on, this machine keeps each runtime&apos;s skills, memories and
              non-secret config reconciled with your other machines (last-writer-wins, with conflict
              copies — never a silent overwrite). Provider API keys travel via the shared hive env, and
              login tokens, session history and caches are never copied. Enable it on each machine you
              want kept in sync.
            </p>
          </article>

          <article className={configClass("card")}>
            <label className={configClass("label")}>
              Note task folders
              <textarea
                value={sharedVault.noteTaskImportFolders ?? DEFAULT_SHARED_VAULT.noteTaskImportFolders}
                onChange={(event) => updateSharedVault({ noteTaskImportFolders: event.target.value })}
                className={configClass("textarea", "mono")}
              />
            </label>
            <label className={configClass("label")} style={{ marginTop: 12 }}>
              HivemindOS folder
              <input
                value={sharedVault.controlRoomPath}
                onChange={(event) => updateSharedVault({ controlRoomPath: event.target.value })}
                className={configClass("field", "mono")}
              />
            </label>
            <label className={configClass("label")} style={{ marginTop: 12 }}>
              Agent instructions
              <textarea
                value={sharedVault.instructions}
                onChange={(event) => updateSharedVault({ instructions: event.target.value })}
                className={configClass("textarea")}
              />
            </label>
          </article>

          <article className={configClass("card")}>
            <div className={configClass("cardHeader")}>
              <div>
                <h4>Path verification</h4>
                <p>The app validates paths before agents rely on them.</p>
              </div>
              <div className={configClass("actions")}>
                <Button type="button" size="sm" variant="secondary" onClick={checkVaultStatus}>Check vault path</Button>
                <Button type="button" size="sm" variant="secondary" onClick={checkControlRoomStatus}>Check HivemindOS</Button>
              </div>
            </div>
            <div className={configClass("statusList")}>
              <div className={configClass("statusItem", vaultCheck.tone)}>
                <strong>Vault path</strong>
                <span>{vaultCheck.text}</span>
              </div>
              <div className={configClass("statusItem", controlCheck.tone)}>
                <strong>HivemindOS</strong>
                <span>{controlCheck.text}</span>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
