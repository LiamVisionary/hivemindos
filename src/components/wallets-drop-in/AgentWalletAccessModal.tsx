"use client";

import { useMemo, useState } from "react";
import { Check, LoaderCircle, Plus, Search, ShieldCheck, X } from "lucide-react";

import type { AgentWalletAgentPermissions, AgentWalletPermissionMode } from "@/lib/types/agent-wallet";
import type { WalletAgentOption } from "./wallet-data";

import styles from "./AgentWalletAccessModal.module.css";

type AgentWalletAccessModalProps = {
  agents: WalletAgentOption[];
  initialPermissions?: AgentWalletAgentPermissions;
  title?: string;
  onClose: () => void;
  onSave: (permissions: AgentWalletAgentPermissions) => void | Promise<void>;
};

export type CreateAgentWalletInput = {
  name: string;
  network: string;
  agentPermissions: AgentWalletAgentPermissions;
};

type CreateAgentWalletModalProps = {
  agents: WalletAgentOption[];
  onClose: () => void;
  onCreate: (input: CreateAgentWalletInput) => Promise<unknown> | unknown;
};

const PERMISSION_COPY: Record<AgentWalletPermissionMode, { label: string; detail: string }> = {
  "approval-required": {
    label: "Ask for approval",
    detail: "The agent can use this wallet, but every money-moving action needs approval.",
  },
  autonomous: {
    label: "Autonomous within limits",
    detail: "The agent can spend without asking while the wallet is on and its caps are respected.",
  },
};

function clonePermissions(value?: AgentWalletAgentPermissions): AgentWalletAgentPermissions {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([agentId]) => agentId.trim()));
}

export function AgentWalletAccessModal({ agents, initialPermissions, title = "Agent access", onClose, onSave }: AgentWalletAccessModalProps) {
  const [permissions, setPermissions] = useState<AgentWalletAgentPermissions>(() => clonePermissions(initialPermissions));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const shownAgents = useMemo(() => agents.filter((agent) => !normalizedQuery || `${agent.name} ${agent.runtime} ${agent.machineName}`.toLowerCase().includes(normalizedQuery)), [agents, normalizedQuery]);
  const selectedCount = Object.keys(permissions).length;

  const toggleAgent = (agentId: string) => {
    setPermissions((current) => {
      const next = { ...current };
      if (next[agentId]) delete next[agentId];
      else next[agentId] = "approval-required";
      return next;
    });
  };

  const setPermission = (agentId: string, mode: AgentWalletPermissionMode) => {
    setPermissions((current) => ({ ...current, [agentId]: mode }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(permissions);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Wallet permissions</span>
            <h2>{title}</h2>
            <p>Only attached agents can use this wallet. Set each agent&apos;s approval level independently.</p>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} disabled={saving} aria-label="Close"><X aria-hidden="true" /></button>
        </header>

        <label className={styles.search}>
          <Search aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents" autoFocus />
        </label>

        <div className={styles.toolbar}>
          <span>{selectedCount} agent{selectedCount === 1 ? "" : "s"} attached</span>
          <button type="button" onClick={() => setPermissions({})} disabled={!selectedCount || saving}>Clear all</button>
        </div>

        <div className={styles.agentList}>
          {shownAgents.length ? shownAgents.map((agent) => {
            const mode = permissions[agent.id];
            const selected = Boolean(mode);
            return (
              <article key={agent.id} className={styles.agentRow} data-selected={selected ? "true" : undefined}>
                <button type="button" className={styles.agentIdentity} onClick={() => toggleAgent(agent.id)} aria-pressed={selected}>
                  <span className={styles.check}>{selected ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}</span>
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{agent.runtime} · {agent.machineName}</small>
                  </span>
                </button>
                {selected ? (
                  <label className={styles.permissionField}>
                    <span>Permission</span>
                    <select value={mode} onChange={(event) => setPermission(agent.id, event.target.value as AgentWalletPermissionMode)}>
                      {Object.entries(PERMISSION_COPY).map(([value, copy]) => <option key={value} value={value}>{copy.label}</option>)}
                    </select>
                    <small>{PERMISSION_COPY[mode].detail}</small>
                  </label>
                ) : null}
              </article>
            );
          }) : <p className={styles.empty}>No agents match that search.</p>}
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={styles.primaryButton} onClick={() => void save()} disabled={saving}>
            {saving ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
            Save access
          </button>
        </footer>
      </section>
    </div>
  );
}

export function CreateAgentWalletModal({ agents, onClose, onCreate }: CreateAgentWalletModalProps) {
  const [name, setName] = useState("");
  const [network, setNetwork] = useState("eip155:8453");
  const [permissions, setPermissions] = useState<AgentWalletAgentPermissions>({});
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const selectedNames = agents.filter((agent) => permissions[agent.id]).map((agent) => agent.name);

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      await onCreate({
        name: name.trim() || "Agent wallet",
        network,
        agentPermissions: permissions,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the wallet.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) onClose(); }}>
        <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Create agent wallet">
          <header className={styles.header}>
            <div>
              <span className={styles.eyebrow}>New governed wallet</span>
              <h2>Create agent wallet</h2>
              <p>Create a wallet first, then let any number of agents use it under separate permissions.</p>
            </div>
            <button type="button" className={styles.iconButton} onClick={onClose} disabled={creating} aria-label="Close"><X aria-hidden="true" /></button>
          </header>

          <div className={styles.form}>
            <label>
              <span>Wallet name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Research treasury" autoFocus />
            </label>
            <label>
              <span>Network</span>
              <select value={network} onChange={(event) => setNetwork(event.target.value)}>
                <option value="eip155:8453">Base mainnet</option>
                <option value="eip155:4663">Robinhood Chain</option>
                <option value="solana:mainnet">Solana mainnet</option>
                <option value="eip155:84532">Base Sepolia</option>
                <option value="solana:devnet">Solana devnet</option>
              </select>
            </label>
            <button type="button" className={styles.selectorButton} onClick={() => setSelectorOpen(true)}>
              <span>
                <strong>Attached agents</strong>
                <small>{selectedNames.length ? selectedNames.join(", ") : "No agents attached yet"}</small>
              </span>
              <span>{selectedNames.length} selected</span>
            </button>
            {error ? <p className={styles.error}>{error}</p> : null}
          </div>

          <footer className={styles.footer}>
            <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={creating}>Cancel</button>
            <button type="button" className={styles.primaryButton} onClick={() => void create()} disabled={creating}>
              {creating ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <Plus aria-hidden="true" />}
              Create wallet
            </button>
          </footer>
        </section>
      </div>
      {selectorOpen ? (
        <AgentWalletAccessModal
          agents={agents}
          initialPermissions={permissions}
          title="Choose agents"
          onClose={() => setSelectorOpen(false)}
          onSave={setPermissions}
        />
      ) : null}
    </>
  );
}
