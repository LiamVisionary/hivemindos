"use client";

import React from "react";
import { Button } from "@/design-system/ui/button";
import { useVisibilityAwarePolling } from "@/features/dashboard/hooks/use-visibility-aware-polling";
import {
  defaultLiquidityRangeConfig,
  type LiquidityPositionSnapshot,
  type LiquidityRangeConfig,
  type LiquidityRangeDecision,
  type LiquidityRangeEngineStatus,
  type LiquidityRangeRuntimeState,
} from "@/lib/types/liquidity-range-manager";
import styles from "./LiquidityRangeManagerPanel.module.css";

type Props = { agentId: string; walletAddress: string };
type Snapshot = {
  configs: LiquidityRangeConfig[];
  states: Record<string, LiquidityRangeRuntimeState>;
  engine: LiquidityRangeEngineStatus | null;
  online: boolean;
};
type ApiResult = {
  ok: boolean;
  error?: string;
  config?: LiquidityRangeConfig;
  snapshot?: LiquidityPositionSnapshot;
  decision?: LiquidityRangeDecision;
  state?: LiquidityRangeRuntimeState;
};

export function LiquidityRangeManagerPanel({ agentId, walletAddress }: Props) {
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [draft, setDraft] = React.useState<LiquidityRangeConfig>(() => defaultLiquidityRangeConfig({ id: "", tokenId: "", agentId, walletAddress }));
  const [inspection, setInspection] = React.useState<{ snapshot: LiquidityPositionSnapshot; decision: LiquidityRangeDecision } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");

  const refresh = React.useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/trading/liquidity-range", { cache: "no-store", headers: { accept: "application/json" }, signal }).catch(() => null);
    if (!response) return;
    const data = await response.json().catch(() => null) as ({ ok: boolean } & Snapshot) | null;
    if (data?.ok) setSnapshot({ configs: data.configs ?? [], states: data.states ?? {}, engine: data.engine ?? null, online: Boolean(data.online) });
  }, []);

  useVisibilityAwarePolling({ enabled: true, intervalMs: 10_000, hiddenIntervalMs: null, task: refresh });

  const updatePolicy = (key: keyof LiquidityRangeConfig, value: number) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setInspection(null);
  };

  const inspect = async () => {
    setBusy("inspect");
    setError("");
    const result = await post({ action: "inspect", tokenId: draft.tokenId, config: draft });
    setBusy(null);
    if (!result.ok || !result.snapshot || !result.decision) {
      setError(result.error || "Could not inspect that position.");
      return;
    }
    setInspection({ snapshot: result.snapshot, decision: result.decision });
  };

  const save = async () => {
    setBusy("save");
    setError("");
    const result = await post({ action: "upsert", config: { ...draft, agentId, walletAddress } });
    setBusy(null);
    if (!result.ok || !result.config) {
      setError(result.error || "Could not save the shadow monitor.");
      return;
    }
    setDraft(defaultLiquidityRangeConfig({ id: "", tokenId: "", agentId, walletAddress }));
    setInspection(null);
    await refresh();
  };

  const act = async (action: "start" | "stop" | "delete" | "run-once", id: string) => {
    if (action === "delete" && !window.confirm("Delete this shadow liquidity monitor? Its local runtime history will also be removed.")) return;
    setBusy(`${action}:${id}`);
    setError("");
    const result = await post({ action, id });
    setBusy(null);
    if (!result.ok) setError(result.error || "The monitor action failed.");
    await refresh();
  };

  const configs = snapshot?.configs ?? [];
  const ownerMismatch = Boolean(inspection && walletAddress && inspection.snapshot.owner.toLowerCase() !== walletAddress.toLowerCase());

  return (
    <div className={styles.root}>
      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>Automated concentrated-liquidity market making</div>
          <h1>Range manager</h1>
          <p>Watch a real Base Uniswap v3 position, compare recovered fees with gas and impermanent-loss assumptions, and recenter a shadow range only when the policy clears every gate.</p>
        </div>
        <div className={styles.safetyCard}>
          <span className={styles.safetyDot} />
          <div><b>Shadow-only by construction</b><small>No signer, approvals, calldata, or transaction submission.</small></div>
        </div>
      </section>

      <div className={styles.layout}>
        <section className={styles.builder}>
          <div className={styles.sectionHead}>
            <div><span>01</span><div><h2>Import a position</h2><p>Base · Uniswap v3 position NFT</p></div></div>
            <a href="https://app.uniswap.org/positions" target="_blank" rel="noreferrer">Find NFT ID ↗</a>
          </div>

          <label className={styles.field}>
            <span>Position NFT ID</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={draft.tokenId}
              onChange={(event) => {
                setDraft((current) => ({ ...current, tokenId: event.target.value.replace(/\D/g, "") }));
                setInspection(null);
              }}
              placeholder="e.g. 123456"
              aria-describedby="position-id-help"
            />
            <small id="position-id-help">Read from the official Base position-manager contract. Importing grants no permissions.</small>
          </label>

          <div className={styles.sectionRule} />
          <div className={styles.sectionHead}>
            <div><span>02</span><div><h2>Set the policy</h2><p>Deterministic, bounded, explainable</p></div></div>
          </div>

          <div className={styles.policyGrid}>
            <SelectField label="Target range" value={draft.targetWidthBps} options={[[200, "±1%"], [400, "±2%"], [800, "±4%"], [1600, "±8%"]]} onChange={(value) => updatePolicy("targetWidthBps", value)} />
            <SelectField label="Edge trigger" value={draft.triggerBufferBps} options={[[25, "25 bps"], [75, "75 bps"], [150, "150 bps"], [300, "300 bps"]]} onChange={(value) => updatePolicy("triggerBufferBps", value)} />
            <SelectField label="Cooldown" value={draft.minHoursBetweenRebalances} options={[[3, "3 hours"], [6, "6 hours"], [12, "12 hours"], [24, "24 hours"]]} onChange={(value) => updatePolicy("minHoursBetweenRebalances", value)} />
            <SelectField label="Evaluation window" value={draft.evaluationHorizonDays} options={[[1, "1 day"], [7, "7 days"], [14, "14 days"], [30, "30 days"]]} onChange={(value) => updatePolicy("evaluationHorizonDays", value)} />
            <SelectField label="Fee APR assumption" value={draft.feeAprPct} options={[[10, "10%"], [25, "25%"], [50, "50%"], [100, "100%"]]} onChange={(value) => updatePolicy("feeAprPct", value)} />
            <SelectField label="Gas estimate" value={draft.gasCostUsd} options={[[0.1, "$0.10"], [0.25, "$0.25"], [1, "$1.00"], [5, "$5.00"]]} onChange={(value) => updatePolicy("gasCostUsd", value)} />
            <SelectField label="IL / inventory cost" value={draft.estimatedIlCostUsd} options={[[0, "$0"], [2, "$2"], [10, "$10"], [50, "$50"]]} onChange={(value) => updatePolicy("estimatedIlCostUsd", value)} />
            <SelectField label="Minimum net benefit" value={draft.minNetBenefitUsd} options={[[1, "$1"], [3, "$3"], [10, "$10"], [25, "$25"]]} onChange={(value) => updatePolicy("minNetBenefitUsd", value)} />
          </div>

          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          <div className={styles.actions}>
            <Button variant="outline" onClick={() => void inspect()} isLoading={busy === "inspect"} disabled={!draft.tokenId}>Inspect position</Button>
            <Button onClick={() => void save()} isLoading={busy === "save"} disabled={!inspection}>Save shadow monitor</Button>
          </div>
        </section>

        <section className={styles.preview} aria-live="polite">
          {!inspection ? <PreviewPlaceholder busy={busy === "inspect"} /> : (
            <PositionPreview snapshot={inspection.snapshot} decision={inspection.decision} ownerMismatch={ownerMismatch} />
          )}
        </section>
      </div>

      <section className={styles.monitors}>
        <div className={styles.monitorHead}>
          <div><div className={styles.eyebrow}>Always-on observers</div><h2>Saved monitors</h2></div>
          <EngineBadge online={Boolean(snapshot?.online)} active={configs.filter((config) => config.enabled).length} />
        </div>
        {configs.some((config) => config.enabled) && !snapshot?.online ? (
          <div className={styles.daemonNotice}>
            <div><b>Background monitor is offline</b><span>Install it once to keep observing with HivemindOS closed.</span></div>
            <code>scripts/install-liquidity-range-manager.sh</code>
          </div>
        ) : null}
        {!snapshot ? <MonitorSkeleton /> : configs.length === 0 ? (
          <div className={styles.empty}>No saved monitors yet. Inspect a position and save its shadow policy above.</div>
        ) : (
          <div className={styles.monitorGrid}>
            {configs.map((config) => (
              <MonitorCard key={config.id} config={config} state={snapshot.states[config.id]} busy={busy} onAction={act} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PositionPreview({ snapshot, decision, ownerMismatch }: { snapshot: LiquidityPositionSnapshot; decision: LiquidityRangeDecision; ownerMismatch: boolean }) {
  const marker = rangeMarker(snapshot.currentTick, snapshot.tickLower, snapshot.tickUpper);
  return <>
    <div className={styles.previewTop}>
      <div><span className={styles.protocolMark}>v3</span><div><b>{snapshot.token0.symbol} / {snapshot.token1.symbol}</b><small>{snapshot.feePercent}% fee · NFT #{snapshot.tokenId}</small></div></div>
      <StatusPill status={decision.status} />
    </div>
    <div className={styles.priceMetric}><small>Current price</small><b>{formatPrice(snapshot.currentPrice)}</b><span>{snapshot.quoteLabel}</span></div>
    <div className={styles.rangeTrack}>
      <span className={styles.rangeFill} />
      <span className={styles.rangeMarker} style={{ left: `${marker}%` }} />
    </div>
    <div className={styles.rangeLabels}><span>{formatPrice(snapshot.lowerPrice)}</span><span>{formatPrice(snapshot.upperPrice)}</span></div>
    <div className={styles.metrics}>
      <Metric label="Position value" value={snapshot.positionValueUsd == null ? "Not USD-priced" : usd(snapshot.positionValueUsd)} />
      <Metric label="Range distance" value={decision.status === "out-of-range" ? "Inactive" : `${Math.round(decision.distanceToNearestEdgeBps)} bps`} />
      <Metric label="Recovered fees" value={nullableUsd(decision.expectedRecoveredFeesUsd)} />
      <Metric label="Net benefit" value={nullableUsd(decision.expectedNetBenefitUsd)} tone={decision.economicGatePassed ? "good" : undefined} />
    </div>
    <div className={styles.decision} data-action={decision.action}>
      <span>{decision.action === "propose-rebalance" ? "Propose shadow rebalance" : decision.action === "watch" ? "Watch" : "Hold"}</span>
      <p>{decision.reasons[0]}</p>
      {decision.reasons.slice(1).map((reason) => <small key={reason}>{reason}</small>)}
    </div>
    {ownerMismatch ? <div className={styles.ownerNote}>This NFT is owned by a different address than the acting wallet. Read-only monitoring still works; no ownership claim is made.</div> : null}
    <div className={styles.source}>Base block {snapshot.blockNumber} · {shortAddress(snapshot.poolAddress)} · observed {new Date(snapshot.observedAt).toLocaleTimeString()}</div>
  </>;
}

function MonitorCard({ config, state, busy, onAction }: { config: LiquidityRangeConfig; state?: LiquidityRangeRuntimeState; busy: string | null; onAction: (action: "start" | "stop" | "delete" | "run-once", id: string) => Promise<void> }) {
  const decision = state?.lastDecision;
  return <article className={styles.monitorCard}>
    <div className={styles.cardHead}>
      <div><b>{config.label}</b><small>Base · shadow · {config.targetWidthBps / 200}% each side</small></div>
      <StatusPill status={state?.error ? "error" : decision?.status ?? (config.enabled ? "watching" : "stopped")} />
    </div>
    <div className={styles.cardMetrics}>
      <Metric label="Decision" value={decision?.action ?? "Waiting"} />
      <Metric label="Net benefit" value={nullableUsd(decision?.expectedNetBenefitUsd ?? null)} />
      <Metric label="Last check" value={state?.lastCheckedAt ? relativeTime(state.lastCheckedAt) : "Never"} />
    </div>
    {state?.shadowRange ? <div className={styles.shadowReceipt}>Shadow range {state.shadowRange.tickLower} → {state.shadowRange.tickUpper}</div> : null}
    {state?.error ? <div className={styles.cardError}>{state.error}</div> : null}
    <div className={styles.cardActions}>
      <Button size="sm" variant={config.enabled ? "outline" : "default"} isLoading={busy === `${config.enabled ? "stop" : "start"}:${config.id}`} onClick={() => void onAction(config.enabled ? "stop" : "start", config.id)}>{config.enabled ? "Stop" : "Start monitor"}</Button>
      <Button size="sm" variant="outline" isLoading={busy === `run-once:${config.id}`} onClick={() => void onAction("run-once", config.id)}>Run once</Button>
      <Button size="sm" variant="ghost" onClick={() => void onAction("delete", config.id)}>Delete</Button>
    </div>
    {state?.events?.length ? <div className={styles.events}>{state.events.slice(-3).reverse().map((event) => <div key={`${event.at}:${event.kind}`}><span>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><p>{event.message}</p></div>)}</div> : null}
  </article>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: number; options: Array<[number, string]>; onChange: (value: number) => void }) {
  return <label className={styles.field}><span>{label}</span><select value={value} onChange={(event) => onChange(Number(event.target.value))}>{options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select></label>;
}

function PreviewPlaceholder({ busy }: { busy: boolean }) {
  return <div className={styles.placeholder} data-busy={busy || undefined}><span className={styles.orbit}><i /></span><b>{busy ? "Reading the position…" : "Inspect an LP position"}</b><p>{busy ? "Resolving the NFT, pool, ticks, tokens, and current Base price." : "The live range, fee tier, value estimate, and policy decision will appear here."}</p></div>;
}

function MonitorSkeleton() { return <div className={styles.monitorGrid}><div className={styles.skeleton} /><div className={styles.skeleton} /></div>; }
function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" }) { return <div className={styles.metric} data-tone={tone}><small>{label}</small><b>{value}</b></div>; }
function EngineBadge({ online, active }: { online: boolean; active: number }) { return <span className={styles.engineBadge} data-online={online || undefined}><i />{online ? `Daemon online · ${active} active` : active ? "Daemon offline" : "No active monitors"}</span>; }
function StatusPill({ status }: { status: string }) { return <span className={styles.statusPill} data-status={status}>{status.replaceAll("-", " ")}</span>; }

async function post(body: unknown): Promise<ApiResult> {
  const response = await fetch("/api/trading/liquidity-range", { method: "POST", headers: { "Content-Type": "application/json", accept: "application/json" }, body: JSON.stringify(body), cache: "no-store" }).catch(() => null);
  if (!response) return { ok: false, error: "Network error." };
  return await response.json().catch(() => ({ ok: false, error: "Invalid server response." })) as ApiResult;
}

function rangeMarker(current: number, lower: number, upper: number) { return Math.min(100, Math.max(0, ((current - lower) / Math.max(1, upper - lower)) * 100)); }
function formatPrice(value: number) { if (!Number.isFinite(value)) return "—"; if (value >= 1_000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 }); if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 4 }); return value.toPrecision(5); }
function usd(value: number) { return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }); }
function nullableUsd(value: number | null) { return value == null ? "Unpriced" : usd(value); }
function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function relativeTime(value: number) { const minutes = Math.max(0, Math.round((Date.now() - value) / 60_000)); return minutes < 1 ? "Just now" : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`; }
