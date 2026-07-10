"use client";

/* Copy-trading control surface inside the Trade desk. Lists every per-wallet /
   per-chain config (so configs on a previously-acting wallet stay visible and
   keep running), lets you start/stop/delete any of them, and adds new configs
   scoped to the CURRENT acting wallet + chain. Simple settings are shown
   outright; the rest hide under "Advanced". All execution happens server-side in
   the standalone engine — this panel only reads/writes config via
   /api/trading/copy-trade and reflects the engine's live status. */

import React from "react";
import { Badge, BBtn } from "./primitives";
import { BIcon } from "./icons";
import { useVisibilityAwarePolling } from "@/features/dashboard/hooks/use-visibility-aware-polling";
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
  type CopyTradePaperLedger,
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

/** Spendable balance the copy-trader can use for this config (acting wallet + chain). */
function fundableFor(snap: Snapshot | null, config: CopyTradingConfig): CopyTradeFundable | null {
  return snap?.fundable?.[`${config.walletAddress}:${config.network}`] ?? null;
}

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

  const supported = isCopyTradeNetwork(network);
  const canSign = walletKind !== "bankr" && !/watch[\s-]?only/i.test(custody);
  const supportedChains = walletChains.filter((c) => isCopyTradeNetwork(c.network));

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
    setDraft(defaultCopyTradingConfig({ id: "", agentId, walletAddress, network }));
  };

  const editConfig = (config: CopyTradingConfig) => {
    setError("");
    setShowAdv(false);
    setDraft({ ...config });
  };

  const save = async () => {
    if (!draft) return;
    setBusy("save");
    setError("");
    const res = await api({ action: "upsert", config: { ...draft, agentId, walletAddress, network } });
    setBusy(null);
    if (!res.ok) { setError(res.error || "Could not save."); return; }
    setDraft(null);
    await refresh();
  };

  const act = async (action: "start" | "stop" | "delete", id: string) => {
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
              emptyText="No copy configs on this wallet + chain yet."
            />
          </div>

          {draft ? (
            <ConfigForm
              draft={draft}
              setDraft={setDraft}
              showAdv={showAdv}
              setShowAdv={setShowAdv}
              busy={busy === "save"}
              error={error}
              onSave={save}
              onCancel={() => { setDraft(null); setError(""); }}
            />
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
    return (
      <div className={`${styles.status} ${styles.statusOk}`}>
        <span className={styles.statusDot} />
        Background engine running on <b style={{ color: "var(--fg)" }}>&nbsp;{snap.engine.host}</b>&nbsp;· {snap.engine.activeConfigs} active.
      </div>
    );
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
  onAct: (action: "start" | "stop" | "delete", id: string) => void;
  foreign?: boolean;
  emptyText: string;
}) {
  if (props.list.length === 0) {
    return props.emptyText ? <p className={styles.empty}>{props.emptyText}</p> : null;
  }
  return (
    <div className={styles.cards}>
      {props.list.map((c) => (
        <ConfigCard
          key={c.id}
          config={c}
          state={props.states[c.id]}
          fundable={props.fundable[`${c.walletAddress}:${c.network}`] ?? null}
          online={props.online}
          busy={props.busy}
          onEdit={props.onEdit}
          onAct={props.onAct}
          foreign={props.foreign}
        />
      ))}
    </div>
  );
}

function ConfigCard(props: {
  config: CopyTradingConfig;
  state?: CopyTradeRuntimeState;
  fundable?: CopyTradeFundable | null;
  online: boolean;
  busy: string | null;
  onEdit?: (c: CopyTradingConfig) => void;
  onAct: (action: "start" | "stop" | "delete", id: string) => void;
  foreign?: boolean;
}) {
  const { config, state, online } = props;
  const [expanded, setExpanded] = React.useState(false);
  const detailsId = React.useId();
  const pill = !config.enabled
    ? { cls: styles.pillStop, text: "Stopped" }
    : !online
    ? { cls: styles.pillStop, text: "Offline" }
    : config.dryRun
    ? { cls: styles.pillDry, text: "Dry-run" }
    : { cls: styles.pillRun, text: "Live" };
  const recent = (state?.events ?? []).slice(-3).reverse();
  const summary = state ? summarizeState(state) : null;
  const paper = config.dryRun ? state?.paper : undefined;
  const openCount = Object.keys((config.dryRun ? state?.paper?.positions : state?.openPositions) ?? {}).length;
  const totalPnl = paper ? paperTotalPnl(paper) : 0;

  return (
    <div className={`${styles.card}${props.foreign ? ` ${styles.foreign}` : ""}`}>
      <div className={styles.cardHead}>
        <span className="ti" style={{ flex: "0 0 auto" }}><BIcon name="copy" size={15} /></span>
        <span className={styles.cardTitle}>
          <b>{config.label?.trim() || `Copy ${shortAddr(config.targetAddress)}`}</b>
          <span>{shortAddr(config.targetAddress)} · {copyTradeNetworkLabel(config.network)} · max ${config.maxCopyUsd}/trade</span>
        </span>
        <span className={`${styles.pill} ${pill.cls}`}>{pill.text}</span>
        {state?.lastError && config.enabled ? <span className={`${styles.pill} ${styles.pillErr}`}>err</span> : null}
      </div>

      {props.fundable ? (
        <div className={styles.meta} title="What the copy-trader can spend from this wallet to mirror the copied trader's buys">
          <span>fundable <b>{fmtUsd(props.fundable.totalUsd)}</b></span>
          {props.fundable.assets.map((asset) => (
            <span key={asset.symbol}>{asset.symbol} <b>{fmtUsd(asset.usd)}</b></span>
          ))}
          {props.fundable.assets.length === 0 ? <span>no spendable balance</span> : null}
        </div>
      ) : null}

      {state ? (
        config.dryRun ? (
          <div className={styles.meta} title="Simulated paper-trading portfolio — no real funds are spent in dry-run">
            <span>signals <b>{summary?.signalCount ?? 0}</b></span>
            <span>sim fills <b>{paper?.mirrored ?? 0}</b></span>
            <span>sim cash <b>{fmtUsd(paper?.cashUsd ?? 0)}</b></span>
            <span>P&amp;L <b className={totalPnl < 0 ? styles.metricDanger : undefined}>{fmtSignedUsd(totalPnl)}</b></span>
            <span>open <b>{openCount}</b></span>
          </div>
        ) : (
          <div className={styles.meta}>
            <span>signals <b>{summary?.signalCount ?? 0}</b></span>
            <span>mirrored <b>{state.stats.mirrored}</b></span>
            <span>skipped <b>{state.stats.skipped}</b></span>
            <span>errors <b>{state.stats.errors}</b></span>
            <span>open <b>{openCount}</b></span>
          </div>
        )
      ) : config.enabled ? (
        <div className={styles.meta}>
          <span>{online ? "waiting for first poll" : "daemon offline"}</span>
        </div>
      ) : null}

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

      {expanded ? <ConfigPerformance id={detailsId} config={config} state={state} online={online} /> : null}

      <div className={styles.actions}>
        {config.enabled ? (
          <BBtn variant="ghost" sm disabled={props.busy != null} onClick={() => props.onAct("stop", config.id)}>Stop</BBtn>
        ) : (
          <BBtn variant="primary" sm disabled={props.busy != null} onClick={() => props.onAct("start", config.id)}>Start</BBtn>
        )}
        {props.onEdit ? <BBtn variant="ghost" sm disabled={props.busy != null} onClick={() => props.onEdit!(config)}>Edit</BBtn> : null}
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

function ConfigPerformance(props: { id: string; config: CopyTradingConfig; state?: CopyTradeRuntimeState; online: boolean }) {
  const { config, state, online } = props;
  const waiting = config.enabled && online && !state;
  const summary = state ? summarizeState(state) : null;
  const paper = config.dryRun ? state?.paper : undefined;
  const openPositions = Object.values((config.dryRun ? state?.paper?.positions : state?.openPositions) ?? {});
  const events = (state?.events ?? []).slice(-8).reverse();
  const loopStatus = !config.enabled ? "Stopped" : !online ? "Offline" : state?.running ? "Running" : "Waiting";
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

          {paper ? (
            <div className={styles.detailStats}>
              <DetailMetric label="Polls" value={fmtInt(state.stats.polls)} />
              <DetailMetric label="Signals" value={fmtInt(summary?.signalCount ?? 0)} />
              <DetailMetric label="Sim fills" value={fmtInt(paper.mirrored)} />
              <DetailMetric label="Skipped" value={fmtInt(state.stats.skipped)} />
              <DetailMetric label="Errors" value={fmtInt(state.stats.errors)} danger={state.stats.errors > 0} />
              <DetailMetric label="Open" value={fmtInt(openPositions.length)} />
              <DetailMetric label="Sim cash" value={fmtUsd(paper.cashUsd)} />
              <DetailMetric label="Start" value={fmtUsd(paper.startCashUsd)} />
              <DetailMetric label="Equity" value={fmtUsd(paperEquity(paper))} />
              <DetailMetric label="Realized" value={fmtSignedUsd(paper.realizedPnlUsd)} danger={paper.realizedPnlUsd < 0} />
              <DetailMetric label="Unrealized" value={fmtSignedUsd(paperUnrealizedPnl(paper))} danger={paperUnrealizedPnl(paper) < 0} />
              <DetailMetric label="Total P&L" value={fmtSignedUsd(paperTotalPnl(paper))} danger={paperTotalPnl(paper) < 0} />
            </div>
          ) : (
            <div className={styles.detailStats}>
              <DetailMetric label="Polls" value={fmtInt(state.stats.polls)} />
              <DetailMetric label="Signals" value={fmtInt(summary?.signalCount ?? 0)} />
              <DetailMetric label="Dry-run" value={fmtInt(summary?.dryRunActionCount ?? 0)} />
              <DetailMetric label="Mirrored" value={fmtInt(state.stats.mirrored)} />
              <DetailMetric label="Skipped" value={fmtInt(state.stats.skipped)} />
              <DetailMetric label="Errors" value={fmtInt(state.stats.errors)} danger={state.stats.errors > 0} />
              <DetailMetric label="Open" value={fmtInt(openPositions.length)} />
              <DetailMetric label="Logged USD" value={fmtUsd(summary?.loggedUsd ?? 0)} />
            </div>
          )}

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

/** Marked value of open paper positions (cost basis until first revalue). */
function paperOpenValue(paper: CopyTradePaperLedger): number {
  return Object.values(paper.positions ?? {}).reduce((sum, p) => sum + (p.markUsd ?? p.spentUsd), 0);
}

function paperEquity(paper: CopyTradePaperLedger): number {
  return paper.cashUsd + paperOpenValue(paper);
}

function paperUnrealizedPnl(paper: CopyTradePaperLedger): number {
  return Object.values(paper.positions ?? {}).reduce((sum, p) => sum + ((p.markUsd ?? p.spentUsd) - p.spentUsd), 0);
}

/** Total P&L = equity − starting bankroll = realized + unrealized. */
function paperTotalPnl(paper: CopyTradePaperLedger): number {
  return paperEquity(paper) - paper.startCashUsd;
}

function fmtSignedUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  return `${value < 0 ? "−" : "+"}${fmtUsd(Math.abs(value))}`;
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
  if (!Number.isFinite(value)) return "$0";
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 100 ? 2 : 0;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
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
