"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Lock,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";
import type {
  HiveMessagingChannel,
  HiveMessagingDirectoryEntry,
  HiveMessagingProviderMeta,
} from "@/lib/types/messaging-channels";
import {
  BeeHex,
  capabilityLabels,
  channelEndpoint,
  channelRunState,
  deliveryStatusLine,
  Endpoint,
  HiveButton,
  type MessagingAgentOption,
  ProviderTile,
  QUEEN_BEE_AGENT_ID,
  RUN_STATE_META,
  StatusDot,
  toAgentOption,
} from "@/features/dashboard/views/messaging-shared";
import {
  MessagingChannelModal,
  type MessagingChannelDraftPayload,
} from "@/features/dashboard/views/MessagingChannelModal";
import styles from "@/features/dashboard/views/messaging-channels.module.css";

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;

type MessagingChannelsPayload = {
  ok?: boolean;
  error?: string;
  channels?: HiveMessagingChannel[];
  directory?: HiveMessagingDirectoryEntry[];
  providers?: HiveMessagingProviderMeta[];
  settingsFile?: string;
  updatedAt?: string;
};

type MessagingChannelsPanelProps = {
  active: boolean;
  displayAgents: AgentProfile[];
  fleetClass: ClassNameBuilder;
  sharedVault: SharedVaultConfig;
};

type ViewMode = "triage" | "agents";

const BUCKETS: Array<{ title: string; state: HiveMessagingChannel["runState"] }> = [
  { title: "Needs attention", state: "attention" },
  { title: "Live", state: "live" },
  { title: "Active", state: "enabled" },
  { title: "Paused", state: "paused" },
];

export function MessagingChannelsPanel({ active, displayAgents, fleetClass, sharedVault }: MessagingChannelsPanelProps) {
  const [channels, setChannels] = useState<HiveMessagingChannel[]>([]);
  const [providers, setProviders] = useState<HiveMessagingProviderMeta[]>([]);
  const [settingsFile, setSettingsFile] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [view, setView] = useState<ViewMode>("triage");
  const [selectedId, setSelectedId] = useState("");
  const [laneQuery, setLaneQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAgentId, setModalAgentId] = useState(QUEEN_BEE_AGENT_ID);

  const agentOptions = useMemo<MessagingAgentOption[]>(() => {
    const map = new Map<string, MessagingAgentOption>();
    map.set(QUEEN_BEE_AGENT_ID, toAgentOption({ id: QUEEN_BEE_AGENT_ID, name: "Queen Bee", runtime: "hermes", beeRole: "queen" }));
    for (const agent of displayAgents) if (!map.has(agent.id)) map.set(agent.id, toAgentOption(agent));
    return [...map.values()];
  }, [displayAgents]);
  const providersById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);
  const agentsWithDefault = useMemo(
    () => [...new Set(channels.filter((c) => c.defaultForAgent).map((c) => c.agentId))],
    [channels],
  );

  const runtimeAgentPayloads = useMemo(() => displayAgents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    runtime: agent.runtime,
    agentId: agent.agentId,
    localDataDir: agent.localDataDir,
    machineName: agent.machineName,
    telemetryUrl: agent.telemetryUrl,
    collectorCapabilities: agent.collectorCapabilities ? { runtimes: agent.collectorCapabilities.runtimes } : undefined,
  })), [displayAgents]);

  const requestBody = useCallback((extra: Record<string, unknown> = {}) => ({
    vaultPath: sharedVault.vaultPath,
    brainServicesFolder: sharedVault.brainServicesFolder,
    includeRuntimeChannels: true,
    agents: runtimeAgentPayloads,
    ...extra,
  }), [runtimeAgentPayloads, sharedVault.brainServicesFolder, sharedVault.vaultPath]);

  const applyPayload = useCallback((data: MessagingChannelsPayload) => {
    setChannels(data.channels ?? []);
    if (data.providers?.length) setProviders(data.providers);
    setSettingsFile(data.settingsFile ?? "");
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/messaging-channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody({ action: "list" })),
      cache: "no-store",
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as MessagingChannelsPayload | null;
    setLoading(false);
    setLoadedOnce(true);
    if (!response?.ok || !data?.ok) {
      setStatus({ text: data?.error ?? "Could not load messaging channels.", tone: "error" });
      return;
    }
    applyPayload(data);
    setStatus(null);
  }, [requestBody, applyPayload]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [active, refresh]);

  async function saveDraft(payload: MessagingChannelDraftPayload) {
    setBusy("save");
    const response = await fetch("/api/messaging-channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody({
        channel: {
          provider: payload.provider,
          label: payload.label,
          agentId: payload.agentId,
          agentName: payload.agentName,
          enabled: true,
          defaultForAgent: payload.defaultForAgent,
          credentialEnvKey: payload.credentialEnvKey,
          target: { chatId: payload.target },
        },
      })),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as MessagingChannelsPayload | null;
    setBusy("");
    if (!response?.ok || !data?.ok) {
      setStatus({ text: data?.error ?? "Could not save messaging channel.", tone: "error" });
      return;
    }
    applyPayload(data);
    setModalOpen(false);
    const created = (data.channels ?? []).find(
      (channel) => channel.agentId === payload.agentId && channel.provider === payload.provider && channel.label === payload.label,
    );
    if (created) {
      setSelectedId(created.id);
      setView("triage");
    }
    setStatus({ text: `${payload.label} saved.`, tone: "info" });
  }

  async function patchChannel(channel: HiveMessagingChannel, patch: Partial<HiveMessagingChannel>, key: string) {
    setBusy(key);
    const response = await fetch("/api/messaging-channels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody({ channel: { ...channel, ...patch } })),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as MessagingChannelsPayload | null;
    setBusy("");
    if (!response?.ok || !data?.ok) {
      setStatus({ text: data?.error ?? "Could not update messaging channel.", tone: "error" });
      return;
    }
    applyPayload(data);
    setStatus({ text: `${channel.label} updated.`, tone: "info" });
  }

  async function deleteChannel(channel: HiveMessagingChannel) {
    if (typeof window !== "undefined" && !window.confirm(`Remove “${channel.label}”? You can add it again later.`)) return;
    setBusy(`del:${channel.id}`);
    const response = await fetch("/api/messaging-channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody({ id: channel.id })),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as MessagingChannelsPayload | null;
    setBusy("");
    if (!response?.ok || !data?.ok) {
      setStatus({ text: data?.error ?? "Could not delete messaging channel.", tone: "error" });
      return;
    }
    applyPayload(data);
    setStatus({ text: `${channel.label} removed.`, tone: "info" });
  }

  async function testChannel(channel: HiveMessagingChannel) {
    setBusy(`test:${channel.id}`);
    const response = await fetch("/api/messaging-channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody({
        action: "test",
        channelId: channel.id,
        message: `HivemindOS delivery test from ${channel.agentName} via ${channel.label}.`,
      })),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string; result?: { message?: string } } | null;
    setBusy("");
    if (!response?.ok || !data?.ok) {
      setStatus({ text: data?.error ?? "Could not send test message.", tone: "error" });
      void refresh();
      return;
    }
    setStatus({ text: data.result?.message ?? "Test message sent.", tone: "info" });
    void refresh();
  }

  function openAdd(agentId: string) {
    setModalAgentId(agentId);
    setModalOpen(true);
  }

  if (!active) return null;

  // Derived effective selection: keep the user's pick while it exists, else fall
  // back to the first channel that needs attention, else the first channel.
  const effectiveSelectedId = channels.some((channel) => channel.id === selectedId)
    ? selectedId
    : (channels.find((channel) => channelRunState(channel) === "attention") ?? channels[0])?.id ?? "";
  const selected = channels.find((channel) => channel.id === effectiveSelectedId) ?? null;
  const stats = {
    active: channels.filter((c) => { const s = channelRunState(c); return s === "live" || s === "enabled"; }).length,
    paused: channels.filter((c) => channelRunState(c) === "paused").length,
    attention: channels.filter((c) => channelRunState(c) === "attention").length,
  };
  const groups = BUCKETS
    .map((bucket) => ({ ...bucket, items: channels.filter((c) => channelRunState(c) === bucket.state) }))
    .filter((group) => group.items.length > 0);

  const laneQ = laneQuery.trim().toLowerCase();
  const laneAgents = laneQ
    ? agentOptions.filter((agent) => agent.name.toLowerCase().includes(laneQ))
    : agentOptions.filter((agent) => agent.isQueen || channels.some((c) => c.agentId === agent.id));
  const withChannels = agentOptions.filter((agent) => channels.some((c) => c.agentId === agent.id)).length;
  const laneHint = laneQ
    ? `${laneAgents.length} match${laneAgents.length === 1 ? "" : "es"} of ${agentOptions.length} agents`
    : `${withChannels} of ${agentOptions.length} agents have a direct channel · search to reach the rest`;

  const showSkeleton = loading && !loadedOnce;

  return (
    <section className={`${fleetClass("tabPanel")} ${styles.root}`}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Hive messaging</p>
          <h2 className={styles.title}>Messaging channels</h2>
          <p className={styles.subtitle}>Queen Bee is the default handoff. Give worker agents their own channel when it should bypass orchestration.</p>
        </div>
        <div className={styles.headerActions}>
          <HiveButton type="button" variant="ghost" size="iconSm" onClick={() => void refresh()} disabled={loading} aria-label="Refresh channels" title="Refresh">
            <RefreshCcw aria-hidden="true" className={loading ? "animate-spin" : undefined} />
          </HiveButton>
          <div className={styles.segmented} role="tablist" aria-label="Messaging view">
            <button type="button" role="tab" aria-selected={view === "triage"} className={cn(styles.segItem, view === "triage" && styles.segItemActive)} onClick={() => setView("triage")}>Triage</button>
            <button type="button" role="tab" aria-selected={view === "agents"} className={cn(styles.segItem, view === "agents" && styles.segItemActive)} onClick={() => setView("agents")}>By agent</button>
          </div>
          <HiveButton type="button" onClick={() => openAdd(view === "agents" ? QUEEN_BEE_AGENT_ID : (selected?.agentId ?? QUEEN_BEE_AGENT_ID))} disabled={providers.length === 0}>
            <Plus aria-hidden="true" />
            New channel
          </HiveButton>
        </div>
      </div>

      {channels.length ? (
        <div className={styles.statsRow}>
          <span className={styles.stat} data-tone="live"><span className={styles.statDot} />{stats.active} active</span>
          <span className={styles.stat} data-tone="paused"><span className={styles.statDot} />{stats.paused} paused</span>
          <span className={styles.stat} data-tone="attention"><span className={styles.statDot} />{stats.attention} needs a key</span>
        </div>
      ) : null}

      {status ? <p className={styles.statusBanner} data-tone={status.tone} role="status">{status.text}</p> : null}

      <div className={styles.divider} />

      {view === "triage" ? (
        <TriageView
          showSkeleton={showSkeleton}
          groups={groups}
          channels={channels}
          selected={selected}
          selectedId={effectiveSelectedId}
          providersById={providersById}
          settingsFile={settingsFile}
          busy={busy}
          onSelect={setSelectedId}
          onTest={testChannel}
          onToggle={(channel) => void patchChannel(channel, { enabled: !channel.enabled }, channel.id)}
          onSetDefault={(channel) => void patchChannel(channel, { defaultForAgent: true }, channel.id)}
          onDelete={deleteChannel}
          onOpenAdd={() => openAdd(QUEEN_BEE_AGENT_ID)}
        />
      ) : (
        <AgentsView
          laneQuery={laneQuery}
          onLaneQuery={setLaneQuery}
          laneHint={laneHint}
          laneAgents={laneAgents}
          channels={channels}
          providersById={providersById}
          onOpenAdd={openAdd}
        />
      )}

      <p className={styles.footNote}>
        <Lock size={13} aria-hidden="true" />
        Tailnet-only · credentials stored locally · nothing exposed on a public port
      </p>

      <MessagingChannelModal
        open={modalOpen}
        providers={providers}
        agents={agentOptions}
        initialAgentId={modalAgentId}
        agentsWithDefault={agentsWithDefault}
        saving={busy === "save"}
        onClose={() => setModalOpen(false)}
        onSubmit={(payload) => void saveDraft(payload)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Triage view
// ---------------------------------------------------------------------------

type TriageProps = {
  showSkeleton: boolean;
  groups: Array<{ title: string; items: HiveMessagingChannel[] }>;
  channels: HiveMessagingChannel[];
  selected: HiveMessagingChannel | null;
  selectedId: string;
  providersById: Map<string, HiveMessagingProviderMeta>;
  settingsFile: string;
  busy: string;
  onSelect: (id: string) => void;
  onTest: (channel: HiveMessagingChannel) => void;
  onToggle: (channel: HiveMessagingChannel) => void;
  onSetDefault: (channel: HiveMessagingChannel) => void;
  onDelete: (channel: HiveMessagingChannel) => void;
  onOpenAdd: () => void;
};

function TriageView(props: TriageProps) {
  const { showSkeleton, groups, channels, selected, selectedId, providersById, settingsFile, busy } = props;

  return (
    <div className={styles.triage}>
      <div className={styles.directory}>
        {showSkeleton ? (
          <div className={styles.rows} role="status" aria-label="Loading messaging channels">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className={styles.skelRow} />)}
          </div>
        ) : channels.length === 0 ? (
          <button type="button" className={styles.addTile} onClick={props.onOpenAdd} style={{ minHeight: 160 }}>
            <span className={styles.addTileIcon}><Plus aria-hidden="true" /></span>
            <span className={styles.addTileTitle}>New channel</span>
            <span className={styles.addTileHint}>Telegram, Discord, Slack, Matrix, a webhook, and more</span>
          </button>
        ) : (
          <>
            {groups.map((group) => (
              <div className={styles.group} key={group.title}>
                <div className={styles.groupHead}>
                  <span className={styles.groupTitle}>{group.title}</span>
                  <span className={styles.groupCount}>{group.items.length}</span>
                  <span className={styles.groupRule} />
                </div>
                <div className={styles.rows}>
                  {group.items.map((channel) => {
                    const meta = providersById.get(channel.provider);
                    const runState = channelRunState(channel);
                    return (
                      <button type="button" key={channel.id} className={cn(styles.row, channel.id === selectedId && styles.rowActive)} onClick={() => props.onSelect(channel.id)}>
                        <StatusDot tone={runState} />
                        {meta ? <ProviderTile meta={meta} size="sm" /> : null}
                        <span className={styles.rowMain}>
                          <span className={styles.rowLabel} title={channel.label}>{channel.label}</span>
                          <span className={styles.rowSub}>{channel.agentName}</span>
                        </span>
                        {channel.defaultForAgent ? <Star size={12} className={styles.star} fill="currentColor" aria-label="Default" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {settingsFile ? <p className={styles.pathNote}>{settingsFile}</p> : null}
          </>
        )}
      </div>

      {showSkeleton ? (
        <div className={styles.skelInspector} aria-hidden="true" />
      ) : selected ? (
        <Inspector
          channel={selected}
          meta={providersById.get(selected.provider)}
          busy={busy}
          onTest={props.onTest}
          onToggle={props.onToggle}
          onSetDefault={props.onSetDefault}
          onDelete={props.onDelete}
        />
      ) : (
        <div className={styles.emptyInspector}>Add a channel to start routing agent messages.</div>
      )}
    </div>
  );
}

type InspectorProps = {
  channel: HiveMessagingChannel;
  meta?: HiveMessagingProviderMeta;
  busy: string;
  onTest: (channel: HiveMessagingChannel) => void;
  onToggle: (channel: HiveMessagingChannel) => void;
  onSetDefault: (channel: HiveMessagingChannel) => void;
  onDelete: (channel: HiveMessagingChannel) => void;
};

function Inspector({ channel, meta, busy, onTest, onToggle, onSetDefault, onDelete }: InspectorProps) {
  const runState = channelRunState(channel);
  const runMeta = RUN_STATE_META[runState];
  const caps = capabilityLabels(meta);
  const delivery = deliveryStatusLine(channel);
  const sourceText = channel.readOnly
    ? `Bridged from Hermes${channel.source?.machineName ? ` · ${channel.source.machineName}` : ""}`
    : "Configured here";
  const testing = busy === `test:${channel.id}`;
  const rowBusy = busy === channel.id;

  return (
    <div className={styles.inspector}>
      <div className={styles.inspectorHead}>
        <div className={styles.inspectorId}>
          {meta ? <ProviderTile meta={meta} size="lg" /> : null}
          <div style={{ minWidth: 0 }}>
            <p className={styles.inspectorKicker}>{meta?.label ?? channel.provider} · {channel.agentName}</p>
            <h3 className={styles.inspectorTitle}>{channel.label}</h3>
          </div>
        </div>
        <span className={styles.badge} data-tone={runMeta.tone}>{runMeta.text}</span>
      </div>

      <Endpoint value={channelEndpoint(channel)} />

      <div className={styles.metaGrid}>
        <div className={styles.metaCell}>
          <p className={styles.metaLabel}>Owner</p>
          <p className={styles.metaValue}>{channel.agentName}</p>
        </div>
        <div className={styles.metaCell}>
          <p className={styles.metaLabel}>Default for agent</p>
          <p className={styles.metaValue}>{channel.defaultForAgent ? "Yes" : "No"}</p>
        </div>
        <div className={styles.metaCell}>
          <p className={styles.metaLabel}>Credential</p>
          <p className={styles.metaValueMono}>{channel.credentialLabel ?? meta?.credentialEnvHint ?? "—"}</p>
        </div>
        <div className={styles.metaCell}>
          <p className={styles.metaLabel}>Source</p>
          <p className={styles.metaValue}>{sourceText}</p>
        </div>
      </div>

      <div className={styles.capsBlock}>
        <p className={styles.metaLabel}>Platform capabilities</p>
        <div className={styles.caps}>
          {caps.length ? caps.map((cap) => <span key={cap} className={styles.capChip}>{cap}</span>) : <span className={cn(styles.capChip, styles.capChipMuted)}>Text only</span>}
        </div>
      </div>

      <div className={styles.testCard}>
        <div style={{ minWidth: 0 }}>
          <p className={styles.metaLabel}>Delivery test</p>
          <span className={styles.statusLine}><StatusDot tone={delivery.tone} /><span>{delivery.text}</span></span>
        </div>
        <HiveButton type="button" variant="secondary" size="sm" onClick={() => onTest(channel)} disabled={Boolean(busy)}>
          {testing ? <RefreshCcw aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
          Send test
        </HiveButton>
      </div>

      {channel.readOnly ? (
        <p className={styles.credNote}>Bridged from the Hermes runtime — pause, default, and removal are managed in Hermes.</p>
      ) : (
        <div className={styles.actions}>
          <HiveButton type="button" variant="secondary" size="sm" onClick={() => onToggle(channel)} disabled={rowBusy}>
            <Zap aria-hidden="true" />
            {channel.enabled ? "Pause" : "Enable"}
          </HiveButton>
          <HiveButton type="button" variant="outline" size="sm" onClick={() => onSetDefault(channel)} disabled={rowBusy || channel.defaultForAgent}>
            <Star aria-hidden="true" />
            Set default
          </HiveButton>
          <span className={styles.spacer} />
          <HiveButton type="button" variant="ghost" size="iconSm" onClick={() => onDelete(channel)} disabled={busy === `del:${channel.id}`} aria-label="Delete channel" title="Delete channel">
            <Trash2 aria-hidden="true" style={{ color: "var(--hm-danger)" }} />
          </HiveButton>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// By-agent view
// ---------------------------------------------------------------------------

type AgentsProps = {
  laneQuery: string;
  onLaneQuery: (value: string) => void;
  laneHint: string;
  laneAgents: MessagingAgentOption[];
  channels: HiveMessagingChannel[];
  providersById: Map<string, HiveMessagingProviderMeta>;
  onOpenAdd: (agentId: string) => void;
};

function AgentsView({ laneQuery, onLaneQuery, laneHint, laneAgents, channels, providersById, onOpenAdd }: AgentsProps) {
  return (
    <div className={styles.lanesWrap}>
      <div className={styles.laneSearch}>
        <div className={styles.searchBox}>
          <Search size={15} className={styles.searchIcon} aria-hidden="true" />
          <input className={styles.searchInput} value={laneQuery} onChange={(e) => onLaneQuery(e.target.value)} placeholder="Search agents…" />
        </div>
        <span className={styles.laneHint}>{laneHint}</span>
      </div>
      {laneAgents.map((agent) => {
        const laneChannels = channels.filter((channel) => channel.agentId === agent.id);
        return (
          <div key={agent.id} className={cn(styles.lane, agent.isQueen && styles.laneQueen)}>
            <div className={styles.laneAgent}>
              <div className={styles.laneAgentTop}>
                <BeeHex avatar={agent.avatar} />
                <div style={{ minWidth: 0 }}>
                  <p className={styles.laneName}>{agent.name}</p>
                  <p className={styles.laneSub}>{agent.sub}</p>
                </div>
              </div>
              {agent.isQueen ? <span className={styles.badge} data-tone="enabled">Default handoff</span> : null}
            </div>
            <div className={styles.laneChannels}>
              {laneChannels.map((channel) => {
                const meta = providersById.get(channel.provider);
                const runState = channelRunState(channel);
                return (
                  <div key={channel.id} className={styles.chip} data-tone={runState}>
                    {meta ? <span className={styles.chipRail} style={{ ["--tile" as string]: meta.color }} /> : null}
                    {meta ? <ProviderTile meta={meta} size="sm" /> : null}
                    <div className={styles.chipMain}>
                      <div className={styles.chipLabelRow}>
                        <span className={styles.chipLabel} title={channel.label}>{channel.label}</span>
                        {channel.defaultForAgent ? <Star size={11} className={styles.star} fill="currentColor" aria-label="Default" /> : null}
                      </div>
                      <span className={styles.chipAddr} title={channelEndpoint(channel)}>{channelEndpoint(channel)}</span>
                    </div>
                    <StatusDot tone={runState} />
                  </div>
                );
              })}
              <button type="button" className={styles.addChip} onClick={() => onOpenAdd(agent.id)}>
                <Plus size={15} aria-hidden="true" />
                Add channel
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
