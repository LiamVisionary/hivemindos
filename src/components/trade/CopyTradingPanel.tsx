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
  type CopyTradeEngineStatus,
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

export function CopyTradingPanel(props: Props) {
  const { agentId, walletShort, walletAddress, walletKind, custody, network, walletChains, onSelectChain } = props;
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [draft, setDraft] = React.useState<CopyTradingConfig | null>(null);
  const [showAdv, setShowAdv] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");

  const supported = isCopyTradeNetwork(network);
  const canSign = walletKind !== "bankr" && !/watch[\s-]?only/i.test(custody);
  const supportedChains = walletChains.filter((c) => isCopyTradeNetwork(c.network));

  const refresh = React.useCallback(async (signal?: AbortSignal) => {
    const res = await fetch("/api/trading/copy-trade", { headers: { accept: "application/json" }, cache: "no-store", signal }).catch(() => null);
    if (!res) return;
    const data = (await res.json().catch(() => null)) as ({ ok: boolean } & Snapshot) | null;
    if (data?.ok) setSnap({ configs: data.configs ?? [], states: data.states ?? {}, engine: data.engine ?? null, online: Boolean(data.online) });
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

  const configs = snap?.configs ?? [];
  const mine = configs.filter((c) => c.agentId === agentId && c.network === network);
  const others = configs.filter((c) => !(c.agentId === agentId && c.network === network));

  return (
    <div className={styles.wrap}>
      <EngineStatus snap={snap} />

      {!supported ? (
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

      {others.length ? (
        <div>
          <div className={styles.sectionLbl}>Other wallets &amp; chains</div>
          <ConfigList
            list={others}
            states={snap?.states ?? {}}
            online={snap?.online ?? false}
            busy={busy}
            onEdit={undefined}
            onAct={act}
            foreign
            emptyText=""
          />
        </div>
      ) : null}

      {error && !draft ? <p className={styles.err}>{error}</p> : null}

      <p className={styles.cap}>
        Mirrors run server-side, capped at ${MAX_COPY_TRADE_USD}/swap with your wallet&apos;s spend governance. New configs
        start in <b>dry-run</b> (detect &amp; log only) until you turn it off. Switching the acting wallet does not stop
        a running config.
      </p>
    </div>
  );
}

function EngineStatus({ snap }: { snap: Snapshot | null }) {
  if (!snap) return null;
  if (snap.online && snap.engine) {
    return (
      <div className={`${styles.status} ${styles.statusOk}`}>
        <span className={styles.statusDot} />
        Background engine running on <b style={{ color: "var(--fg)" }}>&nbsp;{snap.engine.host}</b>&nbsp;· {snap.engine.activeConfigs} active.
      </div>
    );
  }
  return (
    <div className={`${styles.status} ${styles.statusOff}`}>
      <span className={styles.statusDot} />
      Background engine offline — configs won&apos;t run until it&apos;s started. Run <span className={styles.statusCmd}>pnpm copy-trading:daemon</span> (or install the service).
    </div>
  );
}

function ConfigList(props: {
  list: CopyTradingConfig[];
  states: Record<string, CopyTradeRuntimeState>;
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
  online: boolean;
  busy: string | null;
  onEdit?: (c: CopyTradingConfig) => void;
  onAct: (action: "start" | "stop" | "delete", id: string) => void;
  foreign?: boolean;
}) {
  const { config, state, online } = props;
  const pill = !config.enabled
    ? { cls: styles.pillStop, text: "Stopped" }
    : !online
    ? { cls: styles.pillStop, text: "Offline" }
    : config.dryRun
    ? { cls: styles.pillDry, text: "Dry-run" }
    : { cls: styles.pillRun, text: "Live" };
  const recent = (state?.events ?? []).slice(-3).reverse();

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

      {state ? (
        <div className={styles.meta}>
          <span>mirrored <b>{state.stats.mirrored}</b></span>
          <span>skipped <b>{state.stats.skipped}</b></span>
          <span>errors <b>{state.stats.errors}</b></span>
          <span>open <b>{Object.keys(state.openPositions).length}</b></span>
        </div>
      ) : null}

      {recent.length ? (
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

      <div className={styles.actions}>
        {config.enabled ? (
          <BBtn variant="ghost" sm disabled={props.busy != null} onClick={() => props.onAct("stop", config.id)}>Stop</BBtn>
        ) : (
          <BBtn variant="primary" sm disabled={props.busy != null} onClick={() => props.onAct("start", config.id)}>Start</BBtn>
        )}
        {props.onEdit ? <BBtn variant="ghost" sm disabled={props.busy != null} onClick={() => props.onEdit!(config)}>Edit</BBtn> : null}
        <span className={styles.spacer} />
        <BBtn variant="ghost" sm disabled={props.busy != null} onClick={() => props.onAct("delete", config.id)}>Remove</BBtn>
      </div>
    </div>
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
          Dry-run <span className={styles.toggleHint}>(detect &amp; log, no real swaps)</span>
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

function shortAddr(address: string): string {
  if (!address) return "—";
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
