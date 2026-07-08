"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentType, Dispatch, ElementType, ReactNode, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Eye, EyeOff, Trash2 } from "lucide-react";
import type { AgentProfile, AgentRuntime, RuntimeEnvFeature } from "@/lib/types/agent-runtime";
import type { AgentEnvCardProps } from "@/features/env/env-components";
import type { RuntimeSecretStatus } from "@/lib/services/runtime-adapters/types";
import type { DashboardView, HiveEnvBackupStatus, HiveEnvImportEntry, HiveEnvSource, RuntimeModelSelection } from "@/features/dashboard/dashboard-types";
import { maskedSecretValueClass, secretInputProps } from "@/components/ui/secret-input-props";
import envStyles from "./brain-env.module.css";

// Non-string entries are falsy toggles; envStyles[falsy] is undefined and filtered out.
const envClass = (...classes: Array<string | false | null | undefined>) => classes.map((className) => envStyles[className as string]).filter(Boolean).join(" ");

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;
type IconComponent = ElementType<{ "aria-hidden"?: boolean | "true" | "false"; className?: string; size?: number }>;
type EnvDraft = { key: string; value: string };
type HiveEnvImportPreview = { entries: HiveEnvImportEntry[]; error?: string };
type AeonSecretKey = RuntimeSecretStatus["keys"][number];
type AgentEnvOverlayCard = { agent: AgentProfile; draft: EnvDraft; entries: Array<[string, string]>; renderKey: string };

type BrainEnvRowProps = {
  editable?: boolean;
  extraAction?: ReactNode;
  name: string;
  onRemove: () => void;
  onSave: (value: string) => void;
  onToggleReveal: (revealKey: string) => void;
  revealKey: string;
  revealed: boolean;
  saving: boolean;
  scope: string;
  value: string;
};

function BrainEnvRow({
  editable = true,
  extraAction,
  name,
  onRemove,
  onSave,
  onToggleReveal,
  revealKey,
  revealed,
  saving,
  scope,
  value,
}: BrainEnvRowProps) {
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<number | null>(null);
  const copyValue = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  useEffect(() => () => {
    if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
  }, []);
  return (
    <div className={envClass("envRow")}>
      <div className={envClass("envRowTop")}>
        <span className={envClass("envDot")} />
        <code className={envClass("envKey")}>{name}</code>
        <span className={envClass("envScope", scope !== "shared" && "envScopeHoney")}>{scope}</span>
        <div className={envClass("envIconActions")}>
          {editable ? extraAction : null}
          <button type="button" className={envClass("envIcon", revealed && "envIconOn")} aria-label={`${revealed ? "Hide" : "Reveal"} ${name}`} title={revealed ? "Hide value" : "Reveal value"} onClick={() => onToggleReveal(revealKey)}>
            {revealed ? <EyeOff aria-hidden="true" size={15} /> : <Eye aria-hidden="true" size={15} />}
          </button>
          <button type="button" className={envClass("envIcon", copied && "envIconOk")} aria-label={copied ? `Copied ${name}` : `Copy ${name}`} title={copied ? "Copied" : "Copy value"} onClick={copyValue}>
            {copied ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
          </button>
          {editable ? (
            <button type="button" className={envClass("envIcon", "envIconDanger")} aria-label={`Remove ${name}`} title="Remove" onClick={onRemove}>
              <Trash2 aria-hidden="true" size={15} />
            </button>
          ) : null}
        </div>
      </div>
      <input
        key={`${revealKey}:${revealed}:${editable}:${value}`}
        {...secretInputProps}
        defaultValue={value}
        disabled={saving || !editable}
        onBlur={(event) => {
          if (editable) onSave(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.currentTarget.value = value;
            event.currentTarget.blur();
          }
        }}
        className={`${envClass("envField")} ${revealed ? "" : maskedSecretValueClass}`}
      />
      {saving ? <small style={{ color: "var(--brain-fg-4)", fontSize: 11 }}>Saving...</small> : null}
    </div>
  );
}

type ImportDialogProps = {
  Check: IconComponent;
  FileUp: IconComponent;
  LoaderCircle: IconComponent;
  importSharedEnvEntries: () => void | Promise<void>;
  portalTarget: HTMLElement | null;
  setSharedEnvImportOpen: Dispatch<SetStateAction<boolean>>;
  setSharedEnvImportText: Dispatch<SetStateAction<string>>;
  sharedEnvImport: HiveEnvImportPreview;
  sharedEnvImportChangedCount: number;
  sharedEnvImportDiff: HiveEnvImportEntry[];
  sharedEnvImportNewCount: number;
  sharedEnvImportSameCount: number;
  sharedEnvImportText: string;
  sharedEnvImporting: boolean;
  vaultClass: ClassNameBuilder;
};

function ImportDialog(props: ImportDialogProps) {
  const {
    Check,
    FileUp,
    LoaderCircle,
    importSharedEnvEntries,
    portalTarget,
    setSharedEnvImportOpen,
    setSharedEnvImportText,
    sharedEnvImport,
    sharedEnvImportChangedCount,
    sharedEnvImportDiff,
    sharedEnvImportNewCount,
    sharedEnvImportSameCount,
    sharedEnvImportText,
    sharedEnvImporting,
    vaultClass,
  } = props;
  if (!portalTarget) return null;
  return createPortal((
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 py-8" role="dialog" aria-modal="true" aria-label="Add from .env">
      <div className={`${envClass("envPanel")} grid max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-md border border-[var(--brain-line)] bg-[var(--brain-panel)] shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-[var(--brain-line)] p-6">
          <div>
            <p className="eyebrow">Bulk import</p>
            <h3 className="m-0 text-3xl font-bold">Add from .env</h3>
            <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-[var(--brain-fg-3)]">
              Paste `.env` contents or choose a file. Values are parsed locally first; only new and changed keys are sent through hive-env-add.
            </p>
          </div>
          <button type="button" className={envClass("envIcon")} aria-label="Close import dialog" onClick={() => setSharedEnvImportOpen(false)}>x</button>
        </div>
        <div className="grid gap-4 overflow-auto p-6">
          <textarea
            value={sharedEnvImportText}
            onChange={(event) => setSharedEnvImportText(event.target.value)}
            placeholder={"KEY_1=VALUE_1\nKEY_2=VALUE_2\nKEY_3=VALUE_3"}
            spellCheck={false}
            className={envClass("envTextarea")}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-xs text-[var(--brain-fg-3)]">
              {sharedEnvImport.entries.length
                ? `${sharedEnvImportDiff.length} to set - ${sharedEnvImportNewCount} new - ${sharedEnvImportChangedCount} changed - ${sharedEnvImportSameCount} unchanged`
                : "Paste KEY=value lines to preview changes."}
              {sharedEnvImport.error ? ` ${sharedEnvImport.error}` : ""}
            </p>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-[var(--brain-honey)] hover:bg-[var(--brain-honey-soft)]">
              Choose a file
              <FileUp aria-hidden="true" className="h-4 w-4" />
              <input
                type="file"
                accept=".env,text/plain"
                className="sr-only"
                onChange={async (event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  setSharedEnvImportText(await file.text());
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          {sharedEnvImport.entries.length ? (
            <div className="max-h-48 overflow-auto rounded-md border border-[var(--brain-line)]">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-[var(--brain-line)] px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--brain-fg-3)]">
                <span>Key</span>
                <span>Status</span>
              </div>
              {sharedEnvImport.entries.map((entry) => (
                <div key={entry.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-xs">
                  <code className="break-all text-[var(--brain-fg)]">{entry.key}</code>
                  <span className="rounded-full border border-[var(--brain-line-2)] px-2 py-1 font-bold text-[var(--brain-fg-3)]">{entry.status}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--brain-line)] px-6 pb-12 pt-5">
          <button type="button" className={envClass("envActionButton", "envActionPrimary")} onClick={() => void importSharedEnvEntries()} disabled={sharedEnvImporting || sharedEnvImportDiff.length === 0}>
            {sharedEnvImporting ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Check aria-hidden="true" />}
            Set variables
          </button>
          <button type="button" className={envClass("envActionButton")} onClick={() => setSharedEnvImportOpen(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  ), portalTarget);
}

type BrainEnvPanelProps = {
  AgentEnvCard: ComponentType<AgentEnvCardProps>;
  Button: ElementType;
  Check: IconComponent;
  Download: IconComponent;
  FileUp: IconComponent;
  LoaderCircle: IconComponent;
  Pencil: IconComponent;
  Plus: IconComponent;
  RefreshCcw: IconComponent;
  Search: IconComponent;
  ShieldCheck: IconComponent;
  Sparkles: IconComponent;
  Upload: IconComponent;
  addAgentEnvValue: (agent: AgentProfile) => void | Promise<void>;
  addSharedEnvValue: () => void | Promise<void>;
  aeonAgent: AgentProfile | null;
  agentEnvOverlayAgents: AgentProfile[];
  agentEnvOverlayCards: AgentEnvOverlayCard[];
  agentSpecificEnvCount: number;
  envSearch: string;
  envSearchQuery: string;
  filteredAgentSpecificEnvCount: number;
  filteredEnvSearchableCount: number;
  fleetClass: ClassNameBuilder;
  generateSharedEnvSecret: () => void;
  hiveEnvLoading: boolean;
  hiveEnvRestoring: boolean;
  hiveEnvSavingKey: string;
  hiveEnvStatus: string;
  hiveEnvSyncing: boolean;
  importSharedEnvEntries: () => void | Promise<void>;
  portalTarget: HTMLElement | null;
  promoteRuntimeEnvValue: (source: HiveEnvSource, key: string, value: string) => void | Promise<void>;
  refreshHiveEnv: () => void | Promise<void>;
  renderAgentKey: (agent: AgentProfile, index: number) => string;
  restoreSharedEnvBackup: () => void | Promise<void>;
  revealedEnvValues: Record<string, boolean>;
  runtimeEnvFeature: (runtime: AgentRuntime) => RuntimeEnvFeature;
  runtimeEnvSources: HiveEnvSource[];
  runtimeManagedEnvAgents: AgentProfile[];
  runtimeModelSelectionsByRuntime: Partial<Record<AgentRuntime, RuntimeModelSelection>>;
  saveAgentEnvValue: (agent: AgentProfile, key: string, value: string, previousValue: string) => void | Promise<void>;
  saveSharedEnvValue: (source: HiveEnvSource, key: string, value: string, previousValue: string) => void | Promise<void>;
  selectedRuntimeEnvEntries: Array<[string, string]>;
  selectedRuntimeEnvSource: HiveEnvSource | null | undefined;
  selectedRuntimeEnvTotal: number;
  setActiveView: Dispatch<SetStateAction<DashboardView>>;
  setAgentEnvDrafts: Dispatch<SetStateAction<Record<string, EnvDraft>>>;
  setEnvSearchQuery: Dispatch<SetStateAction<string>>;
  setHiveEnvRuntimeSourceId: Dispatch<SetStateAction<string>>;
  setSharedEnvAddMenuOpen: Dispatch<SetStateAction<boolean>>;
  setSharedEnvDraft: Dispatch<SetStateAction<EnvDraft>>;
  setSharedEnvEditable: Dispatch<SetStateAction<boolean>>;
  setSharedEnvImportOpen: Dispatch<SetStateAction<boolean>>;
  setSharedEnvImportText: Dispatch<SetStateAction<string>>;
  sharedBackupStatus: HiveEnvBackupStatus | null | undefined;
  sharedEnvAddMenuOpen: boolean;
  sharedEnvCount: number;
  sharedEnvDraft: EnvDraft;
  sharedEnvEditable: boolean;
  sharedEnvEntries: Array<[string, string]>;
  sharedEnvImport: HiveEnvImportPreview;
  sharedEnvImportChangedCount: number;
  sharedEnvImportDiff: HiveEnvImportEntry[];
  sharedEnvImportNewCount: number;
  sharedEnvImportOpen: boolean;
  sharedEnvImportSameCount: number;
  sharedEnvImportText: string;
  sharedEnvImporting: boolean;
  sharedEnvSource: HiveEnvSource | null | undefined;
  syncSharedEnvMachines: () => void | Promise<void>;
  toggleEnvValue: (key: string) => void;
  totalEnvSearchableCount: number;
  vaultClass: ClassNameBuilder;
  visibleMissingAeonSecrets: AeonSecretKey[];
  visibleRuntimeManagedEnvAgents: AgentProfile[];
};

export function BrainEnvPanel(props: BrainEnvPanelProps) {
  const {
    AgentEnvCard,
    Check,
    Download,
    FileUp,
    LoaderCircle,
    Pencil,
    Plus,
    RefreshCcw,
    Search,
    ShieldCheck,
    Sparkles,
    Upload,
    addAgentEnvValue,
    addSharedEnvValue,
    agentEnvOverlayAgents,
    agentEnvOverlayCards,
    agentSpecificEnvCount,
    aeonAgent,
    envSearch,
    envSearchQuery,
    filteredAgentSpecificEnvCount,
    filteredEnvSearchableCount,
    fleetClass,
    generateSharedEnvSecret,
    hiveEnvLoading,
    hiveEnvRestoring,
    hiveEnvSavingKey,
    hiveEnvStatus,
    hiveEnvSyncing,
    importSharedEnvEntries,
    portalTarget,
    promoteRuntimeEnvValue,
    revealedEnvValues,
    runtimeManagedEnvAgents,
    runtimeModelSelectionsByRuntime,
    saveAgentEnvValue,
    saveSharedEnvValue,
    selectedRuntimeEnvEntries,
    selectedRuntimeEnvSource,
    selectedRuntimeEnvTotal,
    setActiveView,
    setAgentEnvDrafts,
    setEnvSearchQuery,
    setHiveEnvRuntimeSourceId,
    setSharedEnvAddMenuOpen,
    setSharedEnvDraft,
    setSharedEnvEditable,
    setSharedEnvImportOpen,
    setSharedEnvImportText,
    sharedBackupStatus,
    sharedEnvAddMenuOpen,
    sharedEnvCount,
    sharedEnvDraft,
    sharedEnvEditable,
    sharedEnvImport,
    sharedEnvImportChangedCount,
    sharedEnvImportDiff,
    sharedEnvImportNewCount,
    sharedEnvImportOpen,
    sharedEnvImportSameCount,
    sharedEnvImportText,
    sharedEnvImporting,
    sharedEnvSource,
    sharedEnvEntries,
    syncSharedEnvMachines,
    toggleEnvValue,
    totalEnvSearchableCount,
    visibleMissingAeonSecrets,
    visibleRuntimeManagedEnvAgents,
    vaultClass,
    refreshHiveEnv,
    restoreSharedEnvBackup,
    runtimeEnvFeature,
    renderAgentKey,
  } = props;
  const sharedEnvDraftKey = sharedEnvDraft.key.trim();
  const sharedEnvDraftSaving = Boolean(sharedEnvDraftKey && hiveEnvSavingKey === `shared:${sharedEnvSource?.id ?? "shared"}:${sharedEnvDraftKey}`);

  return (
    <section className={`${fleetClass("taskPanel", "tabPanel")} ${envClass("envPanel")}`}>
      <div className={envClass("envWrap")}>
      <div className={envClass("envIntro")}>
        <div>
          <p className="eyebrow">Shared env</p>
          <h3>Keys every agent inherits</h3>
          <p>One shared set of runtime variables, injected into every trusted machine. Reveal, copy, or edit a value in place.</p>
        </div>
        <div className={envClass("envActions")}>
          {sharedEnvEditable ? (
            <>
              <button type="button" className={envClass("envActionButton")} onClick={() => setSharedEnvAddMenuOpen((open) => !open)}><Plus aria-hidden="true" />Add key</button>
              <button type="button" className={envClass("envActionButton")} onClick={() => setSharedEnvImportOpen(true)}><Download aria-hidden="true" />Import .env</button>
              <button type="button" className={envClass("envActionButton", "envActionPrimary")} onClick={() => setSharedEnvEditable(false)}><Check aria-hidden="true" />Done</button>
            </>
          ) : (
            <>
              <button type="button" className={envClass("envActionButton")} onClick={() => void syncSharedEnvMachines()} disabled={hiveEnvSyncing || sharedEnvCount === 0}>
                {hiveEnvSyncing ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
                Hivemind Sync
              </button>
              <button type="button" className={envClass("envActionButton")} onClick={() => void restoreSharedEnvBackup()} disabled={hiveEnvRestoring || !sharedBackupStatus?.backupExists || !sharedBackupStatus?.gpgAvailable}>
                {hiveEnvRestoring ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />}
                Backup
              </button>
              <button type="button" className={envClass("envActionButton")} onClick={() => void refreshHiveEnv()} disabled={hiveEnvLoading}>
                {hiveEnvLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
                Refresh
              </button>
              <button type="button" className={envClass("envActionButton", "envActionPrimary")} onClick={() => setSharedEnvEditable(true)}><Pencil aria-hidden="true" />Edit</button>
            </>
          )}
        </div>
      </div>

      {hiveEnvStatus ? <p className={`${envClass("envCard", "envStatusCard")} px-3 py-2 text-xs text-[var(--brain-fg)]`}>{hiveEnvStatus}</p> : null}

      {aeonAgent && visibleMissingAeonSecrets.length ? (
        <div className={`${envClass("envCard", "envNotice")} mb-3 p-4`}>
          <Sparkles aria-hidden="true" />
          <span className="flex-1 text-sm text-[var(--brain-fg-2)]">
            <b className="font-mono text-[var(--brain-fg)]">{visibleMissingAeonSecrets[0].key}</b> is missing for AEON.
          </span>
          <button type="button" className={envClass("envActionButton")} onClick={() => { setSharedEnvEditable(true); setSharedEnvAddMenuOpen(true); setSharedEnvDraft({ key: visibleMissingAeonSecrets[0].key, value: "" }); }}>Guided setup</button>
        </div>
      ) : null}

      {sharedEnvEditable && sharedEnvAddMenuOpen ? (
        <div className={`${envClass("envCard", "envEditCard")} p-4`}>
          <p className="eyebrow">Add shared variable</p>
          <div className={envClass("envEditGrid")}>
            <input className={envClass("envField")} value={sharedEnvDraft.key} onChange={(event) => setSharedEnvDraft((current) => ({ ...current, key: event.target.value.toUpperCase() }))} placeholder="KEY" />
            <input className={`${envClass("envField")} ${maskedSecretValueClass}`} {...secretInputProps} value={sharedEnvDraft.value} onChange={(event) => setSharedEnvDraft((current) => ({ ...current, value: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && !sharedEnvDraftSaving) void addSharedEnvValue(); }} placeholder="value" />
            <button type="button" className={envClass("envActionButton")} onClick={generateSharedEnvSecret}><Sparkles aria-hidden="true" />Secret</button>
            <button type="button" className={envClass("envActionButton", "envActionPrimary")} onClick={() => void addSharedEnvValue()} disabled={sharedEnvDraftSaving} aria-label="Save shared env variable">
              {sharedEnvDraftSaving ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Check aria-hidden="true" />}
              SAVE
            </button>
          </div>
        </div>
      ) : null}

      <div className={`${envClass("envCard")} overflow-hidden`}>
        <div className={envClass("envListHeader")}>
          <strong>{envSearch ? `${sharedEnvEntries.length} of ${sharedEnvCount}` : sharedEnvCount} variables - {sharedEnvEditable ? "editing" : "read-only"}</strong>
          <div className={envClass("envToolbar")} style={{ marginTop: 0, border: 0, padding: 0, background: "transparent" }}>
            <label className={envClass("envSearch")} aria-label="Search env variables">
              <Search aria-hidden="true" />
              <input type="search" value={envSearchQuery} onChange={(event) => setEnvSearchQuery(event.target.value)} placeholder="Search variables" spellCheck={false} />
            </label>
            <span className={envClass("envSearchCount")}>{envSearch ? `${filteredEnvSearchableCount} of ${totalEnvSearchableCount} matches` : `${totalEnvSearchableCount} searchable env items`}</span>
          </div>
        </div>
        {sharedEnvEntries.map(([key, value]) => {
          const revealKey = `shared:${sharedEnvSource?.id ?? "shared"}:${key}`;
          return (
            <BrainEnvRow
              key={key}
              name={key}
              value={value}
              scope="shared"
              revealKey={revealKey}
              revealed={Boolean(revealedEnvValues[revealKey])}
              saving={hiveEnvSavingKey === revealKey}
              editable={sharedEnvEditable}
              onToggleReveal={toggleEnvValue}
              onSave={(nextValue) => void saveSharedEnvValue(sharedEnvSource!, key, nextValue, value)}
              onRemove={() => void saveSharedEnvValue(sharedEnvSource!, key, "", value)}
            />
          );
        })}
        {!sharedEnvSource ? <p className={envClass("envEmpty")}>Press Refresh to read hive-env-add variables.</p> : sharedEnvCount === 0 ? <p className={envClass("envEmpty")}>No shared env variables yet.</p> : envSearch && sharedEnvEntries.length === 0 ? <p className={envClass("envEmpty")}>No shared variables match "{envSearchQuery}".</p> : null}
      </div>

      <div className="mt-4 grid gap-4">
        <section className={`${envClass("envCard", "envSubsection")} p-4`}>
          <div className={envClass("envSubHeader")}>
            <div>
              <p className="eyebrow">Not shared yet</p>
              <h3>Runtime-specific env</h3>
            </div>
            <div className={envClass("envRuntimeTabs")} role="tablist" aria-label="Runtime env source">
              {props.runtimeEnvSources.map((source) => (
                <button key={source.id} type="button" role="tab" aria-selected={selectedRuntimeEnvSource?.id === source.id} onClick={() => setHiveEnvRuntimeSourceId(source.id)}>
                  {source.label}
                </button>
              ))}
            </div>
          </div>
          {selectedRuntimeEnvSource ? (
            <div>
              {selectedRuntimeEnvEntries.map(([key, value]) => {
                const revealKey = `runtime:${selectedRuntimeEnvSource.id}:${key}`;
                const saving = hiveEnvSavingKey === revealKey || hiveEnvSavingKey === `promote:${selectedRuntimeEnvSource.id}:${key}`;
                return (
                  <BrainEnvRow
                    key={key}
                    name={key}
                    value={value}
                    scope={selectedRuntimeEnvSource.label}
                    revealKey={revealKey}
                    revealed={Boolean(revealedEnvValues[revealKey])}
                    saving={saving}
                    onToggleReveal={toggleEnvValue}
                    onSave={(nextValue) => void saveSharedEnvValue(selectedRuntimeEnvSource, key, nextValue, value)}
                    onRemove={() => void saveSharedEnvValue(selectedRuntimeEnvSource, key, "", value)}
                    extraAction={<button type="button" className={envClass("envIcon")} aria-label={`Add ${key} to shared env`} title="Add to shared env" onClick={() => void promoteRuntimeEnvValue(selectedRuntimeEnvSource, key, value)}><Upload aria-hidden="true" size={15} /></button>}
                  />
                );
              })}
              {selectedRuntimeEnvTotal === 0 ? <p className={envClass("envEmpty")}>No {selectedRuntimeEnvSource.label} env variables are outside the shared store.</p> : envSearch && selectedRuntimeEnvEntries.length === 0 ? <p className={envClass("envEmpty")}>No {selectedRuntimeEnvSource.label} variables match "{envSearchQuery}".</p> : null}
            </div>
          ) : <p className={envClass("envEmpty")}>Press Refresh to inspect runtime-specific env.</p>}
        </section>

        {visibleRuntimeManagedEnvAgents.length ? (
          <section className={envClass("envSubsection")}>
            <div className={envClass("envSubHeader")}>
              <div>
                <p className="eyebrow">Runtime-managed env</p>
                <h3>Secrets handled by adapter</h3>
              </div>
              <span className={envClass("envScope")}>{runtimeManagedEnvAgents.length} agents</span>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {visibleRuntimeManagedEnvAgents.map((agent, agentIndex) => {
                const feature = runtimeEnvFeature(agent.runtime);
                const manageAction = "manageAction" in feature ? feature.manageAction : undefined;
                const renderKey = renderAgentKey(agent, agentIndex);
                return (
                  <article key={renderKey} className={`${envClass("envCard")} grid gap-3 p-4`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="eyebrow">{feature.label}</p>
                        <h4 className="m-0 text-sm font-bold text-[var(--brain-fg)]">{agent.name}</h4>
                      </div>
                      <span className={envClass("envScope", "envScopeHoney")}>{agent.runtime}</span>
                    </div>
                    <p className="m-0 text-xs leading-5 text-[var(--brain-fg-3)]">{feature.description}</p>
                    {/* Boundary cast: RuntimeEnvFeature lives in lib/types (can't import DashboardView), but manageAction.view values are dashboard views by contract. */}
                    {manageAction ? <button type="button" className={envClass("envActionButton")} onClick={() => setActiveView(manageAction.view as DashboardView)}><ShieldCheck aria-hidden="true" />{manageAction.label}</button> : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className={envClass("envSubsection")}>
          <div className={envClass("envSubHeader")}>
            <div>
              <p className="eyebrow">Agent overlays</p>
              <h3>Specific to each agent</h3>
            </div>
            <span className={envClass("envScope")}>{envSearch ? `${filteredAgentSpecificEnvCount} of ${agentSpecificEnvCount}` : agentSpecificEnvCount} variables</span>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {agentEnvOverlayCards.map(({ agent, draft, entries, renderKey }) => (
              <AgentEnvCard
                key={renderKey}
                agent={agent}
                renderKey={renderKey}
                entries={entries}
                draft={draft}
                runtimeModelSelection={runtimeModelSelectionsByRuntime[agent.runtime]}
                revealedEnvValues={revealedEnvValues}
                onToggleReveal={toggleEnvValue}
                onSave={(key, value, previousValue) => saveAgentEnvValue(agent, key, value, previousValue)}
                onRemove={(key, previousValue) => saveAgentEnvValue(agent, key, "", previousValue)}
                onDraftChange={(nextDraft) => setAgentEnvDrafts((current) => ({ ...current, [agent.id]: nextDraft }))}
                onAdd={() => addAgentEnvValue(agent)}
              />
            ))}
            {!agentEnvOverlayAgents.length ? <p className={envClass("envEmpty")}>No runtime currently exposes profile env overlays.</p> : envSearch && !agentEnvOverlayCards.length ? <p className={envClass("envEmpty")}>No agent overlay variables match "{envSearchQuery}".</p> : null}
          </div>
        </section>
      </div>

      {sharedEnvImportOpen ? (
        <ImportDialog
          Check={Check}
          FileUp={FileUp}
          LoaderCircle={LoaderCircle}
          importSharedEnvEntries={importSharedEnvEntries}
          portalTarget={portalTarget}
          setSharedEnvImportOpen={setSharedEnvImportOpen}
          setSharedEnvImportText={setSharedEnvImportText}
          sharedEnvImport={sharedEnvImport}
          sharedEnvImportChangedCount={sharedEnvImportChangedCount}
          sharedEnvImportDiff={sharedEnvImportDiff}
          sharedEnvImportNewCount={sharedEnvImportNewCount}
          sharedEnvImportSameCount={sharedEnvImportSameCount}
          sharedEnvImportText={sharedEnvImportText}
          sharedEnvImporting={sharedEnvImporting}
          vaultClass={vaultClass}
        />
      ) : null}
      </div>
    </section>
  );
}
