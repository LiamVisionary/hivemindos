"use client";

import { useMemo, useState } from "react";
import { Plus, RotateCcw, Trash2, Unplug } from "lucide-react";

import {
  DEFAULT_MARKETPLACE_BACKOFF_LADDER,
  DEFAULT_MARKETPLACE_MONITOR_CONFIG,
  type MarketplaceBackoffRung,
  type MarketplaceChatAutonomy,
} from "@/lib/services/marketplace/marketplace-types";

import { useMarketplaceDesk } from "./marketplace-context";
import { Panel, SectionLabel, Spinner, ghostButtonStyle } from "./primitives";

/**
 * Settings tab: check cadence (base interval preset + the exponential backoff
 * ladder as preset-dropdown rows — structured data, never free-text config),
 * the autonomy knob, standing rules, and connection status. Every save is a
 * typed accounts-route action.
 */

const DURATION_PRESETS: Array<{ label: string; ms: number }> = [
  { label: "10 seconds", ms: 10_000 },
  { label: "30 seconds", ms: 30_000 },
  { label: "1 minute", ms: 60_000 },
  { label: "5 minutes", ms: 300_000 },
  { label: "10 minutes", ms: 600_000 },
  { label: "30 minutes", ms: 1_800_000 },
  { label: "1 hour", ms: 3_600_000 },
  { label: "2 hours", ms: 7_200_000 },
  { label: "6 hours", ms: 21_600_000 },
];

const BASE_INTERVAL_PRESETS = DURATION_PRESETS.filter((preset) => preset.ms >= 600_000);
const MAX_LADDER_RUNGS = 5;

const AUTONOMY_OPTIONS: Array<{ mode: MarketplaceChatAutonomy; title: string; body: string }> = [
  { mode: "autonomous", title: "Fully autonomous", body: "The agent answers buyers and negotiates within your bounds; only out-of-bounds offers and odd situations come to you." },
  { mode: "escalate-decisions", title: "Auto for routine, ask on decisions", body: "Routine questions are handled; every offer and negotiation becomes a decision card." },
  { mode: "review-all", title: "Review every reply", body: "Nothing is sent to a buyer without your approval — each reply arrives as a draft to review." },
];

function durationLabel(ms: number): string {
  const preset = DURATION_PRESETS.find((candidate) => candidate.ms === ms);
  if (preset) return preset.label;
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`;
}

const selectStyle: React.CSSProperties = {
  padding: "7px 10px", borderRadius: 9, fontSize: 12.5,
  background: "var(--panel-2)", border: "1px solid var(--line-2)", color: "var(--fg)", fontFamily: "var(--f-body)",
};

export function MonitoringSettingsCard() {
  const desk = useMarketplaceDesk();
  const account = desk.activeAccount;
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newRuleText, setNewRuleText] = useState("");

  const monitor = account?.monitor ?? DEFAULT_MARKETPLACE_MONITOR_CONFIG;
  const ladder = monitor.ladder.length ? monitor.ladder : DEFAULT_MARKETPLACE_BACKOFF_LADDER;
  const accountDirectives = useMemo(
    () => desk.directives.filter((directive) => directive.scope === "global" || directive.accountId === account?.id),
    [desk.directives, account?.id],
  );

  if (!account) return null;

  const save = async (key: string, body: Record<string, unknown>) => {
    setSavingKey(key);
    try {
      await desk.runAccountsAction({ id: account.id, ...body });
    } finally {
      setSavingKey(null);
    }
  };

  const saveLadder = (nextLadder: MarketplaceBackoffRung[], baseIntervalMs = monitor.baseIntervalMs) =>
    save("monitor", { action: "update-monitor", monitor: { ...monitor, baseIntervalMs, ladder: nextLadder } });

  const patchRung = (index: number, patch: Partial<MarketplaceBackoffRung>) => {
    const next = ladder.map((rung, i) => (i === index ? { ...rung, ...patch } : { ...rung }));
    void saveLadder(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 760 }}>
      {/* Cadence */}
      <Panel>
        <SectionLabel right={savingKey === "monitor" ? <Spinner size={12} style={{ color: "var(--fg-3)" }} /> : undefined}>
          Check cadence
        </SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <span style={{ fontSize: 13 }}>When quiet, check the marketplace every</span>
          <select
            style={selectStyle}
            aria-label="Base check interval"
            value={monitor.baseIntervalMs}
            onChange={(event) => void saveLadder(ladder, Number(event.target.value))}
          >
            {BASE_INTERVAL_PRESETS.map((preset) => (
              <option key={preset.ms} value={preset.ms}>{preset.label}</option>
            ))}
            {BASE_INTERVAL_PRESETS.every((preset) => preset.ms !== monitor.baseIntervalMs) ? (
              <option value={monitor.baseIntervalMs}>{durationLabel(monitor.baseIntervalMs)}</option>
            ) : null}
          </select>
        </div>

        <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--fg-3)", lineHeight: 1.55 }}>
          After the agent replies to a buyer it watches closely, then relaxes step by step back to the quiet cadence:
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ladder.map((rung, index) => (
            <div key={index} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
              <span style={{ color: "var(--fg-3)", width: 14, fontFamily: "var(--f-mono)" }}>{index + 1}.</span>
              <span>{index === 0 ? "Right after a reply" : "Once quiet for"}</span>
              {index === 0 ? null : (
                <select
                  style={selectStyle}
                  aria-label={`Step ${index + 1}: quiet duration`}
                  value={rung.afterQuietMs}
                  onChange={(event) => patchRung(index, { afterQuietMs: Number(event.target.value) })}
                >
                  {DURATION_PRESETS.filter((preset) => preset.ms > (ladder[index - 1]?.afterQuietMs ?? 0) && preset.ms < monitor.ladderResetMs).map((preset) => (
                    <option key={preset.ms} value={preset.ms}>{preset.label}</option>
                  ))}
                  {DURATION_PRESETS.every((preset) => preset.ms !== rung.afterQuietMs) ? (
                    <option value={rung.afterQuietMs}>{durationLabel(rung.afterQuietMs)}</option>
                  ) : null}
                </select>
              )}
              <span>check every</span>
              <select
                style={selectStyle}
                aria-label={`Step ${index + 1}: check interval`}
                value={rung.intervalMs}
                onChange={(event) => patchRung(index, { intervalMs: Number(event.target.value) })}
              >
                {DURATION_PRESETS.filter((preset) => preset.ms >= (ladder[index - 1]?.intervalMs ?? 0) && preset.ms <= monitor.baseIntervalMs).map((preset) => (
                  <option key={preset.ms} value={preset.ms}>{preset.label}</option>
                ))}
                {DURATION_PRESETS.every((preset) => preset.ms !== rung.intervalMs) ? (
                  <option value={rung.intervalMs}>{durationLabel(rung.intervalMs)}</option>
                ) : null}
              </select>
              {index > 0 ? (
                <button
                  type="button"
                  aria-label={`Remove step ${index + 1}`}
                  onClick={() => void saveLadder(ladder.filter((_, i) => i !== index))}
                  style={{ background: "transparent", border: "none", color: "var(--fg-4)", cursor: "pointer", padding: 4 }}
                >
                  <Trash2 aria-hidden width={13} height={13} />
                </button>
              ) : null}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--fg-3)" }}>
            <span style={{ width: 14 }} />
            <span>…then back to every {durationLabel(monitor.baseIntervalMs)} once quiet for {durationLabel(monitor.ladderResetMs)}.</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          {ladder.length < MAX_LADDER_RUNGS ? (
            <button
              type="button"
              style={ghostButtonStyle()}
              onClick={() => {
                const last = ladder[ladder.length - 1];
                const nextQuiet = DURATION_PRESETS.find((preset) => preset.ms > last.afterQuietMs && preset.ms < monitor.ladderResetMs);
                const nextInterval = DURATION_PRESETS.find((preset) => preset.ms >= last.intervalMs && preset.ms <= monitor.baseIntervalMs);
                if (!nextQuiet || !nextInterval) return;
                void saveLadder([...ladder, { afterQuietMs: nextQuiet.ms, intervalMs: nextInterval.ms }]);
              }}
            >
              <Plus aria-hidden width={13} height={13} />
              Add a step
            </button>
          ) : null}
          <button type="button" style={ghostButtonStyle()} onClick={() => void saveLadder(DEFAULT_MARKETPLACE_BACKOFF_LADDER.map((rung) => ({ ...rung })), DEFAULT_MARKETPLACE_MONITOR_CONFIG.baseIntervalMs)}>
            <RotateCcw aria-hidden width={13} height={13} />
            Reset to default
          </button>
        </div>
      </Panel>

      {/* Autonomy */}
      <Panel>
        <SectionLabel right={savingKey === "autonomy" ? <Spinner size={12} style={{ color: "var(--fg-3)" }} /> : undefined}>
          How much runs without you
        </SectionLabel>
        <div role="radiogroup" aria-label="Buyer-chat autonomy" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {AUTONOMY_OPTIONS.map((option) => {
            const active = account.autonomy === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => void save("autonomy", { action: "update-autonomy", autonomy: option.mode })}
                style={{
                  textAlign: "left", padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                  border: `1px solid ${active ? "var(--honey-line)" : "var(--line-2)"}`,
                  background: active ? "var(--honey-soft)" : "transparent", color: "var(--fg)",
                  fontFamily: "var(--f-body)",
                }}
              >
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: active ? "var(--honey)" : "var(--fg)" }}>{option.title}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--fg-3)", marginTop: 3, lineHeight: 1.5 }}>{option.body}</span>
              </button>
            );
          })}
        </div>
      </Panel>

      {/* Locale */}
      <Panel>
        <SectionLabel right={savingKey === "locale" ? <Spinner size={12} style={{ color: "var(--fg-3)" }} /> : undefined}>
          Price research locale
        </SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input
            aria-label="Selling locale (city, region)"
            style={{ ...selectStyle, minWidth: 240 }}
            placeholder="e.g. Sarasota, FL"
            defaultValue={account.locale.description}
            onBlur={(event) => {
              const description = event.target.value.trim();
              if (description !== account.locale.description) {
                void save("locale", { action: "update-locale", locale: { ...account.locale, description } });
              }
            }}
          />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={account.locale.globalComparison}
              onChange={(event) => void save("locale", { action: "update-locale", locale: { ...account.locale, globalComparison: event.target.checked } })}
            />
            Compare against global prices by default
          </label>
        </div>
      </Panel>

      {/* Standing rules */}
      <Panel>
        <SectionLabel>Standing rules</SectionLabel>
        {accountDirectives.length === 0 ? (
          <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.55 }}>
            None yet. Rules you save from decision cards ("ignore low offers like this from now on") land here, and the agent
            reads them on every run.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {accountDirectives.map((directive) => (
              <div key={directive.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12.5, lineHeight: 1.5 }}>
                <span style={{ flex: 1 }}>
                  {directive.text}
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 2 }}>
                    {directive.scope === "global" ? "all accounts" : "this account"} · {directive.source === "decision-note" ? "from a decision" : "added here"} · {new Date(directive.createdAt).toLocaleDateString()}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove rule: ${directive.text}`}
                  onClick={() => void desk.removeDirective(directive.id)}
                  style={{ background: "transparent", border: "none", color: "var(--fg-4)", cursor: "pointer", padding: 4 }}
                >
                  <Trash2 aria-hidden width={13} height={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const text = newRuleText.trim();
            if (!text) return;
            void (async () => {
              setSavingKey("rule");
              try {
                await fetch("/api/marketplace/directives", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "add", text, scope: "account", accountId: account.id }),
                });
                setNewRuleText("");
                await desk.refresh();
              } finally {
                setSavingKey(null);
              }
            })();
          }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            aria-label="New standing rule"
            style={{ ...selectStyle, flex: 1 }}
            placeholder="e.g. Never hold items without a deposit"
            value={newRuleText}
            onChange={(event) => setNewRuleText(event.target.value)}
          />
          <button type="submit" style={ghostButtonStyle()} disabled={savingKey === "rule" || !newRuleText.trim()}>
            {savingKey === "rule" ? <Spinner size={12} /> : <Plus aria-hidden width={13} height={13} />}
            Add rule
          </button>
        </form>
      </Panel>

      {/* Connection */}
      <Panel>
        <SectionLabel>Connection</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12.5 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span className={`mkt-dot${account.status === "connected" ? " live" : ""}`} style={{ color: account.status === "connected" ? "var(--live)" : account.status === "needs-attention" ? "var(--honey)" : "var(--fg-4)" }} />
            {account.status === "connected" ? "Signed in" : account.status === "needs-attention" ? "Needs attention — sign in again" : "Disconnected"}
          </span>
          <span style={{ color: "var(--fg-3)" }}>Browser profile on {account.machine.machineName}</span>
          <span style={{ flex: 1 }} />
          {account.status !== "connected" ? (
            <button type="button" style={ghostButtonStyle()} onClick={() => desk.setConnectOpen(true)}>
              Sign in again
            </button>
          ) : null}
          <button
            type="button"
            style={{ ...ghostButtonStyle(), color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 35%, transparent)" }}
            onClick={() => void (async () => {
              await fetch("/api/marketplace/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "disconnect", accountId: account.id }),
              });
              await desk.refresh();
            })()}
          >
            <Unplug aria-hidden width={13} height={13} />
            Disconnect
          </button>
        </div>
      </Panel>
    </div>
  );
}
