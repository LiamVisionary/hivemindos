"use client";

/* Copy-trading control surface inside the Trade desk. Lists every per-wallet /
   per-chain config (so configs on a previously-acting wallet stay visible and
   keep running), lets you start/stop/delete any of them, and adds new configs
   scoped to the CURRENT acting wallet + chain. Simple settings are shown
   outright; the rest hide under "Advanced". All execution happens server-side in
   the standalone engine — this panel only reads/writes config via
   /api/trading/copy-trade and reflects the engine's live status. */

import React from "react";
import { flushSync } from "react-dom";
import { Badge, BBtn } from "./primitives";
import { BIcon } from "./icons";
import { useVisibilityAwarePolling } from "@/features/dashboard/hooks/use-visibility-aware-polling";
import { paperPortfolioSummary, type PaperPortfolioSummary } from "@/lib/services/copy-trading/paper";
import { compareCopyTradeEvolution, type CopyTradeEvolutionComparison } from "@/lib/services/copy-trading/evolution";
import styles from "./CopyTradingPanel.module.css";
import {
  MAX_COPY_TRADE_USD,
  copyTradeNetworkLabel,
  defaultCopyTradingConfig,
  isCopyTradeNetwork,
  type CopyTradeEvent,
  type CopyTradeEngineStatus,
  type CopyTradeFundable,
  type CopyTradeNetwork,
  type CopyTradeRuntimeState,
  type CopyTradingConfig,
} from "@/lib/types/copy-trading";

type Props = {
  agentId: string;
  walletShort: string;
  walletAddress: string;
  walletKind: string;
  custody: string;
  network: string;
  walletChains: Array<{ key: string; label: string; network: string; accountId: string }>;
  onSelectChain: (network: string) => void;
  onOpenView: (view: string) => void;
};

type Snapshot = {
  configs: CopyTradingConfig[];
  states: Record<string, CopyTradeRuntimeState>;
  engine: CopyTradeEngineStatus | null;
  online: boolean;
  fundable: Record<string, CopyTradeFundable>;
};

type DaemonServiceStatus = {
  installed: boolean;
  running: boolean;
  detail?: string;
};

type ApiResult = { ok: boolean; error?: string; config?: CopyTradingConfig };
async function api(body: unknown): Promise<ApiResult> {
  const res = await fetch("/api/trading/copy-trade", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => null);
  if (!res) return { ok: false, error: "Network error." };
  return (await res.json().catch(() => ({ ok: false, error: "Bad response." }))) as ApiResult;
}

type ServiceResult = { ok: boolean; error?: string; service?: DaemonServiceStatus };

function configViewTransitionName(configId: string): string {
  return `copy-trading-config-${configId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

async function readCopyTradingService(signal?: AbortSignal): Promise<DaemonServiceStatus | null> {
  const res = await fetch("/api/fleet/apps/installable-services?id=copy-trading-daemon", {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal,
  }).catch(() => null);
  if (!res) return null;
  const data = (await res.json().catch(() => null)) as ServiceResult | null;
  return data?.ok && data.service ? data.service : null;
}

async function installCopyTradingService(): Promise<ServiceResult> {
  const res = await fetch("/api/fleet/apps/installable-services", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ id: "copy-trading-daemon", action: "install" }),
    cache: "no-store",
  }).catch(() => null);
  if (!res) return { ok: false, error: "Network error." };
  return (await res.json().catch(() => ({ ok: false, error: "Bad response." }))) as ServiceResult;
}

export function CopyTradingPanel(props: Props) {
  const { agentId, walletShort, walletAddress, walletKind, custody, network, walletChains, onSelectChain } = props;
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [daemonService, setDaemonService] = React.useState<DaemonServiceStatus | null>(null);
  const [draft, setDraft] = React.useState<CopyTradingConfig | null>(null);
  const [showAdv, setShowAdv] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [daemonBusy, setDaemonBusy] = React.useState(false);
  const [daemonError, setDaemonError] = React.useState("");
  const [error, setError] = React.useState("");
  const [returningConfigId, setReturningConfigId] = React.useState<string | null>(null);
  const [isClosingDraft, setIsClosingDraft] = React.useState(false);

  const supported = isCopyTradeNetwork(network);
  const canSign = walletKind !== "bankr" && !/watch[\s-]?only/i.test(custody);
  const supportedChains = walletChains.filter((c) => isCopyTradeNetwork(c.network));
  const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const supportsViewTransitions = typeof document !== "undefined" && "startViewTransition" in document && !prefersReducedMotion;

  const swapConfigView = React.useCallback((update: () => void) => {
    if (!supportsViewTransitions) {
      update();
      return;
    }
    document.startViewTransition(() => flushSync(update));
  }, [supportsViewTransitions]);

  const refresh = React.useCallback(async (signal?: AbortSignal) => {
    const [res, service] = await Promise.all([
      fetch("/api/trading/copy-trade", { headers: { accept: "application/json" }, cache: "no-store", signal }).catch(() => null),
      readCopyTradingService(signal),
    ]);
    if (service) setDaemonService(service);
    if (!res) return;
    const data = (await res.json().catch(() => null)) as ({ ok: boolean } & Snapshot) | null;
    if (data?.ok) setSnap({ configs: data.configs ?? [], states: data.states ?? {}, engine: data.engine ?? null, online: Boolean(data.online), fundable: data.fundable ?? {} });
  }, []);

  // Poll status while the tab is visible (paused when hidden) — also does the
  // initial load. Manual refresh() runs after every mutation below.
  useVisibilityAwarePolling({ enabled: true, intervalMs: 5_000, hiddenIntervalMs: null, task: (signal) => refresh(signal) });

  const startNew = () => {
    if (!isCopyTradeNetwork(network)) return;
    setError("");
    setShowAdv(false);
    setReturningConfigId(null);
    setIsClosingDraft(false);
    setDraft(defaultCopyTradingConfig({ id: "", agentId, walletAddress, network }));
  };

  const duplicateConfig = (source: CopyTradingConfig) => {
    if (!isCopyTradeNetwork(network)) return;
    const now = Date.now();
    const sourceLabel = source.label?.replace(/\s*·\s*Agent analyzed\s*$/i, "").trim();
    setError("");
    setShowAdv(false);
    setReturningConfigId(null);
    setIsClosingDraft(false);
    setDraft({
      ...source,
      id: "",
      label: sourceLabel ? `${sourceLabel} copy` : "Copy trader",
      agentId,
      walletAddress,
      network,
      enabled: true,
      dryRun: true,
      evolution: undefined,
      createdAt: now,
      updatedAt: now,
    });
  };

  const editConfig = (config: CopyTradingConfig) => {
    swapConfigView(() => {
      setError("");
      setShowAdv(false);
      setReturningConfigId(null);
      setIsClosingDraft(false);
      setDraft({ ...config });
    });
  };

  const finishCloseDraft = (configId: string | null) => {
    setReturningConfigId(configId);
    setIsClosingDraft(false);
    setDraft(null);
    setError("");
  };

  const closeDraft = () => {
    const configId = draft?.id || null;
    if (!configId) {
      finishCloseDraft(null);
      return;
    }
    if (supportsViewTransitions) {
      swapConfigView(() => finishCloseDraft(configId));
      return;
    }
    if (prefersReducedMotion) {
      finishCloseDraft(configId);
      return;
    }
    setIsClosingDraft(true);
  };

  const save = async () => {
    if (!draft) return;
    setBusy("save");
    setError("");
    const res = await api({ action: "upsert", config: { ...draft, agentId, walletAddress, network } });
    setBusy(null);
    if (!res.ok) { setError(res.error || "Could not save."); return; }
    closeDraft();
    await refresh();
  };

  const act = async (action: "start" | "stop" | "delete" | "evolve", id: string) => {
    setBusy(`${action}:${id}`);
    const res = await api({ action, id });
    setBusy(null);
    if (!res.ok) { setError(res.error || "Action failed."); return; }
    await refresh();
  };

  const installDaemon = async () => {
    setDaemonBusy(true);
    setDaemonError("");
    const res = await installCopyTradingService();
    setDaemonBusy(false);
    if (!res.ok) {
      setDaemonError(res.error || "Could not install the copy-trading service.");
      return;
    }
    if (res.service) setDaemonService(res.service);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await refresh();
  };

  const configs = snap?.configs ?? [];
  const mine = configs.filter((c) => c.agentId === agentId && c.network === network);
  const others = configs.filter((c) => !(c.agentId === agentId && c.network === network));
  const daemonReady = Boolean(snap && (snap.online || daemonService?.installed));
  const waitingForSnapshot = !snap;
  const draftForm = draft ? (
    <div
      className={!supportsViewTransitions && !prefersReducedMotion ? styles.editSwapFallback : undefined}
      data-closing={isClosingDraft ? "true" : undefined}
      data-transition-state={supportsViewTransitions ? "shared-element" : prefersReducedMotion ? "reduced-motion" : isClosingDraft ? "closing" : "opening"}
      style={{ viewTransitionName: configViewTransitionName(draft.id || "new") }}
      onAnimationEnd={(event) => {
        if (isClosingDraft && event.currentTarget === event.target) finishCloseDraft(draft.id || null);
      }}
    >
      <ConfigForm
        draft={draft}
        setDraft={setDraft}
        showAdv={showAdv}
        setShowAdv={setShowAdv}
        busy={busy === "save"}
        error={error}
        onSave={save}
        onCancel={closeDraft}
      />
    </div>
  ) : null;

  return (
    <div className={styles.wrap}>
      <EngineStatus snap={snap} service={daemonService} installing={daemonBusy} error={daemonError} onInstall={installDaemon} />

      {!daemonReady ? (
        waitingForSnapshot ? null : <DaemonSetupGate installing={daemonBusy} />
      ) : !supported ? (
        <div className={styles.gate}>
          <b>Copy trading runs on Base or Solana.</b> The acting wallet is on a different chain.
          {supportedChains.length ? (
            <div className={styles.chainBtns}>
              {supportedChains.map((c) => (
                <BBtn key={c.network} variant="ghost" sm onClick={() => onSelectChain(c.network)}>
                  Switch to {copyTradeNetworkLabel(c.network as CopyTradeNetwork)}
                </BBtn>
              ))}
            </div>
          ) : (
            <p style={{ margin: "8px 0 0", fontSize: 11.5 }}>This wallet holds no Base or Solana account.</p>
          )}
        </div>
      ) : !canSign ? (
        <div className={styles.gate}>
          <b>Copy trading needs a local-signer wallet.</b> {walletShort} is {walletKind === "bankr" ? "Bankr-managed" : "watch-only"}, so it can&apos;t sign mirror swaps. Pick a wallet you hold the keys for.
        </div>
      ) : (
        <>
          <div>
            <div className={styles.sectionLbl}>
              {walletShort} · {copyTradeNetworkLabel(network as CopyTradeNetwork)}
            </div>
            <ConfigList
              list={mine}
              states={snap?.states ?? {}}
              fundable={snap?.fundable ?? {}}
              online={snap?.online ?? false}
              busy={busy}
              onEdit={editConfig}
              onAct={act}
              onDuplicate={duplicateConfig}
              canDuplicate
              editView={draft?.id ? { configId: draft.id, content: draftForm } : undefined}
              returningConfigId={!supportsViewTransitions && !prefersReducedMotion ? returningConfigId : null}
              emptyText="No copy configs on this wallet + chain yet."
            />
          </div>

          {draft ? (
            draft.id ? null : draftForm
          ) : (
            <BBtn variant="primary" sm onClick={startNew}>
              <BIcon name="plus" size={14} /> Add copy config
            </BBtn>
          )}
        </>
      )}

      {daemonReady && others.length ? (
        <div>
          <div className={styles.sectionLbl}>Other wallets &amp; chains</div>
          <ConfigList
            list={others}
            states={snap?.states ?? {}}
            fundable={snap?.fundable ?? {}}
            online={snap?.online ?? false}
            busy={busy}
            onEdit={undefined}
            onAct={act}
            foreign
            emptyText=""
          />
        </div>
      ) : null}

      {daemonReady && error && !draft ? <p className={styles.err}>{error}</p> : null}

      {daemonReady ? (
        <p className={styles.cap}>
          Mirrors run server-side, capped at ${MAX_COPY_TRADE_USD}/swap with your wallet&apos;s spend governance. New configs
          start in <b>dry-run</b> (paper-trade with simulated cash — real fills, no real spend) until you turn it off.
          Switching the acting wallet does not stop a running config.
        </p>
      ) : null}
    </div>
  );
}

function EngineStatus(props: { snap: Snapshot | null; service: DaemonServiceStatus | null; installing: boolean; error: string; onInstall: () => void }) {
  const { snap, service } = props;
  if (!snap && !service) {
    return (
      <div className={`${styles.status} ${styles.statusOff}`}>
        <BIcon name="spinner" size={14} spin />
        <span className={styles.statusText}>Checking copy-trading service status.</span>
      </div>
    );
  }
  if (snap?.online && snap.engine) {
    return null;
  }
  const installed = Boolean(service?.installed);
  const buttonLabel = props.installing ? "Installing..." : installed ? "Restart service" : "Install service";
  const detail = props.installing
    ? "Installing the copy-trading service — config controls will appear after setup finishes."
    : installed
      ? "Copy-trading service installed, but no fresh daemon heartbeat is available yet. Configs can be edited, but they won't run until the daemon starts."
      : "Background engine offline — install the service before creating copy configs. You can still run the foreground daemon for logs.";
  return (
    <>
      <div className={`${styles.status} ${styles.statusOff}`}>
        <span className={styles.statusDot} />
        <span className={styles.statusText}>{detail} <span className={styles.statusCmd}>pnpm copy-trading:daemon</span></span>
        <BBtn variant="primary" sm disabled={props.installing} onClick={props.onInstall}>
          <BIcon name={props.installing ? "spinner" : installed ? "refresh" : "download"} size={14} spin={props.installing} /> {buttonLabel}
        </BBtn>
      </div>
      {props.error ? <p className={styles.statusErr}>{props.error}</p> : null}
    </>
  );
}

function DaemonSetupGate(props: { installing: boolean }) {
  return (
    <div className={styles.gate}>
      <b>{props.installing ? "Installing the copy-trading service." : "Install the copy-trading service first."}</b>{" "}
      {props.installing ? (
        <span className={styles.inlineBusy}><BIcon name="spinner" size={13} spin /> Preparing the background daemon.</span>
      ) : (
        "Copy configs stay hidden until a durable daemon is installed, so a half-configured wallet cannot look ready when nothing will run."
      )}
    </div>
  );
}

function ConfigList(props: {
  list: CopyTradingConfig[];
  states: Record<string, CopyTradeRuntimeState>;
  fundable: Record<string, CopyTradeFundable>;
  online: boolean;
  busy: string | null;
  onEdit?: (c: CopyTradingConfig) => void;
  onAct: (action: "start" | "stop" | "delete" | "evolve", id: string) => void;
  onDuplicate?: (c: CopyTradingConfig) => void;
  canDuplicate?: boolean;
  editView?: { configId: string; content: React.ReactNode };
  returningConfigId?: string | null;
  foreign?: boolean;
  emptyText: string;
}) {
  if (props.list.length === 0) {
    return props.emptyText ? <p className={styles.empty}>{props.emptyText}</p> : null;
  }
  const pairs = pairConfigs(props.list);
  return (
    <div className={styles.cards}>
      {pairs.map((pair) => {
        const editing = [pair.original?.id, pair.evolved?.id].includes(props.editView?.configId);
        if (editing) {
          return <React.Fragment key={pair.key}>{props.editView?.content}</React.Fragment>;
        }
        return (
          <ConfigGroupCard
            key={pair.key}
            pair={pair}
            states={props.states}
            fundable={props.fundable}
            online={props.online}
            busy={props.busy}
            onEdit={props.onEdit}
            onAct={props.onAct}
            onDuplicate={props.onDuplicate}
            canDuplicate={props.canDuplicate}
            foreign={props.foreign}
            returning={[pair.original?.id, pair.evolved?.id].includes(props.returningConfigId ?? undefined)}
          />
        );
      })}
    </div>
  );
}

type ConfigPair = {
  key: string;
  original?: CopyTradingConfig;
  evolved?: CopyTradingConfig;
};

function pairConfigs(configs: CopyTradingConfig[]): ConfigPair[] {
  const evolvedBySource = new Map<string, CopyTradingConfig[]>();
  for (const config of configs) {
    const sourceId = config.evolution?.sourceConfigId;
    if (!sourceId) continue;
    evolvedBySource.set(sourceId, [...(evolvedBySource.get(sourceId) ?? []), config]);
  }
  const result: ConfigPair[] = [];
  const used = new Set<string>();
  for (const original of configs.filter((config) => !config.evolution)) {
    const evolved = evolvedBySource.get(original.id) ?? [];
    result.push({ key: original.id, original, evolved: evolved[0] });
    used.add(original.id);
    if (evolved[0]) used.add(evolved[0].id);
  }
  for (const config of configs) {
    if (used.has(config.id)) continue;
    result.push({ key: config.id, evolved: config.evolution ? config : undefined, original: config.evolution ? undefined : config });
  }
  return result;
}

function ConfigGroupCard(props: {
  pair: ConfigPair;
  states: Record<string, CopyTradeRuntimeState>;
  fundable: Record<string, CopyTradeFundable>;
  online: boolean;
  busy: string | null;
  onEdit?: (c: CopyTradingConfig) => void;
  onAct: (action: "start" | "stop" | "delete" | "evolve", id: string) => void;
  onDuplicate?: (c: CopyTradingConfig) => void;
  canDuplicate?: boolean;
  foreign?: boolean;
  returning?: boolean;
}) {
  const { pair } = props;
  const [chooserOpen, setChooserOpen] = React.useState(false);
  const representative = pair.original ?? pair.evolved!;
  const canAdd = Boolean(props.canDuplicate && props.onDuplicate && !props.foreign);

  return (
    <div className={styles.configUnit}>
      <div className={`${styles.configRow}${canAdd ? "" : ` ${styles.configRowSolo}`}`}>
        <div className={`${styles.card}${props.foreign ? ` ${styles.foreign}` : ""}${props.returning ? ` ${styles.cardReturnFallback}` : ""}`}>
          {pair.original && pair.evolved ? (
            <PairedConfigCard
              original={pair.original}
              evolved={pair.evolved}
              originalState={props.states[pair.original.id]}
              evolvedState={props.states[pair.evolved.id]}
              fundable={props.fundable[`${pair.original.walletAddress}:${pair.original.network}`] ?? null}
              online={props.online}
              busy={props.busy}
              onEdit={props.onEdit}
              onAct={props.onAct}
            />
          ) : (
            <SingleConfigCard
              config={representative}
              state={props.states[representative.id]}
              sourceState={representative.evolution ? props.states[representative.evolution.sourceConfigId] : undefined}
              fundable={props.fundable[`${representative.walletAddress}:${representative.network}`] ?? null}
              online={props.online}
              busy={props.busy}
              onEdit={props.onEdit}
              onAct={props.onAct}
              onAddControl={representative.evolution && canAdd ? () => setChooserOpen(true) : undefined}
            />
          )}
        </div>
        {canAdd ? (
          <button
            type="button"
            className={styles.addRail}
            aria-expanded={chooserOpen}
            aria-label={`Add another copy of ${shortAddr(representative.targetAddress)}`}
            title="Add another copy of this wallet"
            onClick={() => setChooserOpen((open) => !open)}
          >
            <span><BIcon name="plus" size={15} /></span>
          </button>
        ) : null}
      </div>
      {chooserOpen && canAdd ? (
        <div className={styles.duplicateChooser}>
          <div className={styles.duplicateHead}>
            <span>Duplicate {shortAddr(representative.targetAddress)} as</span>
            <button type="button" aria-label="Close duplicate choices" onClick={() => setChooserOpen(false)}>×</button>
          </div>
          <div className={styles.duplicateChoices}>
            <button type="button" onClick={() => { props.onDuplicate!(representative); setChooserOpen(false); }}>
              <b>Basic copy</b>
              <span>Same target and limits. Starts in dry-run.</span>
            </button>
            <button
              type="button"
              className={styles.agentChoice}
              disabled={props.busy != null || !pair.original || Boolean(pair.evolved)}
              onClick={() => { if (pair.original) props.onAct("evolve", pair.original.id); setChooserOpen(false); }}
            >
              <b>{pair.evolved ? "Agent copy already paired" : "Agent-analyzed copy"}</b>
              <span>{pair.evolved ? "This original already has a research-assisted twin." : "Creates a fair head-to-head with an inherited baseline."}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SingleConfigCard(props: {
  config: CopyTradingConfig;
  state?: CopyTradeRuntimeState;
  sourceState?: CopyTradeRuntimeState;
  fundable?: CopyTradeFundable | null;
  online: boolean;
  busy: string | null;
  onEdit?: (c: CopyTradingConfig) => void;
  onAct: (action: "start" | "stop" | "delete" | "evolve", id: string) => void;
  onAddControl?: () => void;
}) {
  const { config, state, online } = props;
  const [expanded, setExpanded] = React.useState(false);
  const detailsId = React.useId();
  const recent = (state?.events ?? []).slice(-3).reverse();
  const summary = state ? summarizeState(state) : null;
  const paper = config.dryRun ? state?.paper : undefined;
  const openCount = Object.keys((config.dryRun ? state?.paper?.positions : state?.openPositions) ?? {}).length;
  const paperSummary = paper ? paperPortfolioSummary(paper) : null;
  const evolutionComparison = config.evolution ? compareCopyTradeEvolution(state, props.sourceState) : null;
  const pill = configStatus(config, online);

  return (
    <div style={{ viewTransitionName: configViewTransitionName(config.id) }}>
      <ConfigHeader config={config} state={state} status={pill} />

      {props.fundable && !config.dryRun ? <FundingSummary fundable={props.fundable} /> : null}
      {state ? (
        config.dryRun ? (
          <PaperPortfolioOverview summary={paperSummary} simulatedTrades={paper?.mirrored ?? 0} openCount={openCount} comparison={evolutionComparison} />
        ) : (
          <div className={styles.meta}>
            <span>Signals <b>{summary?.signalCount ?? 0}</b></span><span>Mirrored <b>{state.stats.mirrored}</b></span>
            <span>Skipped <b>{state.stats.skipped}</b></span><span>Errors <b>{state.stats.errors}</b></span><span>Open <b>{openCount}</b></span>
          </div>
        )
      ) : config.enabled ? <div className={styles.meta}><span>{online ? "Waiting for first poll" : "Daemon offline"}</span></div> : null}

      {!expanded && recent.length ? (
        <div className={styles.events}>
          {recent.map((ev, i) => (
            <div key={i} className={styles.ev}>
              <span className={styles.evTime}>{fmtTime(ev.at)}</span>
              <span className={ev.kind === "buy" ? styles.evBuy : ev.kind === "sell" ? styles.evSell : ev.kind === "error" || ev.kind === "needs-approval" ? styles.evErr : undefined}>
                {ev.detail}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {config.evolution && evolutionComparison?.reviews === 0 ? (
        <div className={styles.unmeasured}>
          <span>No original result to race against yet — <b>the edge is unmeasured</b>.</span>
          {props.onAddControl ? <button type="button" onClick={props.onAddControl}>Add a control copy</button> : null}
        </div>
      ) : null}

      {expanded ? <ConfigPerformance id={detailsId} config={config} state={state} sourceState={props.sourceState} online={online} fundable={props.fundable} /> : null}

      <div className={styles.actions}>
        {config.enabled ? (
          <BBtn variant="ghost" sm disabled={props.busy != null} onClick={() => props.onAct("stop", config.id)}>Stop</BBtn>
        ) : (
          <BBtn variant="primary" sm disabled={props.busy != null} onClick={() => props.onAct("start", config.id)}>Start</BBtn>
        )}
        {props.onEdit ? <BBtn variant="ghost" sm disabled={props.busy != null} onClick={() => props.onEdit!(config)}>Edit</BBtn> : null}
        {!config.evolution ? (
          <BBtn variant="ghost" sm disabled={props.busy != null} onClick={() => props.onAct("evolve", config.id)}>Create agent-analyzed copy</BBtn>
        ) : null}
        <BBtn variant="ghost" sm aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((open) => !open)}>
          <span className={styles.chev} data-open={expanded ? "true" : undefined}><BIcon name="chevron" size={12} /></span>
          {expanded ? "Hide data" : "Show data"}
        </BBtn>
        <span className={styles.spacer} />
        <BBtn variant="ghost" sm disabled={props.busy != null} onClick={() => props.onAct("delete", config.id)}>Remove</BBtn>
      </div>
    </div>
  );
}

function PairedConfigCard(props: {
  original: CopyTradingConfig;
  evolved: CopyTradingConfig;
  originalState?: CopyTradeRuntimeState;
  evolvedState?: CopyTradeRuntimeState;
  fundable?: CopyTradeFundable | null;
  online: boolean;
  busy: string | null;
  onEdit?: (c: CopyTradingConfig) => void;
  onAct: (action: "start" | "stop" | "delete" | "evolve", id: string) => void;
}) {
  const { original, evolved, originalState, evolvedState } = props;
  const [openDetails, setOpenDetails] = React.useState<"original" | "agent" | null>(null);
  const leftId = React.useId();
  const rightId = React.useId();
  const originalPaper = originalState?.paper ? paperPortfolioSummary(originalState.paper) : null;
  const evolvedPaper = evolvedState?.paper ? paperPortfolioSummary(evolvedState.paper) : null;
  const comparison = compareCopyTradeEvolution(evolvedState, originalState);
  const originalStatus = configStatus(original, props.online);
  const evolvedStatus = configStatus(evolved, props.online);
  const sharedStatus = originalStatus.text === evolvedStatus.text ? originalStatus : { cls: styles.pillStop, text: "Mixed" };
  const toggleDetails = (side: "original" | "agent") => {
    setOpenDetails((current) => current === side ? null : side);
  };

  return (
    <div style={{ viewTransitionName: configViewTransitionName(original.id) }}>
      <ConfigHeader config={original} state={originalState} status={sharedStatus} paired />
      <LeadBanner comparison={comparison} />

      <div className={styles.raceGrid}>
        <RaceSide
          label="Original"
          config={original}
          state={originalState}
          summary={originalPaper}
          leading={(comparison.returnDeltaPct ?? 0) <= 0}
          busy={props.busy}
          onEdit={props.onEdit}
          onAct={props.onAct}
        />
        <div className={styles.versus}>
          <span>VS</span>
          <small>same target<br />same start</small>
        </div>
        <RaceSide
          label="Agent"
          config={evolved}
          state={evolvedState}
          summary={evolvedPaper}
          leading={(comparison.returnDeltaPct ?? 0) > 0}
          busy={props.busy}
          onEdit={props.onEdit}
          onAct={props.onAct}
          agent
        />
      </div>

      <ComparisonRows original={originalPaper} evolved={evolvedPaper} originalState={originalState} evolvedState={evolvedState} />
      <Disagreements comparison={comparison} state={evolvedState} />

      <div className={styles.pairDataButtons}>
        <button type="button" data-open={openDetails === "original" ? "true" : undefined} aria-expanded={openDetails === "original"} aria-controls={leftId} onClick={() => toggleDetails("original")}>
          {openDetails === "original" ? "Hide original data" : "Original data"}<span className={styles.chev} data-open={openDetails === "original" ? "true" : undefined}><BIcon name="chevron" size={12} /></span>
        </button>
        <span className={styles.pairDot} />
        <button type="button" data-open={openDetails === "agent" ? "true" : undefined} aria-expanded={openDetails === "agent"} aria-controls={rightId} onClick={() => toggleDetails("agent")}>
          {openDetails === "agent" ? "Hide agent data" : "Agent data & Sol reviews"}<span className={styles.chev} data-open={openDetails === "agent" ? "true" : undefined}><BIcon name="chevron" size={12} /></span>
        </button>
      </div>
      {openDetails ? (
        <div className={styles.pairDetails}>
          {openDetails === "original" ? (
            <ConfigPerformance id={leftId} config={original} state={originalState} online={props.online} fundable={props.fundable} />
          ) : (
            <ConfigPerformance id={rightId} config={evolved} state={evolvedState} sourceState={originalState} online={props.online} fundable={props.fundable} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function ConfigHeader(props: {
  config: CopyTradingConfig;
  state?: CopyTradeRuntimeState;
  status: { cls: string; text: string };
  paired?: boolean;
}) {
  const label = props.config.label?.replace(/\s*·\s*Agent analyzed\s*$/i, "").trim()
    || `Copy ${shortAddr(props.config.targetAddress)}`;
  return (
    <div className={styles.cardHead}>
      <span className={styles.copyIcon}><BIcon name="copy" size={15} /></span>
      <span className={styles.cardTitle}>
        <b>{label}{props.paired ? <span className={styles.pairedLabel}>Original vs agent</span> : null}</b>
        <span>{shortAddr(props.config.targetAddress)} · {copyTradeNetworkLabel(props.config.network)} · max ${props.config.maxCopyUsd}/trade</span>
      </span>
      <span className={`${styles.pill} ${props.status.cls}`}>{props.status.text}</span>
      {!props.paired && props.config.evolution ? <span className={`${styles.pill} ${styles.pillEvolved}`}>Agent analyzed</span> : null}
      {props.state?.lastError && props.config.enabled ? <span className={`${styles.pill} ${styles.pillErr}`}>Error</span> : null}
    </div>
  );
}

function RaceSide(props: {
  label: string;
  config: CopyTradingConfig;
  state?: CopyTradeRuntimeState;
  summary: PaperPortfolioSummary | null;
  leading: boolean;
  busy: string | null;
  onEdit?: (c: CopyTradingConfig) => void;
  onAct: (action: "start" | "stop" | "delete" | "evolve", id: string) => void;
  agent?: boolean;
}) {
  return (
    <div className={`${styles.raceSide}${props.leading ? ` ${styles.raceLeading}` : ""}`}>
      <div className={styles.raceSideHead}>
        <span className={styles.miniActions}>
          <button type="button" title={props.config.enabled ? "Stop" : "Start"} aria-label={`${props.config.enabled ? "Stop" : "Start"} ${props.label} copy`} disabled={props.busy != null} onClick={() => props.onAct(props.config.enabled ? "stop" : "start", props.config.id)}>
            {props.config.enabled ? <StopIcon /> : <BIcon name="activity" size={11} />}
          </button>
          {props.onEdit ? <button type="button" title="Edit" aria-label={`Edit ${props.label} copy`} disabled={props.busy != null} onClick={() => props.onEdit!(props.config)}><EditIcon /></button> : null}
          <button type="button" title="Remove" aria-label={`Remove ${props.label} copy`} disabled={props.busy != null} onClick={() => props.onAct("delete", props.config.id)}><RemoveIcon /></button>
        </span>
        <span className={`${styles.kind} ${props.agent ? styles.agentKind : ""}`}>{props.label}</span>
        {props.leading ? <span className={styles.crown} title="Leading"><CrownIcon /></span> : null}
      </div>
      {props.summary ? (
        <>
          <strong>{fmtUsd(props.summary.equityUsd)}</strong>
          <small className={metricClass(props.summary.totalPnlUsd)}>{fmtSignedUsd(props.summary.totalPnlUsd)} · {fmtSignedPercent(props.summary.returnPct)}</small>
        </>
      ) : <span className={styles.raceWaiting}>Waiting for portfolio data</span>}
    </div>
  );
}

function LeadBanner(props: { comparison: CopyTradeEvolutionComparison }) {
  const delta = props.comparison.returnDeltaPct;
  const label = delta == null ? "Head-to-head collecting evidence" : delta > 0 ? "Agent leads" : delta < 0 ? "Original leads" : "Even race";
  const progress = Math.min(100, (props.comparison.promotion.maturedSamples / Math.max(1, props.comparison.promotion.requiredSamples)) * 100);
  return (
    <div className={styles.leadBanner}>
      <CrownIcon />
      <span>{label}{delta != null ? <> by <b>{fmtSignedPoints(Math.abs(delta))}</b></> : null}</span>
      <span className={styles.evidenceTrack}><i style={{ width: `${progress}%` }} /></span>
      <small>{fmtInt(props.comparison.promotion.maturedSamples)}/{fmtInt(props.comparison.promotion.requiredSamples)} evidence</small>
    </div>
  );
}

function ComparisonRows(props: {
  original: PaperPortfolioSummary | null;
  evolved: PaperPortfolioSummary | null;
  originalState?: CopyTradeRuntimeState;
  evolvedState?: CopyTradeRuntimeState;
}) {
  const rows = [
    { label: "Portfolio", left: props.original ? fmtUsd(props.original.equityUsd) : "—", right: props.evolved ? fmtUsd(props.evolved.equityUsd) : "—", leftValue: props.original?.equityUsd ?? 0, rightValue: props.evolved?.equityUsd ?? 0 },
    { label: "Profit", left: props.original ? fmtSignedUsd(props.original.totalPnlUsd) : "—", right: props.evolved ? fmtSignedUsd(props.evolved.totalPnlUsd) : "—", leftValue: props.original?.totalPnlUsd ?? 0, rightValue: props.evolved?.totalPnlUsd ?? 0 },
    { label: "Exec costs", left: props.original ? fmtUsd(props.original.executionCostsUsd) : "—", right: props.evolved ? fmtUsd(props.evolved.executionCostsUsd) : "—", leftValue: props.original?.executionCostsUsd ?? 0, rightValue: props.evolved?.executionCostsUsd ?? 0 },
    { label: "Sim trades", left: fmtInt(props.originalState?.paper?.mirrored ?? 0), right: fmtInt(props.evolvedState?.paper?.mirrored ?? 0), leftValue: props.originalState?.paper?.mirrored ?? 0, rightValue: props.evolvedState?.paper?.mirrored ?? 0 },
    { label: "Open", left: fmtInt(Object.keys(props.originalState?.paper?.positions ?? {}).length), right: fmtInt(Object.keys(props.evolvedState?.paper?.positions ?? {}).length), leftValue: Object.keys(props.originalState?.paper?.positions ?? {}).length, rightValue: Object.keys(props.evolvedState?.paper?.positions ?? {}).length },
  ];
  return (
    <div className={styles.comparisonRows}>
      {rows.map((row) => {
        const span = Math.max(Math.abs(row.leftValue), Math.abs(row.rightValue), 1);
        return (
          <div className={styles.comparisonRow} key={row.label}>
            <span className={styles.leftValue}>{row.left}</span>
            <span className={styles.leftTrack}><i style={{ width: `${Math.abs(row.leftValue) / span * 100}%` }} /></span>
            <span className={styles.comparisonLabel}>{row.label}</span>
            <span className={styles.rightTrack}><i style={{ width: `${Math.abs(row.rightValue) / span * 100}%` }} /></span>
            <span className={styles.rightValue}>{row.right}</span>
          </div>
        );
      })}
    </div>
  );
}

function Disagreements(props: { comparison: CopyTradeEvolutionComparison; state?: CopyTradeRuntimeState }) {
  const reviews = (props.state?.agentAnalysis?.reviews ?? []).slice(-3).reverse();
  if (!reviews.length) return null;
  return (
    <div className={styles.disagreements}>
      <div>Where they disagreed</div>
      {reviews.map((review) => {
        const retrospective = props.comparison.learning.latest.find((item) => item.symbol === review.symbol);
        return (
          <div className={styles.disagreementRow} key={`${review.targetTxRef}:${review.reviewedAt}`}>
            <span><b>Mirrored {review.symbol}</b><small>original path</small></span>
            <em className={metricClass(retrospective?.pairedDeltaPct ?? 0)}>{retrospective ? fmtSignedPoints(retrospective.pairedDeltaPct) : review.closeExecuted ? "different" : "same"}</em>
            <span><b>{review.closeExecuted ? "Closed early" : review.decision === "uncertain" ? "Stayed uncertain" : "Kept"}</b><small>{review.riskFlags?.[0] || `${Math.round((review.calibratedConfidence ?? review.confidence) * 100)}% confidence`}</small></span>
          </div>
        );
      })}
    </div>
  );
}

function FundingSummary(props: { fundable: CopyTradeFundable }) {
  return (
    <div className={styles.meta} title="What the copy-trader can spend from this wallet to mirror copied buys">
      <span>Available to trade <b>{fmtUsd(props.fundable.totalUsd)}</b></span>
      {props.fundable.assets.map((asset) => <span key={asset.symbol}>{asset.symbol} <b>{fmtUsd(asset.usd)}</b></span>)}
      {props.fundable.assets.length === 0 ? <span>No spendable balance</span> : null}
    </div>
  );
}

function configStatus(config: CopyTradingConfig, online: boolean): { cls: string; text: string } {
  if (!config.enabled) return { cls: styles.pillStop, text: "Stopped" };
  if (!online) return { cls: styles.pillStop, text: "Offline" };
  if (config.dryRun) return { cls: styles.pillDry, text: "Dry-run" };
  return { cls: styles.pillRun, text: "Live" };
}

function StopIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>;
}

function EditIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M15 5l4 4" /></svg>;
}

function RemoveIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14" /><path d="M9 7V4h6v3" /><path d="m7 7 1 13h8l1-13" /></svg>;
}

function CrownIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8l4.5 4L12 5l3.5 7L20 8l-1.8 10H5.8z" /></svg>;
}

function PaperPortfolioOverview(props: {
  summary: PaperPortfolioSummary | null;
  simulatedTrades: number;
  openCount: number;
  comparison: CopyTradeEvolutionComparison | null;
}) {
  const { summary, comparison } = props;
  const waitingForFirstAgentReview = comparison != null && comparison.reviews === 0;
  return (
    <section className={styles.paperSummary} aria-label="Simulated copy-trading portfolio">
      <div className={styles.paperNotice}>
        <span>Simulation</span>
        <b>No real money used</b>
      </div>
      {summary ? (
        <>
          <div className={styles.paperHero}>
            <span>
              <b>{fmtUsd(summary.equityUsd)}</b>
              <small>{waitingForFirstAgentReview ? "Inherited portfolio baseline" : "Portfolio value"}</small>
            </span>
            <span>
              <b className={metricClass(summary.totalPnlUsd)}>{fmtSignedUsd(summary.totalPnlUsd)}</b>
              <small>
                {waitingForFirstAgentReview
                  ? <>Inherited profit · {fmtSignedPercent(summary.returnPct)}</>
                  : <>Profit · {fmtSignedPercent(summary.returnPct)}</>}
              </small>
            </span>
          </div>
          <div className={styles.paperBreakdown}>
            <span>Started <b>{fmtUsd(summary.startCashUsd)}</b></span>
            <span>Cash <b>{fmtUsd(summary.cashUsd)}</b></span>
            <span>Positions <b>{fmtUsd(summary.positionValueUsd)}</b></span>
            <span>Execution costs <b>{fmtUsd(summary.executionCostsUsd)}</b></span>
            <span>Open positions <b>{fmtInt(props.openCount)}</b></span>
          </div>
          <div className={styles.paperActivity}>
            {fmtInt(props.simulatedTrades)} {waitingForFirstAgentReview ? "simulated trades inherited from original" : "simulated trades"}
          </div>
          {comparison ? <EvolutionComparison comparison={comparison} /> : null}
          {waitingForFirstAgentReview ? (
            <div className={styles.agentWaiting} role="status">
              <span className={styles.agentWaitingDot} />
              <span className={styles.agentWaitingCopy}>
                <b>Agent waiting for next new buy</b>
                <small>No new copied buy has arrived since this twin started. The portfolio above was inherited from the original simulation.</small>
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <p className={styles.paperWaiting}>Waiting for the first simulated portfolio update.</p>
      )}
    </section>
  );
}

function EvolutionComparison(props: { comparison: CopyTradeEvolutionComparison }) {
  const { comparison } = props;
  const promotion = comparison.promotion;
  const promotionLabel = promotion.status === "eligible"
    ? "Eligible for promotion"
    : promotion.status === "rejected"
      ? "Not eligible yet"
      : "Learning evidence";
  const ci = promotion.edgeCi95Pct;
  const absoluteCi = promotion.evolvedReturnCi95Pct;
  return (
    <div className={styles.evolutionSummary}>
      {comparison.status === "ready" ? (
        <div className={styles.evolutionReturns}>
          <span>Original <b>{fmtSignedPercent(comparison.sourceReturnPct ?? 0)}</b></span>
          <span>Agent analyzed <b>{fmtSignedPercent(comparison.evolvedReturnPct ?? 0)}</b></span>
          <span>Current edge <b className={metricClass(comparison.returnDeltaPct ?? 0)}>{fmtSignedPoints(comparison.returnDeltaPct ?? 0)}</b></span>
        </div>
      ) : null}
      <div className={styles.evolutionReturns}>
        <span>{promotionLabel} <b>{fmtInt(promotion.maturedSamples)}/{fmtInt(promotion.requiredSamples)}</b></span>
        <span>95% edge <b>{ci[0] == null || ci[1] == null ? "waiting" : `${fmtSignedPoints(ci[0])} to ${fmtSignedPoints(ci[1])}`}</b></span>
        <span>Drawdown <b>{promotion.evolvedMaxDrawdownPct == null ? "waiting" : `${promotion.evolvedMaxDrawdownPct.toFixed(1)}% agent · ${(promotion.sourceMaxDrawdownPct ?? 0).toFixed(1)}% original`}</b></span>
      </div>
      <div className={styles.evolutionReturns}>
        <span>Absolute 95% return <b>{absoluteCi[0] == null || absoluteCi[1] == null ? "waiting" : `${fmtSignedPoints(absoluteCi[0])} to ${fmtSignedPoints(absoluteCi[1])}`}</b></span>
        <span>Profit factor <b>{promotion.evolvedProfitFactor == null ? "waiting" : promotion.evolvedProfitFactor.toFixed(2)}</b></span>
        <span>Review reliability <b>{promotion.errorRatePct == null ? "waiting" : `${(100 - promotion.errorRatePct).toFixed(1)}%`}</b></span>
      </div>
      <small>{fmtInt(comparison.reviews)} reviewed · {fmtInt(comparison.closed)} closed · {fmtInt(comparison.kept)} kept · {fmtInt(comparison.errors)} errors · frozen {fmtInt(promotion.requiredHoldoutSamples)}-trade validation batches · paper-only, never auto-live</small>
    </div>
  );
}

function ConfigPerformance(props: {
  id: string;
  config: CopyTradingConfig;
  state?: CopyTradeRuntimeState;
  sourceState?: CopyTradeRuntimeState;
  online: boolean;
  fundable?: CopyTradeFundable | null;
}) {
  const { config, state, online } = props;
  const waiting = config.enabled && online && !state;
  const summary = state ? summarizeState(state) : null;
  const paper = config.dryRun ? state?.paper : undefined;
  const paperSummary = paper ? paperPortfolioSummary(paper) : null;
  const openPositions = Object.values((config.dryRun ? state?.paper?.positions : state?.openPositions) ?? {});
  const events = (state?.events ?? []).slice(-8).reverse();
  const reviews = (state?.agentAnalysis?.reviews ?? []).slice(-8).reverse();
  const brainSyncReceipts = Object.values(state?.agentAnalysis?.brainSync ?? {});
  const brainSynced = brainSyncReceipts.filter((receipt) => receipt.status === "synced").length;
  const brainWaiting = brainSyncReceipts.length - brainSynced;
  const comparison = config.evolution ? compareCopyTradeEvolution(state, props.sourceState) : null;
  const loopStatus = !config.enabled ? "Stopped" : !online ? "Offline" : state?.running ? "Running" : "Waiting";
  const currentHealth = state?.lastError ? "Needs attention" : loopStatus === "Running" ? "Healthy" : loopStatus;
  const currentHealthDanger = Boolean(state?.lastError || (config.enabled && !online));
  const lastEvent = summary?.lastEventAt ? fmtAgo(summary.lastEventAt) : "none";

  return (
    <div id={props.id} className={styles.details} role="region" aria-live="polite" aria-label={`Copy-trading performance for ${config.label?.trim() || shortAddr(config.targetAddress)}`}>
      {!state ? (
        <div className={styles.detailsEmpty}>
          {waiting ? <BIcon name="spinner" size={13} spin /> : null}
          {waiting ? "Waiting for the first daemon poll." : "No runtime data has been recorded for this config yet."}
        </div>
      ) : (
        <>
          <div className={styles.healthRow}>
            <span className={styles.healthItem}><span className={`${styles.healthDot} ${state.running && online ? styles.healthLive : ""}`} />{loopStatus}</span>
            <span className={styles.healthItem}>Last poll <b>{fmtAgo(state.lastPollAt)}</b></span>
            <span className={styles.healthItem}>Last event <b>{lastEvent}</b></span>
            {state.lastError ? <span className={`${styles.healthItem} ${styles.healthErr}`}>Last error <b>{state.lastError}</b></span> : null}
          </div>

          {paper && paperSummary ? (
            <div className={styles.detailStats}>
              <DetailMetric label="Polls" value={fmtInt(state.stats.polls)} />
              <DetailMetric label="Signals" value={fmtInt(summary?.signalCount ?? 0)} />
              <DetailMetric label="Simulated trades" value={fmtInt(paper.mirrored)} />
              <DetailMetric label="Skipped" value={fmtInt(state.stats.skipped)} />
              <DetailMetric label="Current health" value={currentHealth} danger={currentHealthDanger} />
              <DetailMetric label="Open" value={fmtInt(openPositions.length)} />
              <DetailMetric label="Position cost" value={fmtUsd(paperSummary.positionCostUsd)} />
              <DetailMetric label="Execution costs" value={fmtUsd(paperSummary.executionCostsUsd)} />
              <DetailMetric label="Realized profit" value={fmtSignedUsd(paperSummary.realizedPnlUsd)} danger={paperSummary.realizedPnlUsd < 0} />
              <DetailMetric label="Unrealized profit" value={fmtSignedUsd(paperSummary.unrealizedPnlUsd)} danger={paperSummary.unrealizedPnlUsd < 0} />
              <DetailMetric label="Total return" value={fmtSignedPercent(paperSummary.returnPct)} danger={paperSummary.returnPct < 0} />
            </div>
          ) : (
            <div className={styles.detailStats}>
              <DetailMetric label="Polls" value={fmtInt(state.stats.polls)} />
              <DetailMetric label="Signals" value={fmtInt(summary?.signalCount ?? 0)} />
              <DetailMetric label="Dry-run" value={fmtInt(summary?.dryRunActionCount ?? 0)} />
              <DetailMetric label="Mirrored" value={fmtInt(state.stats.mirrored)} />
              <DetailMetric label="Skipped" value={fmtInt(state.stats.skipped)} />
              <DetailMetric label="Current health" value={currentHealth} danger={currentHealthDanger} />
              <DetailMetric label="Open" value={fmtInt(openPositions.length)} />
              <DetailMetric label="Logged USD" value={fmtUsd(summary?.loggedUsd ?? 0)} />
            </div>
          )}

          {state.stats.errors > 0 ? (
            <p className={styles.detailMuted}>
              Lifetime processing failures: <b>{fmtInt(state.stats.errors)}</b>. This includes recovered RPC and provider outages; it is not a count of completed trades or investment losses.
            </p>
          ) : null}

          {paper && props.fundable ? (
            <div className={styles.detailBlock}>
              <div className={styles.detailTitle}>Live wallet · not used in this simulation</div>
              <div className={styles.liveWalletSummary}>
                <span>Available to trade <b>{fmtUsd(props.fundable.totalUsd)}</b></span>
                {props.fundable.assets.map((asset) => (
                  <span key={asset.symbol}>{asset.symbol} <b>{fmtUsd(asset.usd)}</b></span>
                ))}
                {props.fundable.assets.length === 0 ? <span>No spendable balance</span> : null}
              </div>
            </div>
          ) : null}

          {comparison ? (
            <div className={styles.detailBlock}>
              <div className={styles.detailTitle}>Original vs agent-analyzed</div>
              <EvolutionComparison comparison={comparison} />
            </div>
          ) : null}

          {config.evolution && comparison ? (
            <div className={styles.detailBlock}>
              <div className={styles.detailTitle}>Outcome retrospectives</div>
              <p className={styles.detailMuted}>
                Shared Brain sync · {fmtInt(brainSynced)} current{brainWaiting ? ` · ${fmtInt(brainWaiting)} retrying` : ""}
              </p>
              {comparison.learning.latest.length ? (
                <div className={styles.reviews}>
                  <p className={styles.detailMuted}>
                    {fmtInt(comparison.learning.total)} evidence-linked notes · {fmtInt(comparison.learning.avoidedLosses)} avoided losses · {fmtInt(comparison.learning.missedUpside)} missed upside · {fmtInt(comparison.learning.lossesHeld)} losses held
                  </p>
                  {comparison.learning.latest.map((note) => (
                    <div key={`${note.targetTxRef}:${note.horizon}`} className={styles.review}>
                      <span className={`${styles.kind} ${note.pairedDeltaPct < 0 ? styles.kindErr : note.pairedDeltaPct > 0 ? styles.kindBuy : ""}`}>
                        {note.horizon}
                      </span>
                      <span className={styles.reviewBody}>
                        <b>{note.symbol} · {note.outcome} · {fmtSignedPoints(note.pairedDeltaPct)} edge</b>
                        <span>{note.summary}</span>
                        <small>{note.lesson}</small>
                        <small>Evidence tags: {note.causeTags.join(" · ")}</small>
                      </span>
                    </div>
                  ))}
                </div>
              ) : <p className={styles.detailMuted}>Waiting for a valid 24-hour observation or the target wallet's exit. Current-batch outcomes cannot teach the current batch.</p>}
            </div>
          ) : null}

          {config.evolution ? (
            <div className={styles.detailBlock}>
              <div className={styles.detailTitle}>GPT-5.6 Sol reviews</div>
              {reviews.length ? (
                <div className={styles.reviews}>
                  {reviews.map((review) => (
                    <div key={`${review.targetTxRef}:${review.reviewedAt}`} className={styles.review}>
                      <span className={`${styles.kind} ${review.error ? styles.kindErr : review.closeExecuted ? styles.kindSell : styles.kindBuy}`}>
                        {review.error ? "error" : review.closeExecuted ? "closed" : review.decision}
                      </span>
                      <span className={styles.reviewBody}>
                        <b>{review.symbol} · {fmtSignedPercent((review.calibratedConfidence ?? review.confidence) * 100).replace("+", "")} calibrated confidence</b>
                        <span>{review.summary}</span>
                        <small>Raw {fmtSignedPercent((review.rawConfidence ?? review.confidence) * 100).replace("+", "")} · close threshold {fmtSignedPercent((review.closeThreshold ?? config.evolution!.minCloseConfidence) * 100).replace("+", "")} · {review.reviewPath === "risk-close" ? "fast safety gate" : "Sol adjudication"}</small>
                        {review.sources.length ? (
                          <small>
                            Sources: {review.sources.map((source, index) => (
                              <React.Fragment key={source.url}>
                                {index ? " · " : ""}<a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                              </React.Fragment>
                            ))}
                          </small>
                        ) : <small>{review.error ? "Position kept because analysis failed." : "No web source returned."}</small>}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <p className={styles.detailMuted}>Waiting for the first copied buy to review.</p>}
            </div>
          ) : null}

          <div className={styles.detailBlock}>
            <div className={styles.detailTitle}>{config.dryRun ? "Simulated positions" : "Open positions"}</div>
            {openPositions.length ? (
              <div className={styles.positions}>
                {openPositions.map((position) => {
                  const hasMark = position.markUsd != null;
                  const pnl = hasMark ? position.markUsd! - position.spentUsd : 0;
                  return (
                    <div key={position.token} className={styles.positionRow}>
                      <span>
                        <b>{position.symbol || shortAddr(position.token)}</b>
                        <small>{shortAddr(position.token)}</small>
                      </span>
                      <span className={styles.num}>{fmtUsd(position.spentUsd)}</span>
                      {hasMark ? (
                        <span className={styles.num}>
                          {fmtUsd(position.markUsd!)}
                          <small className={pnl < 0 ? styles.metricDanger : undefined}>{fmtSignedUsd(pnl)}</small>
                        </span>
                      ) : (
                        <span className={styles.num}>{fmtAmount(position.amount)}</span>
                      )}
                      <span className={styles.num}>{fmtAgo(position.lastActionAt)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={styles.detailMuted}>{config.dryRun ? "No simulated positions open right now." : "No open copied positions right now."}</p>
            )}
          </div>

          <div className={styles.detailBlock}>
            <div className={styles.detailTitle}>Recent events</div>
            {events.length ? (
              <div className={styles.detailEvents}>
                {events.map((ev, i) => (
                  <div key={`${ev.at}:${i}`} className={styles.detailEvent}>
                    <span className={`${styles.kind} ${eventTone(ev.kind)}`}>{eventLabel(ev.kind)}</span>
                    <span className={styles.detailEventBody}>
                      <span>{ev.detail}</span>
                      <small>
                        <time dateTime={new Date(ev.at).toISOString()} title={fmtDate(ev.at)}>{fmtAgo(ev.at)}</time>
                        {" · "}
                        {eventMode(ev)}
                        {ev.usd != null ? ` · ${fmtUsd(ev.usd)}` : ""}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.detailMuted}>No events yet. Dry-run detections and live swaps will appear here.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DetailMetric(props: { label: string; value: string; danger?: boolean }) {
  return (
    <span className={styles.detailMetric}>
      <b className={props.danger ? styles.metricDanger : undefined}>{props.value}</b>
      <small>{props.label}</small>
    </span>
  );
}

function ConfigForm(props: {
  draft: CopyTradingConfig;
  setDraft: React.Dispatch<React.SetStateAction<CopyTradingConfig | null>>;
  showAdv: boolean;
  setShowAdv: (v: boolean) => void;
  busy: boolean;
  error: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { draft } = props;
  const set = <K extends keyof CopyTradingConfig>(k: K, v: CopyTradingConfig[K]) =>
    props.setDraft((prev) => (prev ? { ...prev, [k]: v } : prev));
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

  return (
    <div className={styles.form}>
      <div className={styles.formGrid}>
        <label className={`fb-label ${styles.full}`}>
          Trader address to copy
          <input className="fb-field fb-mono" placeholder={draft.network === "solana:mainnet" ? "Solana address…" : "0x…"} value={draft.targetAddress} onChange={(e) => set("targetAddress", e.target.value.trim())} />
        </label>
        <label className={`fb-label ${styles.full}`}>
          Label (optional)
          <input className="fb-field" placeholder="e.g. Base meme whale" value={draft.label} onChange={(e) => set("label", e.target.value)} />
        </label>
        <label className="fb-label">
          Max per trade (USD)
          <input className="fb-field fb-mono" type="number" min={0.5} max={MAX_COPY_TRADE_USD} step={0.5} value={draft.maxCopyUsd} onChange={(e) => set("maxCopyUsd", num(e.target.value))} />
        </label>
        <label className="fb-label">
          Slippage (bps)
          <input className="fb-field fb-mono" type="number" min={10} max={2000} step={10} value={draft.slippageBps} onChange={(e) => set("slippageBps", num(e.target.value))} />
        </label>
      </div>

      <div className={styles.toggleRow}>
        <label className={styles.toggle}>
          <input type="checkbox" checked={draft.copySells} onChange={(e) => set("copySells", e.target.checked)} />
          Copy sells too
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={draft.dryRun} onChange={(e) => set("dryRun", e.target.checked)} />
          Dry-run <span className={styles.toggleHint}>(paper-trade with simulated cash, no real swaps)</span>
        </label>
      </div>

      <button type="button" className={styles.advToggle} onClick={() => props.setShowAdv(!props.showAdv)}>
        <BIcon name={props.showAdv ? "refresh" : "plus"} size={12} /> {props.showAdv ? "Hide advanced" : "Advanced settings"}
      </button>

      {props.showAdv ? (
        <div className={`${styles.adv} ${styles.formGrid}`}>
          <label className="fb-label">
            Copy mode
            <select className="fb-select" value={draft.copyMode} onChange={(e) => set("copyMode", e.target.value === "proportional" ? "proportional" : "fixed")}>
              <option value="fixed">Fixed USD</option>
              <option value="proportional">Proportional</option>
            </select>
          </label>
          {draft.copyMode === "proportional" ? (
            <label className="fb-label">
              Copy percent (%)
              <input className="fb-field fb-mono" type="number" min={1} max={100} value={draft.copyPercent} onChange={(e) => set("copyPercent", num(e.target.value))} />
            </label>
          ) : (
            <label className="fb-label">
              Fixed amount (USD)
              <input className="fb-field fb-mono" type="number" min={0.5} max={MAX_COPY_TRADE_USD} step={0.5} value={draft.fixedUsd} onChange={(e) => set("fixedUsd", num(e.target.value))} />
            </label>
          )}
          <label className="fb-label">
            Min copy (USD)
            <input className="fb-field fb-mono" type="number" min={0.5} value={draft.minCopyUsd} onChange={(e) => set("minCopyUsd", num(e.target.value))} />
          </label>
          <label className="fb-label">
            Max per token (USD)
            <input className="fb-field fb-mono" type="number" min={0.5} value={draft.maxPerTokenUsd} onChange={(e) => set("maxPerTokenUsd", num(e.target.value))} />
          </label>
          <label className="fb-label">
            Take-profit (%)
            <input className="fb-field fb-mono" type="number" min={0} placeholder="off" value={draft.takeProfitPct ?? ""} onChange={(e) => set("takeProfitPct", e.target.value.trim() === "" ? null : num(e.target.value))} />
          </label>
          <label className="fb-label">
            Stop-loss (%)
            <input className="fb-field fb-mono" type="number" min={0} placeholder="off" value={draft.stopLossPct ?? ""} onChange={(e) => set("stopLossPct", e.target.value.trim() === "" ? null : num(e.target.value))} />
          </label>
          <label className="fb-label">
            Max open positions
            <input className="fb-field fb-mono" type="number" min={1} max={50} value={draft.maxOpenPositions} onChange={(e) => set("maxOpenPositions", num(e.target.value))} />
          </label>
          <label className="fb-label">
            Min liquidity (USD)
            <input className="fb-field fb-mono" type="number" min={0} placeholder="off" value={draft.minLiquidityUsd ?? ""} onChange={(e) => set("minLiquidityUsd", e.target.value.trim() === "" ? null : num(e.target.value))} />
          </label>
          <label className="fb-label">
            Cooldown (ms)
            <input className="fb-field fb-mono" type="number" min={0} value={draft.cooldownMs} onChange={(e) => set("cooldownMs", num(e.target.value))} />
          </label>
          <label className="fb-label">
            Poll interval (ms)
            <input className="fb-field fb-mono" type="number" min={3000} value={draft.pollIntervalMs} onChange={(e) => set("pollIntervalMs", num(e.target.value))} />
          </label>
          <label className="fb-label">
            Paper bankroll (USD)
            <input className="fb-field fb-mono" type="number" min={0} placeholder="auto (wallet balance)" value={draft.paperStartUsd ?? ""} onChange={(e) => set("paperStartUsd", e.target.value.trim() === "" ? null : num(e.target.value))} />
          </label>
          <label className={`fb-label ${styles.full}`}>
            Blacklist (comma-separated token addresses)
            <input className="fb-field fb-mono" placeholder="0xabc…, mint…" value={draft.blacklist.join(", ")} onChange={(e) => set("blacklist", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} />
          </label>
        </div>
      ) : null}

      {props.error ? <p className={styles.err}>{props.error}</p> : null}

      <div className={styles.actions}>
        <BBtn variant="primary" sm disabled={props.busy} onClick={props.onSave}>
          <BIcon name={props.busy ? "spinner" : "check"} size={14} spin={props.busy} /> {props.busy ? "Saving…" : "Save config"}
        </BBtn>
        <BBtn variant="ghost" sm disabled={props.busy} onClick={props.onCancel}>Cancel</BBtn>
        <span className={styles.spacer} />
        <Badge>{draft.dryRun ? "dry-run" : "live"}</Badge>
      </div>
    </div>
  );
}

const ACTION_EVENT_KINDS: CopyTradeEvent["kind"][] = ["buy", "sell", "take-profit", "stop-loss"];

function summarizeState(state: CopyTradeRuntimeState) {
  let signalCount = 0;
  let dryRunActionCount = 0;
  let loggedUsd = 0;
  for (const event of state.events ?? []) {
    if (ACTION_EVENT_KINDS.includes(event.kind)) {
      signalCount += 1;
      if (isDryRunEvent(event)) dryRunActionCount += 1;
    }
    if (typeof event.usd === "number" && Number.isFinite(event.usd)) loggedUsd += Math.abs(event.usd);
  }
  const last = state.events?.[state.events.length - 1];
  return { signalCount, dryRunActionCount, loggedUsd, lastEventAt: last?.at ?? null };
}

function fmtSignedUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  return `${value < 0 ? "−" : "+"}${fmtUsd(Math.abs(value))}`;
}

function fmtSignedPercent(value: number): string {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

function fmtSignedPoints(value: number): string {
  if (!Number.isFinite(value)) return "0.0 pts";
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} pts`;
}

function metricClass(value: number): string | undefined {
  if (value < 0) return styles.metricDanger;
  if (value > 0) return styles.metricPositive;
  return undefined;
}

function eventLabel(kind: CopyTradeEvent["kind"]): string {
  return kind.replace("-", " ");
}

function eventMode(event: CopyTradeEvent): string {
  if (isDryRunEvent(event)) return "dry-run";
  if (event.txRef) return "live";
  if (event.kind === "needs-approval") return "approval";
  return "logged";
}

function isDryRunEvent(event: CopyTradeEvent): boolean {
  return event.dryRun === true || event.detail.toLowerCase().startsWith("[dry-run]");
}

function eventTone(kind: CopyTradeEvent["kind"]): string {
  if (kind === "buy") return styles.kindBuy;
  if (kind === "sell" || kind === "take-profit") return styles.kindSell;
  if (kind === "error" || kind === "needs-approval" || kind === "stop-loss") return styles.kindErr;
  return styles.kindMuted;
}

function shortAddr(address: string): string {
  if (!address) return "—";
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function fmtInt(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "0";
}

function fmtUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function fmtAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value === 0) return "0";
  return value.toLocaleString(undefined, { maximumSignificantDigits: 6 });
}

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function fmtAgo(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "not yet";
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}
