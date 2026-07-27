"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, LoaderCircle, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HiveMessagingProvider, HiveMessagingProviderMeta } from "@/lib/types/messaging-channels";
import {
  BeeHex,
  capabilityLabels,
  HiveButton,
  type MessagingAgentOption,
  ProviderTile,
} from "@/features/dashboard/views/messaging-shared";
import styles from "@/features/dashboard/views/messaging-channels.module.css";

export type MessagingChannelDraftPayload = {
  provider: HiveMessagingProvider;
  agentId: string;
  agentName: string;
  label: string;
  target: string;
  credentialEnvKey?: string;
  defaultForAgent: boolean;
};

type Props = {
  open: boolean;
  providers: HiveMessagingProviderMeta[];
  agents: MessagingAgentOption[];
  initialAgentId: string;
  /** Agent ids that already have a default channel — used to avoid silently demoting one. */
  agentsWithDefault: string[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (draft: MessagingChannelDraftPayload) => void;
};

type DraftState = {
  provider: HiveMessagingProvider;
  agentId: string;
  label: string;
  target: string;
  cred: string;
  defaultForAgent: boolean;
};

export function MessagingChannelModal({ open, providers, agents, initialAgentId, agentsWithDefault, saving, onClose, onSubmit }: Props) {
  const hasDefault = useCallback((agentId: string) => agentsWithDefault.includes(agentId), [agentsWithDefault]);
  const providersById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);
  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const defaultProvider = useMemo<HiveMessagingProvider>(
    () => (providersById.has("telegram") ? "telegram" : providers[0]?.id ?? "telegram"),
    [providers, providersById],
  );

  const buildDefault = useCallback((agentId: string): DraftState => {
    const provider = providersById.get(defaultProvider);
    const agent = agentsById.get(agentId) ?? agents[0];
    return {
      provider: defaultProvider,
      agentId: agent?.id ?? initialAgentId,
      label: provider && agent ? `${provider.label} for ${agent.name}` : "",
      target: "",
      cred: provider?.credentialEnvHint ?? "",
      // Only pre-check "default" when the agent has no default yet, so saving a
      // second channel doesn't silently demote the agent's existing default.
      defaultForAgent: !hasDefault(agent?.id ?? initialAgentId),
    };
  }, [agents, agentsById, defaultProvider, initialAgentId, providersById, hasDefault]);

  const [draft, setDraft] = useState<DraftState>(() => buildDefault(initialAgentId));
  const [openField, setOpenField] = useState<"provider" | "agent" | null>(null);
  const [provQuery, setProvQuery] = useState("");
  const [agentQuery, setAgentQuery] = useState("");
  const [error, setError] = useState("");
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(buildDefault(initialAgentId));
      setOpenField(null);
      setProvQuery("");
      setAgentQuery("");
      setError("");
    }
    wasOpen.current = open;
  }, [open, initialAgentId, buildDefault]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (openField) setOpenField(null);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openField, onClose]);

  const providerMeta = providersById.get(draft.provider);
  const agent = agentsById.get(draft.agentId);

  const labelMatchesPattern = useCallback((state: DraftState) => {
    const p = providersById.get(state.provider);
    const a = agentsById.get(state.agentId);
    return Boolean(p && a && state.label === `${p.label} for ${a.name}`);
  }, [providersById, agentsById]);

  function pickProvider(id: HiveMessagingProvider) {
    setDraft((current) => {
      const meta = providersById.get(id);
      const relabel = labelMatchesPattern(current);
      const a = agentsById.get(current.agentId);
      return {
        ...current,
        provider: id,
        cred: meta?.credentialEnvHint ?? "",
        label: relabel && meta && a ? `${meta.label} for ${a.name}` : current.label,
      };
    });
    setOpenField(null);
    setProvQuery("");
  }

  function pickAgent(id: string) {
    setDraft((current) => {
      const relabel = labelMatchesPattern(current);
      const a = agentsById.get(id);
      const meta = providersById.get(current.provider);
      return {
        ...current,
        agentId: id,
        label: relabel && meta && a ? `${meta.label} for ${a.name}` : current.label,
        defaultForAgent: !hasDefault(id),
      };
    });
    setOpenField(null);
    setAgentQuery("");
  }

  const filteredProviders = useMemo(() => {
    const q = provQuery.trim().toLowerCase();
    return q ? providers.filter((p) => p.label.toLowerCase().includes(q) || p.id.includes(q)) : providers;
  }, [providers, provQuery]);
  const filteredAgents = useMemo(() => {
    const q = agentQuery.trim().toLowerCase();
    return q ? agents.filter((a) => a.name.toLowerCase().includes(q)) : agents;
  }, [agents, agentQuery]);

  if (!open) return null;

  const envManaged = providerMeta ? providerMeta.credentialKind === "macos-messages" || providerMeta.credentialKind === "hermes-runtime" : false;
  const supports = capabilityLabels(providerMeta);
  const additional = providerMeta?.additionalEnv ?? [];

  function save() {
    if (!providerMeta || !agent) return;
    const target = draft.target.trim();
    if (providerMeta.targetRequired && !target) {
      setError(`${providerMeta.label} needs a target (${providerMeta.targetHint}).`);
      return;
    }
    if (!envManaged && !draft.cred.trim()) {
      setError(`${providerMeta.label} needs a credential env key.`);
      return;
    }
    onSubmit({
      provider: draft.provider,
      agentId: agent.id,
      agentName: agent.name,
      label: draft.label.trim() || `${providerMeta.label} for ${agent.name}`,
      target,
      credentialEnvKey: envManaged ? undefined : draft.cred.trim(),
      defaultForAgent: draft.defaultForAgent,
    });
  }

  return (
    <div className={styles.overlay} onMouseDown={onClose} role="presentation">
      <div
        className={styles.modal}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New messaging channel"
      >
        <div className={styles.modalHead}>
          <div>
            <p className={styles.eyebrow}>Hive messaging</p>
            <h3 className={styles.modalTitle}>New channel</h3>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.modalBody}>
          {/* Provider */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Provider</span>
            <button type="button" className={styles.picker} onClick={() => setOpenField((f) => (f === "provider" ? null : "provider"))} aria-haspopup="listbox" aria-expanded={openField === "provider"}>
              <span className={styles.pickerValue}>
                {providerMeta ? <ProviderTile meta={providerMeta} size="sm" /> : null}
                <span className={styles.pickerName}>{providerMeta?.label ?? "Select a provider"}</span>
              </span>
              <ChevronDown size={16} className={styles.pickerChevron} aria-hidden="true" />
            </button>
            {openField === "provider" ? (
              <div className={styles.menu} role="listbox">
                <div className={styles.menuSearch}>
                  <Search size={15} className={styles.searchIcon} aria-hidden="true" />
                  <input className={cn(styles.input)} style={{ paddingLeft: 32 }} value={provQuery} onChange={(e) => setProvQuery(e.target.value)} placeholder={`Search ${providers.length} platforms…`} autoFocus />
                </div>
                <div className={styles.menuList}>
                  {filteredProviders.map((p) => (
                    <button type="button" key={p.id} className={cn(styles.option, p.id === draft.provider && styles.optionActive)} onClick={() => pickProvider(p.id)} role="option" aria-selected={p.id === draft.provider}>
                      <ProviderTile meta={p} size="sm" />
                      <span className={styles.optionMain}><span className={styles.optionName}>{p.label}</span></span>
                      {p.id === draft.provider ? <Check size={15} className={styles.optionCheck} aria-hidden="true" /> : null}
                    </button>
                  ))}
                  {filteredProviders.length === 0 ? <p className={styles.menuEmpty}>No platform matches.</p> : null}
                </div>
              </div>
            ) : null}
            <p className={styles.supports}>
              <span className={styles.supportsLabel}>Supports</span>
              {supports.length ? supports.join("  ·  ") : "Text only"}
            </p>
          </div>

          {/* Agent */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Agent</span>
            <button type="button" className={styles.picker} onClick={() => setOpenField((f) => (f === "agent" ? null : "agent"))} aria-haspopup="listbox" aria-expanded={openField === "agent"}>
              <span className={styles.pickerValue}>
                {agent ? <BeeHex avatar={agent.avatar} small /> : null}
                <span style={{ minWidth: 0 }}>
                  <span className={styles.pickerName}>{agent?.name ?? "Select an agent"}</span>
                  <span className={styles.pickerSub}>{agent?.sub ?? ""}</span>
                </span>
              </span>
              <ChevronDown size={16} className={styles.pickerChevron} aria-hidden="true" />
            </button>
            {openField === "agent" ? (
              <div className={styles.menu} role="listbox">
                <div className={styles.menuSearch}>
                  <Search size={15} className={styles.searchIcon} aria-hidden="true" />
                  <input className={styles.input} style={{ paddingLeft: 32 }} value={agentQuery} onChange={(e) => setAgentQuery(e.target.value)} placeholder="Search agents…" autoFocus />
                </div>
                <div className={styles.menuList}>
                  {filteredAgents.map((a) => (
                    <button type="button" key={a.id} className={cn(styles.option, a.id === draft.agentId && styles.optionActive)} onClick={() => pickAgent(a.id)} role="option" aria-selected={a.id === draft.agentId}>
                      <BeeHex avatar={a.avatar} small />
                      <span className={styles.optionMain}>
                        <span className={styles.optionName}>{a.name}</span>
                        <span className={styles.optionSub}>{a.sub}</span>
                      </span>
                      {a.id === draft.agentId ? <Check size={15} className={styles.optionCheck} aria-hidden="true" /> : null}
                    </button>
                  ))}
                  {filteredAgents.length === 0 ? <p className={styles.menuEmpty}>No agents match.</p> : null}
                </div>
              </div>
            ) : null}
          </div>

          {/* Label */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Label</span>
            <input className={styles.input} value={draft.label} onChange={(e) => setDraft((c) => ({ ...c, label: e.target.value }))} />
          </label>

          {/* Target */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Target{providerMeta?.targetRequired ? "" : " (optional)"}</span>
            <input className={cn(styles.input, styles.inputMono)} value={draft.target} onChange={(e) => setDraft((c) => ({ ...c, target: e.target.value }))} placeholder={providerMeta?.targetHint ?? ""} />
          </label>

          {/* Credential */}
          {envManaged ? (
            <p className={styles.credNote}>{providerMeta?.docsNote ?? "Delivered without a stored credential."}</p>
          ) : (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Credential env key</span>
              <input className={cn(styles.input, styles.inputMono)} value={draft.cred} onChange={(e) => setDraft((c) => ({ ...c, cred: e.target.value }))} placeholder={providerMeta?.credentialEnvHint ?? ""} />
              {additional.length ? (
                <p className={styles.credNote}>Also set in the hive env: {additional.join(", ")}.{providerMeta?.docsNote ? ` ${providerMeta.docsNote}` : ""}</p>
              ) : providerMeta?.docsNote ? (
                <p className={styles.credNote}>{providerMeta.docsNote}</p>
              ) : null}
            </label>
          )}

          {/* Default */}
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={draft.defaultForAgent} onChange={(e) => setDraft((c) => ({ ...c, defaultForAgent: e.target.checked }))} />
            Default channel for {agent?.name ?? "this agent"}
          </label>
          {draft.defaultForAgent && hasDefault(draft.agentId) ? (
            <p className={styles.credNote}>Replaces {agent?.name ?? "this agent"}&rsquo;s current default channel.</p>
          ) : null}

          {error ? <p className={styles.credNote} style={{ color: "var(--hm-danger)" }}>{error}</p> : null}
        </div>

        <div className={styles.modalActions}>
          <HiveButton type="button" variant="ghost" onClick={onClose}>Cancel</HiveButton>
          <HiveButton type="button" onClick={save} disabled={saving}>
            {saving ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
            Save channel
          </HiveButton>
        </div>
      </div>
    </div>
  );
}
