/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/exhaustive-deps, @next/next/no-img-element, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unused-expressions --
   Pre-existing drop-in patterns (prop->state sync effects, render-time runtime-data application,
   unused destructured aliases) preserved verbatim during the @ts-nocheck removal typing pass. */
"use client";
import React from "react";
import "./wallets.css";
import * as D from "./wallet-data";
import type { DropInWallet, WalletBankrInfo, WalletHolding, WalletRail, WalletRailId, WalletRuntimeData, WalletTokenMeta } from "./wallet-data";
import { chainBadgeSrc, type GroupedPersonalWallet } from "@/lib/utils/personal-wallet-grouping";
import { CreateImportWalletModal } from "./CreateImportWalletModal";
import { WalletRewardsActions, type WalletRewardsActionsSlice } from "./WalletRewardsActions";
import { WalletSecretExportSheet } from "./WalletSecretExportSheet";

type WalletSendResult = {
  ok?: boolean;
  error?: string;
  signature?: string;
  transfer?: { transactionHash?: string };
  shield?: { transactionHash?: string };
  status?: string;
};

type WalletFundResult = WalletSendResult & { recipientBalanceUsd?: number };

type WalletSecretExportResultLike = {
  ok?: boolean;
  error?: string;
  exportedCount?: number;
  label?: string;
  savedPath?: string;
};

type WalletModalActionInput = { wallet?: unknown; name?: string; chain?: string; secret?: string };

export type WalletDropInActions = WalletRewardsActionsSlice & {
  onToggleAgentSpend?: (agentId: string, enabled: boolean) => unknown;
  onUpdateAgentWallet?: (agentId: string, patch: Record<string, unknown>) => unknown;
  onCreateAgentWallet?: (agentId: string, network: string) => unknown;
  onRefreshAgentWallet?: (agentId: string) => unknown;
  onResetAgentRunway?: (agentId: string) => unknown;
  onCopyAgentPrompt?: (agentId: string) => unknown;
  onOpenLlmFundingSource?: (agentId: string) => unknown;
  onExportAgentWallet?: (walletId: string, confirmation: string) => Promise<WalletSecretExportResultLike> | WalletSecretExportResultLike;
  onSendAgentPayment?: (input: { agentId: string; asset: string; amount: string; amountUsd?: number; toAddress: string; recipientAgentId?: string; confirmation: string }) => Promise<WalletSendResult | null | undefined>;
  onSaveRailConfig?: (input: { rail: WalletRail; enabled: boolean; key: string; share: boolean }) => Promise<{ ok?: boolean; error?: string; rail?: Partial<WalletRail> } | null | undefined>;
  onRefreshUsePod?: (agentId?: string) => unknown;
  onSetUsePodRoutingMode?: (mode: string) => unknown;
  onSaveUsePodRepair?: (value: string) => Promise<unknown>;
  onFundAgent?: (input: { source?: GroupedPersonalWallet | null; agentId?: string; asset: string; amount: string; confirmation: string }) => Promise<WalletFundResult | null | undefined>;
  onSendPersonalWallet?: (input: { source: GroupedPersonalWallet; asset: string; amount: string; toAddress: string; confirmation: string }) => Promise<WalletSendResult | null | undefined>;
  onRenamePersonalWallet?: (input: { source: GroupedPersonalWallet; name: string }) => Promise<unknown>;
  onCreateWallet?: (input: WalletModalActionInput) => Promise<unknown>;
  onImportWallet?: (input: WalletModalActionInput) => Promise<unknown>;
  onOpenRailDocs?: (rail: { baseUrl?: string }) => unknown;
  onToggleHoneyLedger?: (enabled: boolean) => unknown;
  onMessageHive?: (text: string) => unknown;
};
const {
  FR_CCY, FR_MACHINES, frFmtAmount, frFmtUsd, frFmtUsdFull, frFmtChange, frTopBalances,
  frStateMeta, frFleetSummary, frMachineState,
  FR_WALLET_PANELS, FR_PROVIDER, FR_RAIL_CONFIG, FR_LEDGER, FR_LEDGER_TYPE, FR_MODELS,
  FR_USAGE_SERIES, FR_HONEY_LEDGER, FR_HONEY_KIND, FR_USEPOD, FR_MONEYCLAW_ENV,
  FR_MY_WALLETS, FR_WALLET_META,
  frWallets, frRunway, frWalletSummary, frTokenRollup, frRailCfg, frRailReady, frAgentRail,
  frRailAgents, frNetworkLabel, frShortAddr, frBarColor, frModelFor, frUsage,
  frHoneySummary, frHoneyByAgent, frMyWalletsTotal, frMyRanked, frBankrWallet,
} = D;
function BIcon({ name, color = "currentColor", size = 16, sw = 1.7 }: { name: string; color?: string; size?: number; sw?: number }) {
  const c: React.SVGProps<SVGSVGElement> = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "brain": return (<svg {...c}><path d="M9 4a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 5 11c0 1 .5 1.8 1.2 2.3A2.6 2.6 0 0 0 7 18c.8.6 2 .6 2.5-.2V4z" /><path d="M15 4a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 19 11c0 1-.5 1.8-1.2 2.3A2.6 2.6 0 0 1 17 18c-.8.6-2 .6-2.5-.2V4z" /></svg>);
    case "search": return (<svg {...c}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>);
    case "doc": return (<svg {...c}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M9.5 13h5M9.5 16.5h5" /></svg>);
    case "trade": return (<svg {...c}><path d="M3 17l5-5 3 3 4-6 3 3 3-3" /></svg>);
    case "spark": return (<svg {...c}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>);
    case "activity": return (<svg {...c}><path d="M3 12h4l2.5 7 5-14L17 12h4" /></svg>);
    case "key": return (<svg {...c}><circle cx="8" cy="14" r="4" /><path d="M11 11l8-8M16 4l3 3M14 6l2.5 2.5" /></svg>);
    case "network": return (<svg {...c}><circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="18" r="2.2" /><path d="M10.5 6.6 6.5 16M13.5 6.6 17.5 16M7 18h10" /></svg>);
    case "branch": return (<svg {...c}><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="8" r="2.4" /><path d="M6 8.4v7.2M8.2 7.2c6 1 4 6 9.4 1.2" /></svg>);
    case "file": return (<svg {...c}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /></svg>);
    case "folder": return (<svg {...c}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>);
    case "sync": return (<svg {...c}><path d="M3.5 12a8.5 8.5 0 0 1 14.5-6M20.5 12a8.5 8.5 0 0 1-14.5 6" /><path d="M18 3v3.5h-3.5M6 21v-3.5h3.5" /></svg>);
    case "refresh": return (<svg {...c}><path d="M3.5 12a8.5 8.5 0 0 1 2.6-6.1" /><path d="M3 4v4h4" /><path d="M20.5 12a8.5 8.5 0 0 1-2.6 6.1" /><path d="M21 20v-4h-4" /></svg>);
    case "download": return (<svg {...c}><path d="M12 3v12M8 11l4 4 4-4M5 21h14" /></svg>);
    case "plug": return (<svg {...c}><path d="M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-10 0zM12 17v4" /></svg>);
    case "check": return (<svg {...c}><path d="M20 6 9 17l-5-5" /></svg>);
    case "x": return (<svg {...c}><path d="M18 6 6 18M6 6l12 12" /></svg>);
    case "pencil": return (<svg {...c}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>);
    case "plus": return (<svg {...c}><path d="M12 5v14M5 12h14" /></svg>);
    case "shield": return (<svg {...c}><path d="M12 3l7 4v5c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V7z" /><path d="M9 12l2 2 4-4" /></svg>);
    case "warn": return (<svg {...c}><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></svg>);
    case "alert": return (<svg {...c}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>);
    case "repeat": return (<svg {...c}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>);
    case "sparkles": return (<svg {...c}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></svg>);
    case "eye": return (<svg {...c}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>);
    case "eye-off": return (<svg {...c}><path d="M3 3l18 18" /><path d="M10.6 10.7a3 3 0 0 0 4.2 4.2" /><path d="M9.9 5.2A9.6 9.6 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.3 3.9M6.2 6.3A17 17 0 0 0 2 12s4 7 10 7a9.4 9.4 0 0 0 3.4-.6" /></svg>);
    case "copy": return (<svg {...c}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>);
    case "trash": return (<svg {...c}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>);
    case "promote": return (<svg {...c}><path d="M12 19V7M7 11l5-4 5 4M5 21h14" /></svg>);
    case "bot": return (<svg {...c}><rect x="5" y="8" width="14" height="11" rx="2.4" /><path d="M12 8V4M9 13h.01M15 13h.01M9 16h6" /></svg>);
    case "hex": return (<svg {...c}><path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z" /></svg>);
    default: return null;
  }
}
function TokenIcon({ sym, size = 30 }: { sym: string; size?: number }) {
  const m: WalletTokenMeta = FR_CCY[sym] || {};
  const base: React.CSSProperties = { width: size, height: size, borderRadius: "50%", display: "grid", placeItems: "center", flex: "0 0 auto", overflow: "hidden" };
  if (m.img) {
    return <span style={{ ...base, background: m.color || "#0e1118" }}><img src={m.img} width={size} height={size} alt="" style={{ objectFit: "cover" }} /></span>;
  }
  let glyph;
  if (sym === "ETH") {
    glyph = (
      <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="#fff" aria-hidden>
        <path d="M12 2 5.6 12.1 12 15.9l6.4-3.8L12 2z" opacity="0.92" />
        <path d="M5.6 13.3 12 22l6.4-8.7L12 17.1 5.6 13.3z" opacity="0.7" />
      </svg>
    );
  } else {
    glyph = <span style={{ color: "#fff", fontFamily: "var(--f-display)", fontWeight: 700, fontSize: size * 0.46, lineHeight: 1 }}>{sym === "BANKR" ? "B" : "$"}</span>;
  }
  return <span style={{ ...base, background: m.color || "#444" }}>{glyph}</span>;
}
function Dot({ state, size = 7 }: { state: string; size?: number }) {
  const meta = frStateMeta(state);
  return (
    <span
      className={"fr-dot" + (meta.live ? " live" : "")}
      style={{ color: meta.color, width: size, height: size }}
    />
  );
}
function HiveMark({ size = 22, stroke = "var(--honey)", fill = "none", dot = true, strokeWidth = 1.4 }: { size?: number; stroke?: string; fill?: string; dot?: boolean; strokeWidth?: number }) {
  const pts = "12,1.8 21.2,7 21.2,17 12,22.2 2.8,17 2.8,7";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block" }}>
      <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {dot ? <circle cx="12" cy="12" r="2.1" fill={stroke} /> : null}
    </svg>
  );
}
function Meter({ value, tone }: { value: number; tone?: string }) {
  const color = value >= 85 ? "var(--danger)" : tone || "var(--fg-3)";
  return (
    <span className="fr-meter" style={{ display: "block", width: "100%" }}>
      <i style={{ width: Math.max(3, value) + "%", background: color }} />
    </span>
  );
}
function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function ChatPill({ placeholder, offsetX = 0, onSubmitMessage }: { placeholder?: string; offsetX?: number; onSubmitMessage?: (text: string) => unknown }) {
  const ref = React.useRef<HTMLInputElement | null>(null);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const text = ref.current ? ref.current.value.trim() : ""; if (text) onSubmitMessage && onSubmitMessage(text); if (ref.current) ref.current.value = ""; };
  return (
    <div className="fr-chat-wrap" style={offsetX ? { left: `calc(50% - ${offsetX}px)` } : undefined}>
      <form className="fr-chat" onSubmit={onSubmit}>
        <span className="fr-chat-orb"><span className="ring" /><span className="core" /></span>
        <span className="fr-chat-label">Message the hive</span>
        <span className="fr-chat-field">
          <input
            ref={ref} className="fr-chat-input"
            placeholder={placeholder || "Ask the hive to dispatch a task…"}
            aria-label="Message the hive"
          />
          <button type="submit" className="fr-chat-send" aria-label="Send">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </span>
      </form>
    </div>
  );
}
const FR_SHELF_W = 72;
function FrNavIcon({ id }: { id: string }) {
  const p: React.SVGProps<SVGSVGElement> = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (id) {
    case "kanban": return (<svg {...p}><rect x="3" y="4" width="5" height="16" rx="1.2" /><rect x="9.5" y="4" width="5" height="10" rx="1.2" /><rect x="16" y="4" width="5" height="13" rx="1.2" /></svg>);
    case "vault": return <BIcon name="brain" size={20} sw={1.7} />;
    case "chat": return (<svg {...p}><path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.4A8 8 0 1 1 21 11.5z" /></svg>);
    case "wallet": return (<svg {...p}><rect x="3" y="6" width="18" height="13" rx="2.2" /><path d="M3 9.5h18" /><circle cx="16.5" cy="13.5" r="1.1" fill="currentColor" stroke="none" /></svg>);
    case "scheduler": return (<svg {...p}><rect x="3.5" y="4.5" width="17" height="16" rx="2.2" /><path d="M3.5 9h17M8 3v3M16 3v3" /><path d="M12 12v2.5l1.6 1" /></svg>);
    case "swarm": return (<svg {...p}><circle cx="12" cy="12" r="2" /><circle cx="5" cy="6.5" r="1.6" /><circle cx="19" cy="6.5" r="1.6" /><circle cx="5.5" cy="18" r="1.6" /><circle cx="18.5" cy="18" r="1.6" /><path d="M10.4 10.7 6.3 7.6M13.6 10.7l3.9-3M10.6 13.4 6.7 16.6M13.4 13.4l3.6 3" /></svg>);
    case "history": return (<svg {...p}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M5 4v3.2h3.2" /><path d="M12 8v4.2l2.8 1.7" /></svg>);
    case "aeon": return (<svg {...p}><path d="M12 3v2.3M12 18.7V21M4.2 7.5 6.2 8.6M17.8 15.4l2 1.1M4.2 16.5l2-1.1M17.8 8.6l2-1.1" /><circle cx="12" cy="12" r="3.4" /></svg>);
    case "integrations": return (<svg {...p}><path d="M14.5 9.5 19 5M16 3h5v5" /><path d="M9.5 14.5 5 19M8 21H3v-5" /><circle cx="12" cy="12" r="3" /></svg>);
    case "maintenance": return (<svg {...p}><path d="M3 12h4l2 6 4-13 2 7h6" /></svg>);
    case "more": return (<svg {...p}><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></svg>);
    default: return null;
  }
}
function NavShelf({ active = "agents", onNavigate, theme, onToggleTheme }: { active?: string; onNavigate?: (id: string) => void; theme?: string; onToggleTheme?: () => void }) {
  const groups = [
    [
      { id: "kanban", label: "Work" },
      { id: "vault", label: "Brain" },
      { id: "chat", label: "Chat" },
      { id: "wallet", label: "Wallets" },
    ],
    [
      { id: "scheduler", label: "Schedules" },
      { id: "swarm", label: "Swarm" },
      { id: "history", label: "History" },
    ],
    [
      { id: "aeon", label: "Aeon" },
      { id: "integrations", label: "Integrations" },
      { id: "maintenance", label: "Diagnostics" },
    ],
  ];
  const go = (id: string) => { if (onNavigate) onNavigate(id); };
  const Item = (it: { id: string; label: string }) => (
    <button key={it.id} type="button" className="fr-nav" data-active={active === it.id ? "" : undefined}
      data-bee-nav={it.id}
      onClick={() => go(it.id)} title={it.label}>
      <span className="fr-nav-ico"><FrNavIcon id={it.id} /></span>
      <span className="fr-nav-label">{it.label}</span>
    </button>
  );
  return (
    <nav className="fr-shelf" aria-label="Primary">
      <button type="button" className="fr-brand" onClick={() => go("agents")} title="HivemindOS · Fleet">
        <img src="/hive-icon.png" alt="HivemindOS" />
        <span className="fr-brand-name">HivemindOS</span>
      </button>
      {groups.map((g, i) => (
        <React.Fragment key={i}>
          {g.map(Item)}
          {i < groups.length - 1 ? <div className="fr-nav-div" /> : null}
        </React.Fragment>
      ))}
      <div className="fr-shelf-foot">
        {Item({ id: "more", label: "More" })}
        <button type="button" className="fr-nav" onClick={onToggleTheme} title="Toggle light and dark">
          <span className="fr-nav-ico">{theme === "light" ? <MoonIcon /> : <SunIcon />}</span>
          <span className="fr-nav-label">{theme === "light" ? "Dark mode" : "Light mode"}</span>
        </button>
      </div>
    </nav>
  );
}
function Badge({ tone, children }: { tone?: string; children?: React.ReactNode }) { return <span className={"fb-badge" + (tone ? " " + tone : "")}>{children}</span>; }
function BBtn({ variant = "ghost", sm, children, ...rest }: { variant?: string; sm?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={"fb-btn " + variant + (sm ? " sm" : "")} {...rest}>{children}</button>;
}
function Pill({ active, children, ...rest }: { active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" data-active={active ? "" : undefined} {...rest}>{children}</button>;
}
function Toggle({ on, onChange }: { on: boolean; onChange?: React.MouseEventHandler<HTMLSpanElement> }) {
  return (
    <span onClick={onChange} className="fb-switch" style={{ cursor: onChange ? "pointer" : "default", background: on ? "var(--honey)" : "var(--panel-hi)", border: "1px solid " + (on ? "var(--honey)" : "var(--line-2)") }}>
      <i style={{ left: on ? 17 : 2, background: on ? "#1a1305" : "var(--fg-3)" }} />
    </span>
  );
}
function Disclosure({ summary, defaultOpen, children }: { summary: React.ReactNode; defaultOpen?: boolean; children?: React.ReactNode }) {
  return (
    <details className="fb-disc" open={defaultOpen}>
      <summary>{summary}</summary>
      <div style={{ paddingBottom: 14 }}>{children}</div>
    </details>
  );
}
function Select({ label, value, options, onCommit, disabled }: { label: React.ReactNode; value?: string; options: string[]; onCommit?: (value: string) => void; disabled?: boolean }) {
  const [v, setV] = React.useState(value);
  return (
    <label className="fb-label">{label}
      <select className="fb-select" value={v} disabled={disabled} onChange={(e) => { setV(e.target.value); onCommit && onCommit(e.target.value); }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
function Field({ label, value, sub, mono, readOnly }: { label: React.ReactNode; value?: string; sub?: string; mono?: boolean; readOnly?: boolean }) {
  const [v, setV] = React.useState(value);
  return (
    <label className="fb-label">{label}
      <input className={"fb-field" + (mono ? " fb-mono" : "")} value={v} readOnly={readOnly} onChange={(e) => setV(e.target.value)} />
      {sub ? <small style={{ color: "var(--fg-4)", fontSize: 11 }}>{sub}</small> : null}
    </label>
  );
}
function RunwayChip({ tone, children }: { tone?: string; children?: React.ReactNode }) { return <span className="fw-chip" data-tone={tone}>{children}</span>; }
function AllocBar({ holdings, total }: { holdings: Array<{ sym: string; usd: number }>; total: number }) {
  if (!total) return <span className="fw-alloc" />;
  return (
    <span className="fw-alloc" aria-hidden>
      {holdings.map((b) => (
        <i key={b.sym} style={{ width: Math.max(1.5, (b.usd / total) * 100) + "%", background: frBarColor(b.sym) }} title={b.sym} />
      ))}
    </span>
  );
}
function TokenRow({ b }: { b: WalletHolding }) {
  const meta: WalletTokenMeta = FR_CCY[b.sym] || {};
  const chg = frFmtChange(b.change);
  return (
    <div className="fw-trow">
      <TokenIcon sym={b.sym} size={30} />
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div className="fw-tname">{meta.name}</div>
        <div className="fw-tsub">{frFmtAmount(b.sym, b.amount)} {b.sym}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="fw-tname">{frFmtUsdFull(b.usd)}</div>
        <div className="fw-tsub" style={{ color: chg.color }}>{chg.text}</div>
      </div>
    </div>
  );
}
function PowerToggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="fw-power" data-on={on ? "" : undefined} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v8M7.5 7a7 7 0 1 0 9 0" /></svg>
      {on ? "Spend on" : "Spend off"}
    </button>
  );
}
function WStat({ value, label, tone, live, sub }: { value: React.ReactNode; label: string; tone?: string; live?: boolean; sub?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {live ? <span className="fr-dot live" style={{ color: "var(--live)", width: 6, height: 6 }} /> : null}
        <span style={{ fontFamily: "var(--f-display)", fontWeight: 500, fontSize: 19, color: tone || "var(--fg)", letterSpacing: "-0.01em" }}>{value}</span>
      </div>
      <span style={{ fontSize: 10.5, color: "var(--fg-3)" }}>{label}</span>
      {sub ? <span style={{ fontSize: 10, color: "var(--fg-4)", fontFamily: "var(--f-mono)" }}>{sub}</span> : null}
    </div>
  );
}
function RailConfigModal({ rail, onClose, actions }: { rail: WalletRail; onClose?: () => void; actions?: WalletDropInActions }) {
  const [enabled, setEnabled] = React.useState(rail.enabled);
  const [key, setKey] = React.useState("");
  const [share, setShare] = React.useState(false);
  const [state, setState] = React.useState("idle"); // idle | checking | saved
  const save = async () => { setState("checking"); try { if (!actions?.onSaveRailConfig) throw new Error("Rail setup is not available in this build."); const res = await actions.onSaveRailConfig({ rail, enabled, key, share }); if (res && res.ok === false) throw new Error(res.error || "Rail setup failed."); Object.assign(rail, res?.rail || { enabled, cred: key.trim() ? true : rail.cred }); setState("saved"); setTimeout(() => onClose && onClose(), 850); } catch (e) { setState(e instanceof Error ? e.message : "Rail setup failed."); } };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose && onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const statusTone = rail.setup === "ready" ? "ready" : rail.setup === "needs" ? "setup" : undefined;
  const hasDocs = rail.baseUrl !== "—";
  return (
    <div className="fw-modal-back" onMouseDown={onClose}>
      <section className="fw-modal" role="dialog" aria-modal="true" aria-label={rail.name + " setup"} onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: rail.id === "usepod" ? 520 : 440 }}>
        <div className="fw-modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="fb-tile" style={{ color: statusTone === "ready" ? "var(--honey)" : "var(--fg-3)" }}><BIcon name={rail.icon} size={19} /></span>
            <div>
              <span className="fb-eyebrow">{rail.kind} rail</span>
              <h3>{rail.name}</h3>
            </div>
          </div>
          <button type="button" className="fw-x" onClick={onClose} aria-label="Close" style={{ transform: "rotate(45deg)" }}><BIcon name="plus" size={14} sw={2} /></button>
        </div>
        <div className="fw-share">
          <span>
            <strong>{enabled ? "Enabled for the workspace" : "Disabled"}</strong>
            <small>{enabled ? "Agents may attach to this rail." : "Hidden from agents until enabled."}</small>
          </span>
          <Toggle on={enabled} onChange={() => setEnabled((v) => !v)} />
        </div>
        <div className="fw-kv">
          <div><span>Status</span><strong style={{ color: rail.setup === "ready" ? "var(--live)" : "var(--honey)" }}>{rail.setup === "ready" ? "Ready" : "Needs setup"}</strong></div>
          <div><span>Health</span><strong>{rail.health}</strong></div>
          <div><span>Credential</span><strong className="fw-mono" style={{ color: rail.cred ? "var(--fg)" : "var(--honey)" }}>{rail.env}{rail.env !== "—" ? (rail.cred ? " ·present" : " ·missing") : ""}</strong></div>
          <div><span>Network</span><strong>{rail.network}</strong></div>
        </div>
        {rail.id === "moneyclaw" ? (
          <>
            <label className="fb-label">{rail.env}
              <input className="fb-field fb-mono fw-secret" type="password" value={key} onChange={(e) => { setKey(e.target.value); if (state === "saved") setState("idle"); }} placeholder="mcl_••••••••••••••••" />
            </label>
            <div className="fw-share" onClick={() => setShare((v) => !v)} role="button" aria-pressed={share}>
              <span>
                <strong>{share ? "Shared across all agents" : "Per-agent accounts"}</strong>
                <small>{share ? "One MoneyClaw account, wallet, and balance for every agent." : "Each agent keeps its own MoneyClaw account and balance."}</small>
              </span>
              <Toggle on={share} onChange={(e) => { e.stopPropagation(); setShare((v) => !v); }} />
            </div>
            <button type="button" className="fw-save" data-state={state} disabled={state === "checking" || (!key.trim() && enabled === rail.enabled)} onClick={save}>
              {state === "saved" ? <BIcon name="check" size={15} color="#06231d" /> : null}
              {state === "checking" ? "Checking…" : state === "saved" ? "Saved" : key.trim() ? "Check & save key" : "Save rail"}
            </button>
            {state !== "idle" && state !== "checking" && state !== "saved" ? <p className="fw-sheet-help" style={{ color: "var(--danger)" }}>{state}</p> : null}
            <div className="fw-term"><strong>Or run in Terminal</strong><code>scripts/hive-env-add {rail.env}</code></div>
          </>
        ) : rail.id === "usepod" ? (
          <>
            <UsePodAdvanced actions={actions} />
            <div style={{ display: "flex", justifyContent: "flex-end" }}><BBtn variant="primary" sm disabled={state === "checking" || enabled === rail.enabled} onClick={save}><BIcon name="check" size={14} /> {state === "checking" ? "Saving…" : state === "saved" ? "Saved" : "Save rail"}</BBtn></div>
            {state !== "idle" && state !== "checking" && state !== "saved" ? <p className="fw-sheet-help" style={{ color: "var(--danger)" }}>{state}</p> : null}
          </>
        ) : (
          <>
            {rail.env !== "—" ? (
              <label className="fb-label">{rail.env}
                <input className="fb-field fb-mono fw-secret" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={rail.cred ? "•••••••• saved — paste to replace" : "Paste API key"} />
              </label>
            ) : null}
            {rail.baseUrl !== "—" ? <Field label="Default base URL" value={rail.baseUrl} mono readOnly /> : null}
            {rail.network !== "—" ? <Field label="Default network" value={rail.network} mono readOnly /> : null}
            <div>
              <span className="fb-eyebrow" style={{ display: "block", marginBottom: 7 }}>Capabilities</span>
              <div className="fw-chips">{rail.caps.map((c) => <span key={c} className="fw-achip" data-state="ready">{c}</span>)}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <BBtn variant="primary" sm disabled={state === "checking" || (!key.trim() && enabled === rail.enabled)} onClick={save}><BIcon name="check" size={14} /> {state === "checking" ? "Saving…" : state === "saved" ? "Saved" : rail.cred ? "Save" : "Connect"}</BBtn>
              <BBtn variant="ghost" sm disabled={!hasDocs} onClick={() => actions?.onOpenRailDocs?.(rail)}><BIcon name="branch" size={14} /> Docs</BBtn>
            </div>
            {state !== "idle" && state !== "checking" && state !== "saved" ? <p className="fw-sheet-help" style={{ color: "var(--danger)" }}>{state}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}
function UsePodAdvanced({ w, actions }: { w?: DropInWallet; actions?: WalletDropInActions } = {}) {
  const [tab, setTab] = React.useState("status");
  const u = FR_USEPOD;
  const [repair, setRepair] = React.useState("");
  const [repairMsg, setRepairMsg] = React.useState("");
  const [routing, setRouting] = React.useState(u.routingMode || u.routing[0].label);
  const statusLabel = String(u.status || "unknown").replace(/-/g, " ");
  React.useEffect(() => setRouting(u.routingMode || u.routing[0].label), [u.routingMode]);
  const tabs: Array<[string, string]> = [["status", "Status"], ["connect", "Connect"], ["routing", "Routing"], ["repair", "Repair"]];
  const saveRepair = async () => { if (repair.trim().length < 12) { setRepairMsg("That doesn't look like a UsePod token."); return; } setRepairMsg("Saving…"); try { if (!actions?.onSaveUsePodRepair) throw new Error("UsePod repair is not available in this build."); await actions.onSaveUsePodRepair(repair); setRepairMsg("Token saved · rechecking UsePod status."); actions?.onRefreshUsePod?.(w?.id); } catch (e) { setRepairMsg(e instanceof Error ? e.message : "UsePod repair failed."); } };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
      <div className="fb-seg sub" role="tablist" aria-label="UsePod sections" style={{ alignSelf: "flex-start" }}>
        {tabs.map(([id, label]) => (
          <button key={id} type="button" data-active={tab === id ? "" : undefined} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "status" ? (
        <>
          <div className="fw-kv">
            <div><span>Token source</span><strong>{u.tokenSource}</strong></div>
            <div><span>Token</span><strong className="fw-mono">{u.tokenFp}</strong></div>
            <div><span>Funding ref</span><strong className="fw-mono">{u.fundingRef}</strong></div>
            <div><span>Route</span><strong>{u.route}</strong></div>
            <div><span>Models</span><strong>{u.models}</strong></div>
            <div><span>Status</span><strong style={{ color: u.status === "ready" ? "var(--live)" : u.status === "missing" ? "var(--danger)" : "var(--fg-2)" }}>{statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}</strong></div>
          </div>
          {w && w.meta.addr ? <div className="fw-addr">{w.meta.addr}</div> : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <BBtn variant="ghost" sm onClick={() => actions?.onRefreshUsePod?.(w?.id)}><BIcon name="refresh" size={14} /> Recheck</BBtn>
            <BBtn variant="ghost" sm onClick={() => w?.id ? actions?.onCopyAgentPrompt?.(w.id) : navigator.clipboard?.writeText("Use USEPOD_TOKEN with https://api.usepod.ai/v1 as the OpenAI-compatible base URL.")}><BIcon name="copy" size={14} /> Copy agent prompt</BBtn>
          </div>
        </>
      ) : tab === "connect" ? (
        <>
          <p className="fw-sheet-help">UsePod is a base-URL swap. This wallet runs through the OpenAI-compatible adapter today.</p>
          <div className="fw-kv">
            {u.compat.map((c) => <div key={c.id}><span>{c.label}</span><strong className="fw-mono">{c.base}</strong></div>)}
            <div><span>Token env</span><strong className="fw-mono">{u.tokenEnv}</strong></div>
            <div><span>Endpoints</span><strong className="fw-mono">{u.compat[0].endpoints}</strong></div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <BBtn variant="ghost" sm onClick={() => actions?.onOpenRailDocs?.({ baseUrl: u.compat[0].base })}><BIcon name="branch" size={14} /> Open docs</BBtn>
            <BBtn variant="ghost" sm onClick={() => navigator.clipboard?.writeText(u.compat[0].base)}><BIcon name="copy" size={14} /> Copy base URL</BBtn>
          </div>
        </>
      ) : tab === "routing" ? (
        <>
          <label className="fb-label">Routing mode
            <select className="fb-select" value={routing} onChange={(e) => { setRouting(e.target.value); actions?.onSetUsePodRoutingMode?.(e.target.value); }}>
              {u.routing.map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}
            </select>
          </label>
          <p className="fw-sheet-help">{u.routing[0].sub}</p>
          <div className="fw-kv">
            <div><span>Last route</span><strong>{u.route}</strong></div>
            <div><span>Request controls</span><strong>Price-ceiling headers</strong></div>
            <div><span>Input cap</span><strong className="fw-mono">${u.inCap}</strong></div>
            <div><span>Output cap</span><strong className="fw-mono">${u.outCap}</strong></div>
          </div>
        </>
      ) : (
        <>
          <p className="fw-sheet-help">Paste the funded UsePod dashboard URL or API token for this wallet to rebind it.</p>
          <input className="fb-field fb-mono fw-secret" value={repair} onChange={(e) => { setRepair(e.target.value); setRepairMsg(""); }} placeholder="https://usepod.ai/dashboard?token=…" />
          <div>
            <BBtn variant="ghost" sm onClick={saveRepair}>
              <BIcon name="check" size={14} /> Save & recheck
            </BBtn>
          </div>
          {repairMsg ? <p className="fw-sheet-help" style={{ color: repairMsg[0] === "T" && repairMsg.includes("doesn't") ? "var(--danger)" : "var(--live)" }}>{repairMsg}</p> : null}
        </>
      )}
    </div>
  );
}
function FundAgentModal({ source, onClose, actions }: { source?: GroupedPersonalWallet | null; onClose?: () => void; actions?: WalletDropInActions }) {
  const agents = frWallets().filter((w) => !w.meta.setup);
  const [sel, setSel] = React.useState<string | null>(null);
  const ranked = source ? frMyRanked(source) : { total: 0, top: [] as WalletHolding[] };
  const [fundSymState, setFundSym] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [fundState, setFundState] = React.useState("idle");
  const [msg, setMsg] = React.useState("");
  const [fundResult, setFundResult] = React.useState<WalletFundResult | null>(null);
  const transferable = ranked.top.filter((b) => b.sym === "USDC");
  const fundSym = fundSymState || (transferable[0] ? transferable[0].sym : "USDC");
  const fundBal = transferable.find((b) => b.sym === fundSym);
  const AssetSel = AssetSelect;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose && onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const selected = agents.find((a) => a.id === sel);
  const fundAmount = Number(amount);
  const funding = fundState === "funding";
  const funded = fundState === "funded";
  const locked = funding || funded;
  const recipientBalanceUsd = Number(fundResult?.recipientBalanceUsd);
  const recipientBalanceText = Number.isFinite(recipientBalanceUsd) ? frFmtUsdFull(recipientBalanceUsd) : "";
  const successDetail = recipientBalanceText
    ? `${selected?.name || "Agent"} now has ${recipientBalanceText}.`
    : "Refresh the wallet balance to verify the new total.";
  // `!!` (identical to the previous Boolean() call) so TS narrows fundBal for the cap check.
  const canSubmitFund = !locked && source?.canSpend !== false && Boolean(selected) && !!fundBal && Number.isFinite(fundAmount) && fundAmount > 0 && fundAmount <= fundBal.amount;
  const resetFundState = () => { setFundState("idle"); setMsg(""); setFundResult(null); };
  const submitFund = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    if (funding) return;
    if (funded) { onClose && onClose(); return; }
    if (!canSubmitFund) return;
    setFundState("funding");
    setMsg("");
    try {
      if (!actions?.onFundAgent) throw new Error("Agent funding is not available in this build.");
      const result = await actions.onFundAgent({ source, agentId: selected?.id, asset: fundSym, amount, confirmation: "SEND_USDC" });
      setFundResult(result || null);
      setFundState("funded");
    } catch (e) {
      setFundState("idle");
      setMsg(e instanceof Error ? e.message : "Funding failed.");
    }
  };
  return (
    <div className="fw-modal-back" onMouseDown={onClose}>
      <section className="fw-modal" role="dialog" aria-modal="true" aria-label="Fund an agent" onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="fw-modal-head">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="fb-tile" style={{ color: "var(--honey)" }}><BIcon name="promote" size={19} /></span>
            <div>
              <span className="fb-eyebrow">Fund an agent</span>
              <h3>From {source ? source.name : "wallet"}</h3>
            </div>
          </div>
          <button type="button" className="fw-x" onClick={onClose} aria-label="Close" style={{ transform: "rotate(45deg)" }}><BIcon name="plus" size={14} sw={2} /></button>
        </div>
        <p className="fw-sheet-help">{fundBal ? frFmtAmount(fundSym, fundBal.amount) + " " + fundSym + " available." : "No USDC balance is available from this wallet."} Choose an agent to top up.</p>
        <div className="fw-fundgrid">
          {agents.map((a) => {
            const rw = frRunway(a);
            return (
              <button key={a.id} type="button" className="fw-fundcard" data-sel={sel === a.id ? "" : undefined} aria-disabled={locked ? "true" : undefined} onClick={() => { if (locked) return; setSel(a.id); resetFundState(); }}>
                <div className="row">
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <Dot state={a.state} />
                    <b style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</b>
                  </span>
                  {sel === a.id ? <span className="check"><BIcon name="check" size={13} /></span> : null}
                </div>
                <span className="mn">{a.runtime} · {a.machine}</span>
                <div className="row">
                  <b className="bal">{frFmtUsdFull(a.total)}</b>
                  <span className="fw-chip" data-tone={rw.tone}>{rw.text}</span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="fw-fundfoot">
          {AssetSel ? <div style={{ width: 116, flex: "0 0 auto" }}><AssetSel holdings={transferable} value={fundSym} disabled={locked} onChange={(value) => { setFundSym(value); resetFundState(); }} /></div> : null}
          <input className="fb-field fb-mono" value={amount} onChange={(e) => { setAmount(e.target.value); resetFundState(); }} placeholder={selected ? "Amount " + fundSym : "Select an agent first"} disabled={!selected || !fundBal || locked} style={{ flex: 1 }} />
          <button type="button" className="fw-save" data-state={fundState} aria-disabled={locked ? "true" : undefined} style={{ width: "auto", padding: "11px 16px" }} disabled={!canSubmitFund && !locked} onClick={submitFund}>
            {funding ? <span className="fw-loader"><i /><i /><i /></span> : funded ? <BIcon name="check" size={15} color="currentColor" /> : <BIcon name="promote" size={15} color="#1a1305" />}
            {funding ? "Funding..." : funded ? "Done" : selected ? "Fund " + selected.name : "Fund agent"}
          </button>
        </div>
        {funded ? <div className="fw-fundsuccess"><span className="mark"><BIcon name="check" size={17} /></span><div><strong>{frFmtAmount(fundSym, fundAmount)} {fundSym} sent to {selected?.name || "agent"}</strong><small>{fundResult?.signature ? "Transaction " + frShortAddr(fundResult.signature) + " confirmed. " + successDetail : successDetail}</small></div></div> : null}
        {msg ? <p className="fw-sheet-help">{msg}</p> : null}
      </section>
    </div>
  );
}
const FW_FILTERS = [
  { id: "all",   label: "All wallets" },
  { id: "on",    label: "Spending on" },
  { id: "tend",  label: "Needs attention" },
  { id: "off",   label: "Off" },
];
const FW_DENSITY_KEY = "fr-wallet-density";
function frMatchesFilter(w: DropInWallet, f: string) {
  if (f === "on")   return w.meta.enabled && !w.meta.setup;
  if (f === "off")  return !w.meta.enabled && !w.meta.setup;
  if (f === "tend") return w.meta.setup || w.state === "failed" || w.meta.alert || (w.runway != null && w.runway < 3);
  return true;
}
function frRailSub() { return ""; }
function CompactCard({ w, enabled, onOpen }: { w: DropInWallet; enabled: boolean; onOpen?: () => void }) {
  const rw = frRunway({ ...w, meta: { ...w.meta, enabled } });
  const cfg = frRailCfg(w.railId);
  const railReady = frRailReady(w.railId);
  const tone = w.meta.setup ? "muted" : rw.tone === "danger" ? "danger" : !enabled ? "muted" : undefined;
  return (
    <button type="button" className="fw-cc" data-tone={tone} data-bee={`wallet-agent-${w.id}`} data-bee-wallet-action="open" onClick={onOpen}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <Dot state={w.state} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</span>
            <span style={{ display: "block", fontSize: 10.5, color: "var(--fg-3)" }}>{w.runtime} · {w.machine}</span>
          </span>
        </span>
        <span className="fw-pdot" title={enabled ? "Spending on" : "Spending off"} style={{ background: w.meta.setup ? "var(--honey)" : enabled ? "var(--live)" : "var(--fg-4)" }} />
      </span>
      {w.meta.setup ? (
        <span style={{ fontSize: 12, color: "var(--fg-3)", padding: "2px 0 1px" }}>No wallet yet · needs setup</span>
      ) : (
        <span style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
          <span className="fw-cc-bal">{frFmtUsdFull(w.total)}</span>
          <RunwayChip tone={rw.tone}>{rw.text}</RunwayChip>
        </span>
      )}
      <AllocBar holdings={w.holdings} total={w.total} />
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {w.meta.setup ? "No wallet" : `Uses ${cfg ? cfg.name : "—"}${railReady ? "" : " · set up"}`}
        </span>
        <span className="fw-manage">{w.meta.setup ? "Set up" : "Manage"} <BIcon name="branch" size={12} /></span>
      </span>
    </button>
  );
}
function SheetTitle({ children, onClose }: { children?: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fw-sheet-title">{children}
      <button type="button" className="fw-x" onClick={onClose} aria-label="Close" style={{ transform: "rotate(45deg)" }}><BIcon name="plus" size={14} sw={2} /></button>
    </div>
  );
}
function NumField({ label, value, onCommit, readOnly }: { label: string; value: string; onCommit?: (value: string) => void; readOnly?: boolean }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  const commit = () => { if (!readOnly && onCommit) onCommit(v); };
  return (
    <label className="fb-label">{label}
      <input className="fb-field fb-mono" value={v} readOnly={readOnly} inputMode="decimal" onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} onChange={(e) => setV(e.target.value)} />
    </label>
  );
}
function AssetSelect({ holdings, value, disabled = false, onChange }: { holdings: Array<{ sym: string; amount: number }>; value: string; disabled?: boolean; onChange: (sym: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  React.useEffect(() => {
    if (!open) return;
    // e.target as Node: DOM boundary; contains() takes Node while listeners get EventTarget.
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div className="fw-asset" ref={ref}>
      <button type="button" className="fb-select fw-asset-btn fb-mono" disabled={disabled} onClick={() => setOpen((o) => !o)}>{value}</button>
      {open ? (
        <div className="fw-asset-menu">
          {holdings.map((b) => (
            <button key={b.sym} type="button" data-active={b.sym === value ? "" : undefined} onClick={() => { onChange(b.sym); setOpen(false); }}>
              <span className="fb-mono">{b.sym}</span><span className="amt">{frFmtAmount(b.sym, b.amount)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
function DetailedCard({ w, enabled, setEnabled, compact, onCollapse, onConfigure, actions }: { w: DropInWallet; enabled: boolean; setEnabled: React.Dispatch<React.SetStateAction<boolean>>; compact?: boolean; onCollapse?: () => void; onConfigure?: (railId: WalletRailId) => void; actions?: WalletDropInActions }) {
  const [sheet, setSheet] = React.useState<string | null>(null);
  const [auto, setAuto] = React.useState(!!w.meta.autoUse);
  const [copied, setCopied] = React.useState(false);
  const [dup, setDup] = React.useState(!!w.policy.dupGuard);
  const [veilAuto, setVeilAuto] = React.useState(!!w.meta.veilAutoSend);
  const [sendSymState, setSendSym] = React.useState("");
  const [recipMode, setRecipMode] = React.useState("agent");
  const [recipAgent, setRecipAgent] = React.useState("");
  const [sendAmt, setSendAmt] = React.useState(""); const [sendTo, setSendTo] = React.useState(""); const [sendConfirm, setSendConfirm] = React.useState(""); const [sendMsg, setSendMsg] = React.useState("");
  const promptSeed = w.meta.notes || ("Spend only on " + w.role.toLowerCase() + " work. Prefer the cheapest route under caps.");
  const [promptText, setPromptText] = React.useState(promptSeed);
  React.useEffect(() => setPromptText(promptSeed), [w.id, promptSeed]);
  React.useEffect(() => setAuto(!!w.meta.autoUse), [w.id, w.meta.autoUse]);
  React.useEffect(() => setDup(!!w.policy.dupGuard), [w.id, w.policy.dupGuard]);
  React.useEffect(() => setVeilAuto(!!w.meta.veilAutoSend), [w.id, w.meta.veilAutoSend]);
  const rw = frRunway({ ...w, meta: { ...w.meta, enabled } });
  const prov = FR_PROVIDER[w.provider] || FR_PROVIDER.crypto;
  const cfg = frRailCfg(w.railId);
  const railReady = frRailReady(w.railId);
  const cardTone = rw.tone === "danger" ? "danger" : !enabled ? "muted" : undefined;
  const canDirectSend = w.provider === "crypto" || w.provider === "x402" || w.provider === "veil";
  const sendHoldings = w.meta.rawProvider === "veil" ? w.holdings.filter((b) => b.sym === "USDC" || b.sym === "ETH") : w.holdings.filter((b) => b.sym === "USDC");
  const stable = (sendHoldings.find((b) => b.sym === "USDC") || sendHoldings[0] || { sym: "USDC" }).sym;
  const sendSym = sendSymState || stable;
  const confirmLabel = w.meta.rawProvider === "veil" ? "CONFIRM" : "SEND_USDC";
  const requiresSendConfirmation = w.meta.rawProvider === "veil" ? !veilAuto : !auto;
  const sendBal = sendHoldings.find((b) => b.sym === sendSym);
  const others = frWallets().filter((a) => a.id !== w.id && !a.meta.setup && a.meta.addr && a.meta.network === w.meta.network && (w.provider !== "veil" || /^0x[a-fA-F0-9]{40}$/.test(a.meta.addr)));
  const sendAmount = Number(sendAmt);
  const spendCap = Number(w.meta.assetSpendCaps?.[sendSym] ?? (sendSym === "ETH" ? 0.01 : w.meta.maxPay));
  const sendAmountUsd = Number.isFinite(sendAmount) && sendAmount > 0 ? sendAmount * ((FR_CCY[sendSym] || {}).price || 0) : 0;
  // `!!` (identical to the previous Boolean() call) so TS narrows sendBal for the cap check.
  const canSubmitSend = !!sendBal
    && sendAmt.trim()
    && Number.isFinite(sendAmount)
    && sendAmount > 0
    && sendAmount <= sendBal.amount && (!Number.isFinite(spendCap) || sendAmount <= spendCap)
    && (recipMode === "agent" ? Boolean(recipAgent || others[0]) : sendTo.trim())
    && (!requiresSendConfirmation || sendConfirm === confirmLabel);
  const actionStatus = w.meta.actionError || w.meta.actionMessage || "";
  const actionTone = w.meta.actionError ? "danger" : w.meta.actionBusy ? "working" : "ok";
  const toggleSheet = (s: string) => setSheet((c) => (c === s ? null : s));
  const copyAddr = () => { try { navigator.clipboard.writeText(w.meta.addr); } catch { /* clipboard unavailable */ } setCopied(true); setTimeout(() => setCopied(false), 1400); };
  const flipEnabled = () => setEnabled((v) => { const next = !v; actions?.onToggleAgentSpend?.(w.id, next); return next; });
  const flipAuto = () => setAuto((v) => { const next = !v; actions?.onUpdateAgentWallet?.(w.id, { autoPayEnabled: next, allowAutoUse: next }); return next; });
  const flipVeilAuto = () => setVeilAuto((v) => { const next = !v; actions?.onUpdateAgentWallet?.(w.id, { veilAutoSendEnabled: next }); return next; });
  const flipDup = () => setDup((v) => { const next = !v; actions?.onUpdateAgentWallet?.(w.id, { duplicatePaymentGuardEnabled: next }); return next; });
  const commitNum = (key: string) => (value: string) => { const n = Number(value); if (Number.isFinite(n) && n >= 0) actions?.onUpdateAgentWallet?.(w.id, { [key]: n }); };
  const commitAsset = (asset: string) => (value: string) => { const n = Number(value); if (Number.isFinite(n) && n >= 0) actions?.onUpdateAgentWallet?.(w.id, { assetSpendCaps: { ...(w.meta.assetSpendCaps || {}), [asset]: n } }); };
  const send = async () => { setSendMsg("Sending…"); try { if (!actions?.onSendAgentPayment) throw new Error("Agent send is not available in this build."); const res = await actions.onSendAgentPayment({ agentId: w.id, asset: sendSym, amount: sendAmt, amountUsd: sendAmountUsd || undefined, toAddress: recipMode === "address" ? sendTo : "", recipientAgentId: recipMode === "agent" ? (recipAgent || (others[0] && others[0].id)) : "", confirmation: sendConfirm }); setSendMsg(res?.signature ? "Sent · " + res.signature : res?.transfer?.transactionHash ? "Sent · " + res.transfer.transactionHash : "Sent."); } catch (e) { setSendMsg(e instanceof Error ? e.message : "Send failed."); } };
  return (
    <div className="fw-card" data-tone={cardTone} data-bee={`wallet-agent-${w.id}`} data-bee-wallet-action="details">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          {compact ? (
            <button type="button" className="fw-x" onClick={onCollapse} aria-label="Collapse" style={{ transform: "rotate(45deg)" }}><BIcon name="plus" size={14} sw={2} /></button>
          ) : <Dot state={w.state} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</div>
            <div style={{ fontSize: 11, color: "var(--fg-3)" }}>{w.runtime} · {w.machine} · {frNetworkLabel(w.meta.network)}</div>
          </div>
        </div>
        <PowerToggle on={enabled} onClick={flipEnabled} />
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div className="fw-bal">{frFmtUsdFull(w.total)}</div>
          <RunwayChip tone={rw.tone}>{rw.text}</RunwayChip>
        </div>
        <div className="fw-balsub" style={{ marginTop: 7 }}>{frFmtUsdFull(w.liquid)} liquid · safe to spend</div>
      </div>
      <AllocBar holdings={w.holdings} total={w.total} />
      {(w.meta.alert || w.state === "failed") && enabled ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--danger)", background: "var(--danger-soft)", border: "1px solid color-mix(in srgb, var(--danger) 24%, transparent)", borderRadius: "var(--radius-sm)", padding: "8px 10px" }}>
          <BIcon name="alert" size={14} /> <span>{w.meta.alert || "Rail needs attention."}</span>
        </div>
      ) : null}
      {!enabled ? (
        <div className="fw-banner">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v8M7.5 7a7 7 0 1 0 9 0" /></svg>
          <div><strong>Spending is off</strong>The wallet is ready, but this agent can't spend until you switch it on.</div>
        </div>
      ) : rw.tone === "danger" && !w.meta.alert && w.state !== "failed" ? (
        <div className="fw-banner" data-tone="danger">
          <BIcon name="alert" size={15} />
          <div><strong>Needs funding</strong>Top up before this agent runs out of runway.</div>
        </div>
      ) : null}
      {actionStatus ? (
        <div className="fw-action-status" data-tone={actionTone}>
          {w.meta.actionBusy ? <span className="fw-loader" aria-hidden="true"><i /><i /><i /></span> : <BIcon name={w.meta.actionError ? "alert" : "check"} size={13} />}
          <span>{actionStatus}</span>
        </div>
      ) : null}
      <div className="fw-actions">
        <button type="button" className="fw-act" data-active={sheet === "send" ? "" : undefined} disabled={!enabled || !canDirectSend} onClick={() => toggleSheet("send")}><BIcon name="promote" size={14} /> Send</button>
        <button type="button" className="fw-act" data-active={sheet === "receive" ? "" : undefined} onClick={() => toggleSheet("receive")}><BIcon name="download" size={14} /> Receive</button>
        <button type="button" className="fw-act" data-active={sheet === "limits" ? "" : undefined} onClick={() => toggleSheet("limits")}><BIcon name="trade" size={14} /> Limits</button>
      </div>
      {sheet === "send" ? (
        <div className="fw-sheet">
          <SheetTitle onClose={() => setSheet(null)}>Send</SheetTitle>
          <p className="fw-sheet-help">Hard cap per payment: {frFmtUsdFull(w.meta.maxPay)}. {w.meta.rawProvider === "veil" ? veilAuto ? "Veil auto-send is on - private sends under the asset cap execute without CONFIRM." : `Private sends require ${confirmLabel}.` : auto ? "Auto-use is on - transfers under the cap send without another prompt." : `Auto-use is off - type ${confirmLabel} to confirm.`}</p>
          <div className="fb-grid2">
            <label className="fb-label">Asset
              <AssetSelect holdings={sendHoldings} value={sendSym} onChange={setSendSym} />
            </label>
            <label className="fb-label">Amount<input className="fb-field fb-mono" value={sendAmt} onChange={(e) => setSendAmt(e.target.value)} placeholder={sendBal ? frFmtAmount(sendSym, sendBal.amount) + " max" : "0.00"} /></label>
          </div>
          <div className="fb-label">Send to
            <div className="fb-seg sub" style={{ alignSelf: "flex-start", marginTop: 2 }}>
              <button type="button" data-active={recipMode === "agent" ? "" : undefined} onClick={() => setRecipMode("agent")}>Another agent</button>
              <button type="button" data-active={recipMode === "address" ? "" : undefined} onClick={() => setRecipMode("address")}>Address</button>
            </div>
          </div>
          {recipMode === "agent" ? (
            <label className="fb-label">Recipient agent
              <select className="fb-select" value={recipAgent || (others[0] ? others[0].id : "")} onChange={(e) => setRecipAgent(e.target.value)}>
                {others.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.machine}</option>)}
              </select>
            </label>
          ) : (
            <label className="fb-label">Recipient address<input className="fb-field fb-mono" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder={w.provider === "veil" ? "0x…" : "0x… or Solana address"} /></label>
          )}
          {requiresSendConfirmation ? <label className="fb-label">Confirm<input className="fb-field fb-mono" value={sendConfirm} onChange={(e) => setSendConfirm(e.target.value)} placeholder={confirmLabel} /></label> : null}
          <div style={{ display: "flex", justifyContent: "flex-end" }}><BBtn variant="primary" sm disabled={!canSubmitSend} onClick={send}><BIcon name="promote" size={14} /> Send {sendSym}</BBtn></div>
          {sendMsg ? <p className="fw-sheet-help">{sendMsg}</p> : null}
        </div>
      ) : null}
      {sheet === "receive" ? (
        <div className="fw-sheet">
          <SheetTitle onClose={() => setSheet(null)}>Receive on {frNetworkLabel(w.meta.network)}</SheetTitle>
          {w.meta.addr ? (
            <>
              <p className="fw-sheet-help">Send {stable} to this deposit address.</p>
              <div className="fw-addr">{w.meta.addr}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <BBtn variant="ghost" sm onClick={copyAddr}><BIcon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy address"}</BBtn>
                <BBtn variant="ghost" sm onClick={() => actions?.onRefreshAgentWallet?.(w.id)}><BIcon name="refresh" size={14} /> Refresh balance</BBtn>
              </div>
            </>
          ) : <p className="fw-sheet-help">No deposit address yet. Create a wallet first.</p>}
        </div>
      ) : null}
      {sheet === "limits" ? (
        <div className="fw-sheet">
          <SheetTitle onClose={() => setSheet(null)}>Spending limits</SheetTitle>
          <p className="fw-sheet-help">The only numbers most operators need to set.</p>
          <div className="fb-grid2">
            <NumField label="Current balance ($)" value={Math.round(w.total).toString()} readOnly />
            <NumField label="Ask me over ($)" value={w.meta.askOver.toString()} onCommit={commitNum("approvalRequiredOverUsd")} />
            <NumField label="Max per payment ($)" value={w.meta.maxPay.toString()} onCommit={commitNum("maxPaymentUsd")} />
            <NumField label="Daily running cost ($)" value={w.meta.burn.toString()} onCommit={commitNum("dailyComputeBurnUsd")} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}><BBtn variant="ghost" sm onClick={() => actions?.onResetAgentRunway?.(w.id)}><BIcon name="refresh" size={14} /> Reset runway clock</BBtn></div>
        </div>
      ) : null}
      {sheet === "export" ? (
        <WalletSecretExportSheet walletId={w.id} actionBusy={w.meta.actionBusy} actionStatus={actionStatus} actions={actions} onClose={() => setSheet(null)} />
      ) : null}
      <div>
        {w.holdings.slice(0, 3).map((b) => <TokenRow key={b.sym} b={b} />)}
        {w.rewards.gas > 0 ? (
          <div className="fw-trow">
            <span className="fw-rtile" style={{ background: "var(--panel-hi)", border: "1px solid var(--line-2)", color: "var(--fg-3)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M4 21h12M15 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3" /></svg>
            </span>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div className="fw-tname">Gas</div>
              <div className="fw-tsub">native balance</div>
            </div>
            <div className="fw-tname fw-mono">{w.rewards.gas.toFixed(3)} ETH</div>
          </div>
        ) : null}
        <div className="fw-trow">
          <span className="fw-rtile" style={{ background: "var(--honey-soft)", border: "1px solid var(--honey-line)", color: "var(--honey)" }}>
            <HiveMark size={16} stroke="var(--honey)" dot={false} />
          </span>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div className="fw-tname">Honey</div>
            <div className="fw-tsub">{w.rewards.used.toLocaleString()} tokens billed</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="fw-tname">{w.meta.honey.toLocaleString()}</div>
            <div className="fw-tsub" style={{ color: "var(--honey)" }}>available</div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span className="fb-eyebrow">Rail</span>
        <div className="fw-railcell" data-state={railReady ? "ready" : "setup"}>
          <span className="ic"><BIcon name={cfg.icon} size={15} /></span>
          <strong>{cfg.name}</strong>
          <span className="rdesc">{cfg.kind}</span>
          <button type="button" className="fw-mini" onClick={() => onConfigure && onConfigure(w.railId)}>{railReady ? "Configure" : "Set up"} <BIcon name="branch" size={11} /></button>
        </div>
        {!railReady ? <span style={{ fontSize: 11, color: "var(--honey)" }}>This rail isn't ready — set it up in Rails to let this agent pay through it.</span> : null}
        <div className="fw-rails">
          <span className="fw-rail" data-state={w.meta.alert ? "blocked" : "ready"}><b /> x402 pay-per-call</span>
          {w.meta.trading ? <span className="fw-rail" data-state="ready"><b /> Bankr trading</span> : null}
        </div>
      </div>
      <div className="fw-autouse" onClick={flipAuto} role="button" aria-pressed={auto}>
        <span>
          <strong>Allow auto-use</strong>
          <small>{auto ? "Agent may spend within the hard cap without asking." : `Agent must ask before paying over ${frFmtUsdFull(w.meta.askOver)}.`}</small>
        </span>
        <Toggle on={auto} onChange={(e) => { e.stopPropagation(); flipAuto(); }} />
      </div>
      {w.meta.llmFundingSource ? (
        <button type="button" className="fw-autouse" onClick={() => actions?.onOpenLlmFundingSource?.(w.id)}>
          <span>
            <strong>LLM Funding Source</strong>
            <small>{w.meta.llmFundingSource} · {w.meta.llmFundingSourceDetail || "Tap to choose a funding wallet."}</small>
          </span>
          <BIcon name="branch" size={15} />
        </button>
      ) : null}
      {w.meta.rawProvider === "veil" ? <div className="fw-autouse" onClick={flipVeilAuto} role="button" aria-pressed={veilAuto}><span><strong>Allow Veil auto-send</strong><small>{veilAuto ? "Private sends under USDC/ETH caps can execute without CONFIRM." : "Private sends still require CONFIRM."}</small></span><Toggle on={veilAuto} onChange={(e) => { e.stopPropagation(); flipVeilAuto(); }} /></div> : null}
      <Disclosure summary="Identity & spend policy">
        <div style={{ display: "flex", flexDirection: "column", gap: 11, paddingTop: 4 }}>
          <Field label="Wallet address" value={w.meta.addr || "—"} mono readOnly />
          <Select label="Custody mode" value={w.policy.custody} options={[w.policy.custody]} disabled />
          <div className="fb-grid2">
            <NumField label="Max per payment ($)" value={w.meta.maxPay.toString()} onCommit={commitNum("maxPaymentUsd")} />
            <NumField label="Approval over ($)" value={w.meta.askOver.toString()} onCommit={commitNum("approvalRequiredOverUsd")} />
            <NumField label="Daily budget ($)" value={w.policy.dailyBudget.toString()} onCommit={commitNum("dailyBudgetUsd")} />
            <NumField label="Monthly budget ($)" value={w.policy.monthlyBudget.toString()} onCommit={commitNum("monthlyBudgetUsd")} />
          </div>
          <div>
            <span className="fb-eyebrow" style={{ display: "block", marginBottom: 7 }}>Per-asset caps · daily</span>
            <div className="fb-grid2">
              <NumField label="USDC" value={(w.meta.assetSpendCaps?.USDC ?? w.meta.maxPay).toString()} onCommit={commitAsset("USDC")} />
              <NumField label="ETH" value={(w.meta.assetSpendCaps?.ETH ?? 0.01).toString()} onCommit={commitAsset("ETH")} />
            </div>
          </div>
          <div className="fw-autouse" onClick={flipDup} role="button" aria-pressed={dup}>
            <span>
              <strong>Duplicate-payment guard</strong>
              <small>Block a repeat payment to the same recipient within 60 seconds.</small>
            </span>
            <Toggle on={dup} onChange={(e) => { e.stopPropagation(); flipDup(); }} />
          </div>
          <label className="fb-label">Agent prompt &amp; context
            <textarea className="fb-textarea" value={promptText} onChange={(e) => setPromptText(e.target.value)} onBlur={() => actions?.onUpdateAgentWallet?.(w.id, { notes: promptText })} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <BBtn variant="ghost" sm onClick={() => actions?.onCopyAgentPrompt?.(w.id)}><BIcon name="copy" size={14} /> Copy agent prompt</BBtn>
            <BBtn variant="ghost" sm data-active={sheet === "export" ? "" : undefined} onClick={() => toggleSheet("export")}><BIcon name="download" size={14} /> Export keys</BBtn>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
function WalletCard({ w, density, expanded, onToggle, onConfigure, actions }: { w: DropInWallet; density: string; expanded: boolean; onToggle: () => void; onConfigure?: (railId: WalletRailId) => void; actions?: WalletDropInActions }) {
  const [enabled, setEnabled] = React.useState(w.meta.enabled);
  React.useEffect(() => setEnabled(w.meta.enabled), [w.id, w.meta.enabled]);
  const detailed = density === "detailed" || expanded;
  if (w.meta.setup && !detailed) {
    return <CompactCard w={w} enabled={enabled} onOpen={onToggle} />;
  }
  if (w.meta.setup) {
    return (
      <div className="fw-card" data-tone="muted" data-bee={`wallet-agent-${w.id}`} data-bee-wallet-action="setup">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            {density === "compact" ? <button type="button" className="fw-x" onClick={onToggle} aria-label="Collapse" style={{ transform: "rotate(45deg)" }}><BIcon name="plus" size={14} sw={2} /></button> : <Dot state={w.state} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em" }}>{w.name}</div>
              <div style={{ fontSize: 11, color: "var(--fg-3)" }}>{w.runtime} · {w.machine}</div>
            </div>
          </div>
          <Badge tone="honey">Setup</Badge>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.5, margin: "4px 0 8px" }}>No wallet yet. Initialise a rail to let this agent pay for what it needs.</p>
        {w.meta.llmFundingSource ? (
          <button type="button" className="fw-autouse" onClick={() => actions?.onOpenLlmFundingSource?.(w.id)}>
            <span>
              <strong>LLM Funding Source</strong>
              <small>{w.meta.llmFundingSource} · {w.meta.llmFundingSourceDetail || "Tap to choose a funding wallet."}</small>
            </span>
            <BIcon name="branch" size={15} />
          </button>
        ) : null}
        <button type="button" className="fb-btn primary" style={{ width: "100%" }} data-bee={`wallet-create-${w.id}`} onClick={() => actions?.onCreateAgentWallet?.(w.id, w.meta.network || "base")}><BIcon name="plus" size={15} /> Create wallet</button>
      </div>
    );
  }
  if (!detailed) return <CompactCard w={w} enabled={enabled} onOpen={onToggle} />;
  return <DetailedCard w={w} enabled={enabled} setEnabled={setEnabled} compact={density === "compact"} onCollapse={onToggle} onConfigure={onConfigure} actions={actions} />;
}
function AddrRow({ w, expanded }: { w: { addr: string; network?: string; addresses?: Array<[string, string]> }; expanded?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);
  const t = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // clearTimeout(null) is a harmless no-op at runtime; the lib types only accept a timer id.
  const show = () => { clearTimeout(t.current as ReturnType<typeof setTimeout>); t.current = setTimeout(() => setOpen(true), 200); };
  const hide = () => { clearTimeout(t.current as ReturnType<typeof setTimeout>); t.current = setTimeout(() => setOpen(false), 140); };
  const doCopy = (val: string, key: string) => { try { navigator.clipboard.writeText(val); } catch { /* clipboard unavailable */ } setCopied(key); setTimeout(() => setCopied(null), 1400); };
  const multi = w.addresses && w.addresses.length > 1;
  return (
    <div className="fw-addrwrap">
      <div className="addr">
        {/* w.addresses! below: guarded by `multi`, which implies addresses is set. */}
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: multi ? "help" : "default" }} onMouseEnter={multi ? show : undefined} onMouseLeave={multi ? hide : undefined} title={multi ? "Hover for all chain addresses" : undefined}>{expanded && !multi ? w.network + " · " : ""}{frShortAddr(w.addr)}{multi ? "  · " + w.addresses!.length + " chains" : ""}</span>
        <button type="button" onClick={() => doCopy(w.addr, "main")} aria-label="Copy address"><BIcon name={copied === "main" ? "check" : "copy"} size={13} /></button>
      </div>
      {open && multi ? (
        <div className="fw-addrpop" onMouseEnter={show} onMouseLeave={hide}>
          {w.addresses!.map(([chain, addr]) => (
            <div className="arow" key={chain}>
              <span className="chain">{chain}</span>
              <span className="a">{frShortAddr(addr)}</span>
              <button type="button" className="cp" onClick={() => doCopy(addr, chain)} aria-label={"Copy " + chain + " address"}><BIcon name={copied === chain ? "check" : "copy"} size={12} /></button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
function walletChainBadgeSrcs(w: Pick<GroupedPersonalWallet, "accounts"> | null | undefined) {
  const accounts = Array.isArray(w?.accounts) ? w.accounts : [];
  const keys: string[] = [];
  for (const account of accounts) {
    const key = account?.chainKey;
    if (key && key !== "other" && !keys.includes(key)) keys.push(key);
  }
  return keys.slice(0, 3).map((key) => chainBadgeSrc(key)).filter((src): src is string => Boolean(src));
}
function WalletChainBadges({ w }: { w: GroupedPersonalWallet }) {
  const logos = walletChainBadgeSrcs(w);
  if (!logos.length) return <span className="fb-tile" style={{ color: w.primary ? "var(--honey)" : "var(--fg-3)" }}><BIcon name={w.icon} size={18} /></span>;
  return (
    <span aria-hidden style={{ display: "inline-flex", alignItems: "center", flex: "0 0 auto" }}>
      {logos.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          width={32}
          height={32}
          style={{ width: 32, height: 32, borderRadius: "50%", display: "block", marginLeft: i === 0 ? 0 : -11, position: "relative", zIndex: logos.length - i, boxShadow: "0 0 0 2px var(--panel)", background: "var(--panel)" }}
        />
      ))}
    </span>
  );
}
function MyWalletCard({ w, actions }: { w: GroupedPersonalWallet; actions?: WalletDropInActions }) {
  const { top, total } = frMyRanked(w);
  const canSpend = w.canSpend !== false;
  const [expanded, setExpanded] = React.useState(false);
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(w.name || "");
  const [renaming, setRenaming] = React.useState(false);
  const beginRename = () => { setNameDraft(w.name || ""); setEditingName(true); };
  const cancelRename = () => { setEditingName(false); setRenaming(false); setNameDraft(w.name || ""); };
  const commitRename = async () => {
    const next = nameDraft.trim();
    if (!next || next === w.name) { cancelRename(); return; }
    if (!actions?.onRenamePersonalWallet) { cancelRename(); return; }
    setRenaming(true);
    try {
      await actions.onRenamePersonalWallet({ source: w, name: next });
      setEditingName(false);
    } catch {
      // Leave the field open so the user can retry or cancel.
    } finally {
      setRenaming(false);
    }
  };
  const [sheet, setSheet] = React.useState<string | null>(null); // send | receive
  const [fund, setFund] = React.useState(false);
  const [imp, setImport] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [sendSymState, setSendSym] = React.useState("");
  const [sendAmt, setSendAmt] = React.useState(""); const [sendTo, setSendTo] = React.useState(""); const [sendConfirm, setSendConfirm] = React.useState(""); const [sendMsg, setSendMsg] = React.useState("");
  const sendHoldings = top.filter((b) => b.sym === "USDC"), primaryHolding = sendHoldings[0] || top[0] || { sym: "USDC", amount: 0 };
  const prim = sendHoldings[0] || { sym: "USDC", amount: 0 };
  const sendSym = sendSymState || prim.sym;
  const sendBal = sendHoldings.find((b) => b.sym === sendSym);
  // `!!` (identical to the previous Boolean() call) so TS narrows sendBal for the cap check.
  const sendAmount = Number(sendAmt), canSendPersonal = canSpend && !!sendBal && Number.isFinite(sendAmount) && sendAmount > 0 && sendAmount <= sendBal.amount && Boolean(sendTo.trim()) && sendConfirm === "SEND_USDC";
  const copy = () => { try { navigator.clipboard.writeText(w.addr); } catch { /* clipboard unavailable */ } setCopied(true); setTimeout(() => setCopied(false), 1400); };
  const toggleSheet = (s: string) => setSheet((c) => (c === s ? null : s));
  return (
    <div className="fw-mywallet">
      <div className="top">
        <WalletChainBadges w={w} />
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          {editingName ? (
            <div className="fw-rename">
              <input
                className="fw-rename-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitRename(); } else if (e.key === "Escape") { e.preventDefault(); cancelRename(); } }}
                autoFocus
                disabled={renaming}
                maxLength={60}
                aria-label="Wallet name"
              />
              <button type="button" className="fw-rename-btn confirm" onClick={commitRename} disabled={renaming} aria-label="Save name" title="Save"><BIcon name="check" size={14} /></button>
              <button type="button" className="fw-rename-btn cancel" onClick={cancelRename} disabled={renaming} aria-label="Cancel rename" title="Cancel"><BIcon name="x" size={14} /></button>
            </div>
          ) : (
            <div className="fw-rename">
              <span className="nm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{w.name}</span>
              <button type="button" className="fw-rename-btn" onClick={beginRename} aria-label="Rename wallet" title="Rename wallet"><BIcon name="pencil" size={13} /></button>
            </div>
          )}
          <div className="sub">{w.kind} · {w.network}</div>
        </div>
        {w.primary ? <Badge tone="honey">Primary</Badge> : null}
        <button type="button" className="fw-x" onClick={() => setExpanded((e) => !e)} aria-label={expanded ? "Collapse" : "Expand"}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s" }}><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
      <div>
        <div className="bal">{frFmtUsdFull(total)}</div>
        <div className="balsub">{frFmtAmount(primaryHolding.sym, primaryHolding.amount)} {primaryHolding.sym}{top.length > 1 ? ` · +${top.length - 1} more` : ""}</div>
      </div>
      {expanded ? (
        <>
          <AllocBar holdings={top} total={total} />
          <div>
            <div style={{ maxHeight: top.length > 5 ? 245 : undefined, overflowY: top.length > 5 ? "auto" : undefined, paddingRight: top.length > 5 ? 4 : 0 }}>{top.map((b) => <TokenRow key={b.sym} b={b} />)}</div>
            {w.gas ? (
              <div className="fw-trow">
                <span className="fw-rtile" style={{ background: "var(--panel-hi)", border: "1px solid var(--line-2)", color: "var(--fg-3)" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M4 21h12M15 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3" /></svg>
                </span>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}><div className="fw-tname">Gas</div><div className="fw-tsub">native balance</div></div>
                <div className="fw-tname fw-mono">{w.gas.toFixed(2)}</div>
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11, color: "var(--fg-3)" }}>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Imported · {w.source || "manual"}</span>
            <button type="button" className="fw-mini" onClick={() => setImport(true)}><BIcon name="refresh" size={11} /> Reimport</button>
          </div>
        </>
      ) : null}
      <AddrRow w={w} expanded={expanded} />
      {sheet === "send" ? (
        <div className="fw-sheet">
          <SheetTitle onClose={() => setSheet(null)}>Send</SheetTitle>
          {!canSpend ? <p className="fw-sheet-help">This is a watch wallet. Reimport it locally before sending.</p> : null}
          <div className="fb-grid2">
            <label className="fb-label">Asset<AssetSelect holdings={sendHoldings} value={sendSym} onChange={setSendSym} /></label>
            <label className="fb-label">Amount<input className="fb-field fb-mono" value={sendAmt} onChange={(e) => setSendAmt(e.target.value)} placeholder={sendBal ? frFmtAmount(sendSym, sendBal.amount) + " max" : "USDC wallet required"} disabled={!canSpend || !sendBal} /></label>
          </div>
          <label className="fb-label">Recipient address<input className="fb-field fb-mono" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="0x… or Solana address" disabled={!canSpend || !sendBal} /></label>
          <label className="fb-label">Confirm<input className="fb-field fb-mono" value={sendConfirm} onChange={(e) => setSendConfirm(e.target.value)} placeholder="SEND_USDC" disabled={!canSpend || !sendBal} /></label>
          <div style={{ display: "flex", justifyContent: "flex-end" }}><BBtn variant="primary" sm disabled={!canSendPersonal} onClick={async () => { setSendMsg("Sending…"); try { if (!actions?.onSendPersonalWallet) throw new Error("Personal wallet send is not available in this build."); const res = await actions.onSendPersonalWallet({ source: w, asset: sendSym, amount: sendAmt, toAddress: sendTo, confirmation: sendConfirm }); setSendMsg(res?.signature ? "Sent · " + res.signature : "Sent."); } catch (e) { setSendMsg(e instanceof Error ? e.message : "Send failed."); } }}><BIcon name="promote" size={14} /> Send {sendSym}</BBtn></div>
          {sendMsg ? <p className="fw-sheet-help">{sendMsg}</p> : null}
        </div>
      ) : null}
      {sheet === "receive" ? (
        <div className="fw-sheet">
          <SheetTitle onClose={() => setSheet(null)}>Receive on {w.network}</SheetTitle>
          <div className="fw-addr">{w.addr}</div>
          <BBtn variant="ghost" sm onClick={copy}><BIcon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy address"}</BBtn>
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
        <BBtn variant="primary" sm style={{ flex: 1 }} disabled={!canSpend} onClick={() => setFund(true)}><BIcon name="promote" size={14} /> Fund agent</BBtn>
        {expanded ? <BBtn variant="ghost" sm data-active={sheet === "send" ? "" : undefined} disabled={!canSpend} onClick={() => toggleSheet("send")}><BIcon name="branch" size={14} /> Send</BBtn> : null}
        <BBtn variant="ghost" sm onClick={() => toggleSheet("receive")}><BIcon name="download" size={14} /> Receive</BBtn>
      </div>
      {fund ? <FundAgentModal source={w} onClose={() => setFund(false)} actions={actions} /> : null}
      {imp ? <CreateImportWalletModal wallet={w} onClose={() => setImport(false)} actions={actions} /> : null}
    </div>
  );
}
function BankrWalletCard({ bankr }: { bankr: WalletBankrInfo; onNavigate?: (id: string) => void }) {
  const [copied, setCopied] = React.useState(false);
  const [sheet, setSheet] = React.useState<string | null>(null); // "send" | "receive" | "fund" | null
  const [expanded, setExpanded] = React.useState(false);
  const balance = Number(bankr?.balanceUsd) || 0;
  const addr = String(bankr?.address || "");
  // Real per-token holdings from /api/bankr/wallet (Bankr portfolio), mapped to
  // the same shape the personal cards' AllocBar/TokenRow use. (Bankr's portfolio
  // doesn't carry a 24h change, so change is shown flat.)
  const holdings = (Array.isArray(bankr?.tokens) ? bankr.tokens : []).map((t) => ({ sym: t.symbol, name: t.name, amount: Number(t.amount) || 0, usd: Number(t.usd) || 0, change: 0 }));
  const holdTotal = holdings.reduce((s, h) => s + h.usd, 0) || balance;
  const topHolding = holdings[0];
  const copy = () => { try { navigator.clipboard.writeText(addr); } catch { /* clipboard unavailable */ } setCopied(true); setTimeout(() => setCopied(false), 1400); };

  // Agents fundable via Bankr — they need an EVM (0x) address, since Bankr sends
  // on Base mainnet. (Agent addresses live on w.meta.addr in the drop-in data.)
  const fundableAgents = frWallets().filter((w) => !w.meta?.setup && /^0x[a-fA-F0-9]{40}$/.test(String(w.meta?.addr || "").trim()));

  // Bankr is a MANAGED wallet (no local key), so it can't use the structured
  // /api/wallet/send rail. It moves funds the way it trades — as a natural-language
  // action on its own wallet: prepare → confirm (BANKR_ACTION) → execute via
  // /api/bankr/actions. Send + Fund-agent share this one flow.
  const [asset, setAsset] = React.useState("USDC");
  const [amount, setAmount] = React.useState("");
  const [recipient, setRecipient] = React.useState("");
  const [fundAgentId, setFundAgentId] = React.useState("");
  const [step, setStep] = React.useState("idle"); // idle | preparing | review | executing | done | error
  const [draft, setDraft] = React.useState<{ message?: string; confirmation: string } | null>(null);
  const [msg, setMsg] = React.useState("");
  const amtNum = Number(amount) || 0;
  const selectedAgent = fundableAgents.find((a) => a.id === fundAgentId) || fundableAgents[0];
  const recipOk = /^0x[a-fA-F0-9]{40}$/.test(recipient.trim()) || /\.(eth|base|box|cb\.id)$/i.test(recipient.trim());
  const sendAddr = sheet === "fund" ? String(selectedAgent?.meta?.addr || "") : recipient.trim();
  const addrOk = sheet === "fund" ? Boolean(selectedAgent?.meta?.addr) : recipOk;
  const canReview = amtNum > 0 && addrOk && step !== "preparing" && step !== "executing";
  const resetFlow = () => { setStep("idle"); setDraft(null); setMsg(""); };
  const openSheet = (s: string) => { setSheet((cur) => (cur === s ? null : s)); resetFlow(); };

  const bankrPost = async (body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; message?: string; confirmation?: string } | null> => {
    const r = await fetch("/api/bankr/actions", { method: "POST", headers: { "Content-Type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    return (await r?.json().catch(() => null)) || null;
  };
  const review = async () => {
    if (!canReview) return;
    setStep("preparing"); setMsg("");
    const noun = sheet === "fund" ? "funding" : "send";
    // Bankr has no structured transfer rail — an arbitrary send (incl. funding an
    // agent's address) goes through its free-form agent, reviewed + confirmed first.
    const res = await bankrPost({ action: "prepare", intent: "agent-job", prompt: `send ${amtNum} ${asset} to ${sendAddr}` });
    if (!res?.ok) { setStep("error"); setMsg(res?.error || `Could not prepare this Bankr ${noun}.`); return; }
    setDraft({ message: res.message, confirmation: res.confirmation || "BANKR_ACTION" });
    setStep("review"); setMsg(res.message || "");
  };
  const send = async () => {
    if (!draft) return;
    setStep("executing"); setMsg("");
    const res = await bankrPost({ action: "execute", draftMessage: draft.message, confirmation: draft.confirmation });
    if (!res?.ok) { setStep("error"); setMsg(res?.error || "Bankr action failed."); return; }
    setStep("done"); setMsg(res.message || "Done."); setAmount(""); setRecipient("");
  };

  const flowControls = (
    <>
      {step === "review" && draft ? <p className="fw-sheet-help" style={{ color: "var(--fg-2)" }}>{draft.message}</p> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        {step === "review" ? (
          <>
            <BBtn variant="ghost" sm onClick={resetFlow}>Edit</BBtn>
            {/* (step as string): inside this branch TS narrows step to "review", so these
                "executing" checks are dead at render time (the outer ternary swaps to the
                Review button once send() sets step to "executing"). Kept as-is on purpose. */}
            <BBtn variant="primary" sm disabled={(step as string) === "executing"} onClick={send}><BIcon name="promote" size={14} /> {(step as string) === "executing" ? "Sending…" : "Confirm & send"}</BBtn>
          </>
        ) : (
          <BBtn variant="primary" sm disabled={!canReview} onClick={review}><BIcon name="shield" size={14} /> {step === "preparing" ? "Reviewing…" : sheet === "fund" ? "Review funding" : "Review send"}</BBtn>
        )}
      </div>
      {msg && step !== "review" ? <p className="fw-sheet-help" style={{ color: step === "error" ? "var(--danger)" : step === "done" ? "var(--live)" : undefined }}>{msg}</p> : null}
    </>
  );
  const assetField = (
    <label className="fb-label">Asset
      <select className="fb-field" value={asset} onChange={(e) => { setAsset(e.target.value); resetFlow(); }}>
        {["USDC", "ETH", "USDT", "HIVE"].map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
    </label>
  );
  const amountField = <label className="fb-label">Amount<input className="fb-field fb-mono" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); resetFlow(); }} placeholder="0" /></label>;

  return (
    <div className="fw-mywallet">
      <div className="top">
        <img src="/icons/runtimes/bankr.svg" alt="Bankr" height={38} style={{ height: 38, width: "auto", display: "block", flex: "0 0 auto", borderRadius: 9 }} />
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div className="nm">Bankr trading wallet</div>
          <div className="sub">Managed · Base mainnet</div>
        </div>
        <Badge tone="honey">Bankr-managed</Badge>
        {holdings.length ? (
          <button type="button" className="fw-x" onClick={() => setExpanded((e) => !e)} aria-label={expanded ? "Collapse" : "Expand"}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s" }}><path d="M6 9l6 6 6-6" /></svg>
          </button>
        ) : null}
      </div>
      <div>
        <div className="bal">{frFmtUsdFull(balance)}</div>
        <div className="balsub">{topHolding ? `${frFmtAmount(topHolding.sym, topHolding.amount)} ${topHolding.sym}${holdings.length > 1 ? ` · +${holdings.length - 1} more` : ""}` : "Bankr-managed balance"}</div>
      </div>
      {expanded && holdings.length ? (
        <>
          <AllocBar holdings={holdings} total={holdTotal} />
          <div style={{ maxHeight: holdings.length > 5 ? 245 : undefined, overflowY: holdings.length > 5 ? "auto" : undefined, paddingRight: holdings.length > 5 ? 4 : 0 }}>{holdings.map((b) => <TokenRow key={b.sym} b={b} />)}</div>
        </>
      ) : null}
      <AddrRow w={{ addr, network: "Base mainnet" }} expanded={false} />

      {sheet === "send" ? (
        <div className="fw-sheet">
          <SheetTitle onClose={() => { setSheet(null); resetFlow(); }}>Send via Bankr</SheetTitle>
          <p className="fw-sheet-help">Bankr is managed, so a send runs as an action on Bankr&apos;s own wallet — reviewed, then confirmed, before it moves.</p>
          <div className="fb-grid2">{assetField}{amountField}</div>
          <label className="fb-label">Recipient address<input className="fb-field fb-mono" value={recipient} onChange={(e) => { setRecipient(e.target.value); resetFlow(); }} placeholder="0x… or name.eth" /></label>
          {recipient.trim() && !recipOk ? <p className="fw-sheet-help" style={{ color: "var(--danger)" }}>Enter a valid 0x… address (Bankr is on Base).</p> : null}
          {flowControls}
        </div>
      ) : null}

      {sheet === "fund" ? (
        <div className="fw-sheet">
          <SheetTitle onClose={() => { setSheet(null); resetFlow(); }}>Fund an agent via Bankr</SheetTitle>
          {fundableAgents.length ? (
            <>
              <div className="fb-grid2">
                <label className="fb-label">Agent
                  <select className="fb-field" value={selectedAgent?.id || ""} onChange={(e) => { setFundAgentId(e.target.value); resetFlow(); }}>
                    {fundableAgents.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
                  </select>
                </label>
                {amountField}
              </div>
              {assetField}
              <p className="fw-sheet-help">Sends {asset} from Bankr to {selectedAgent?.name || "the agent"}&apos;s address ({frShortAddr(String(selectedAgent?.meta?.addr || ""))}) — reviewed + confirmed first.</p>
              {flowControls}
            </>
          ) : <p className="fw-sheet-help">No agent wallets with an on-chain address to fund yet. Create or import an agent wallet first.</p>}
        </div>
      ) : null}

      {sheet === "receive" ? (
        <div className="fw-sheet">
          <SheetTitle onClose={() => setSheet(null)}>Receive on Base mainnet</SheetTitle>
          <div className="fw-addr">{addr || "No address yet"}</div>
          {addr ? <BBtn variant="ghost" sm onClick={copy}><BIcon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy address"}</BBtn> : null}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: "auto", flexWrap: "wrap" }}>
        <BBtn variant="primary" sm style={{ flex: 1 }} data-active={sheet === "fund" ? "" : undefined} onClick={() => openSheet("fund")}><BIcon name="promote" size={14} /> Fund agent</BBtn>
        <BBtn variant="ghost" sm data-active={sheet === "send" ? "" : undefined} onClick={() => openSheet("send")}><BIcon name="branch" size={14} /> Send</BBtn>
        <BBtn variant="ghost" sm data-active={sheet === "receive" ? "" : undefined} onClick={() => openSheet("receive")}><BIcon name="download" size={14} /> Receive</BBtn>
      </div>
    </div>
  );
}
function MyWallets({ actions, onNavigate }: { actions?: WalletDropInActions; onNavigate?: (id: string) => void }) {
  const total = frMyWalletsTotal();
  const bankr = frBankrWallet();
  const walletCount = FR_MY_WALLETS.length + (bankr ? 1 : 0);
  const [add, setAdd] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem("fr-mywallets-collapsed") === "1"; } catch { return false; }
  });
  const toggle = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem("fr-mywallets-collapsed", n ? "1" : "0"); } catch { /* storage unavailable */ } return n; });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <button type="button" onClick={toggle} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", width: "100%", background: "transparent", border: 0, padding: 0, cursor: "pointer", textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--fg-3)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform .2s", flex: "0 0 auto" }}><path d="M6 9l6 6 6-6" /></svg>
          <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em", color: "var(--fg)" }}>My wallets</span>
          <span style={{ fontSize: 12, color: "var(--fg-3)" }}>your funding sources — top agents up from here</span>
        </div>
        <span style={{ fontSize: 11.5, color: "var(--fg-3)", fontFamily: "var(--f-mono)" }}>{collapsed ? walletCount + " wallets · " : ""}{frFmtUsdFull(total)} reserve</span>
      </button>
      {!collapsed ? (
        <div className="fw-myrow">
          {FR_MY_WALLETS.map((w) => <MyWalletCard key={w.id} w={w} actions={actions} />)}
          {bankr ? <BankrWalletCard bankr={bankr} onNavigate={onNavigate} /> : null}
          <button type="button" className="fw-addcard" onClick={() => setAdd(true)}>
            <span className="ring"><BIcon name="plus" size={18} /></span>
            <span>Create or Import Wallet</span>
          </button>
        </div>
      ) : null}
      {add ? <CreateImportWalletModal onClose={() => setAdd(false)} actions={actions} /> : null}
    </div>
  );
}
function AgentsPanel({ onConfigure, actions, onNavigate }: { onConfigure: (railId: WalletRailId) => void; actions?: WalletDropInActions; onNavigate?: (id: string) => void }) {
  const [filter, setFilter] = React.useState("all");
  const [density, setDensity] = React.useState(() => {
    try { return localStorage.getItem(FW_DENSITY_KEY) || "compact"; } catch { return "compact"; }
  });
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const wallets = frWallets();
  const shown = wallets.filter((w) => frMatchesFilter(w, filter));
  const setD = (d: string) => { setDensity(d); setExpanded(null); try { localStorage.setItem(FW_DENSITY_KEY, d); } catch { /* storage unavailable */ } };
  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id));
  return (
    <div className="fb-fade" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <MyWallets actions={actions} onNavigate={onNavigate} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" }}>Agent wallets</span>
          <div className="fb-pills">
            {FW_FILTERS.map((f) => <Pill key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</Pill>)}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 11.5, color: "var(--fg-3)", fontFamily: "var(--f-mono)" }}>{shown.length} of {wallets.length}</span>
          <div className="fw-density" role="tablist" aria-label="Card density">
            <button type="button" data-active={density === "compact" ? "" : undefined} onClick={() => setD("compact")} title="Compact">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg> Compact
            </button>
            <button type="button" data-active={density === "detailed" ? "" : undefined} onClick={() => setD("detailed")} title="Detailed">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.4" /><rect x="13" y="4" width="7" height="7" rx="1.4" /><rect x="4" y="13" width="7" height="7" rx="1.4" /><rect x="13" y="13" width="7" height="7" rx="1.4" /></svg> Detailed
            </button>
          </div>
        </div>
      </div>
      <div className={"fw-grid" + (density === "compact" ? " compact" : "")}>
        {shown.map((w) => <WalletCard key={w.id} w={w} density={density} expanded={expanded === w.id} onToggle={() => toggle(w.id)} onConfigure={onConfigure} actions={actions} />)}
      </div>
      </div>
    </div>
  );
}
function HoldingsPanel() {
  const tokens = frTokenRollup();
  const total = tokens.reduce((s, t) => s + t.usd, 0);
  const change = tokens.reduce((s, t) => s + t.change, 0);
  const chg = frFmtChange(change);
  return (
    <div className="fb-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="fb-card pad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <span className="fb-eyebrow">Total across all agent wallets</span>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 42, letterSpacing: "-0.02em", lineHeight: 1.05, marginTop: 8 }}>{frFmtUsdFull(total)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, color: chg.color, fontFamily: "var(--f-mono)" }}>{chg.text} <span style={{ color: "var(--fg-4)" }}>· 24h</span></div>
            <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 4 }}>{tokens.length} tokens · {frWallets().length} agent wallets</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 4 }}>User wallets · {FR_MY_WALLETS.length} wallets · {frFmtUsdFull(frMyWalletsTotal())}</div>
          </div>
        </div>
        <span className="fw-alloc" aria-hidden style={{ height: 8 }}>
          {tokens.map((t) => <i key={t.sym} style={{ width: Math.max(1.5, (t.usd / total) * 100) + "%", background: frBarColor(t.sym) }} title={t.sym} />)}
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {tokens.map((t) => (
            <span key={t.sym} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--fg-2)" }}>
              <i style={{ width: 9, height: 9, borderRadius: 3, background: frBarColor(t.sym) }} />
              {((FR_CCY[t.sym] || {}) as WalletTokenMeta).name} <span style={{ color: "var(--fg-4)", fontFamily: "var(--f-mono)" }}>{Math.round((t.usd / total) * 100)}%</span>
            </span>
          ))}
        </div>
      </div>
      <div className="fb-card" style={{ overflow: "hidden" }}>
        <table className="fw-table">
          <thead>
            <tr>
              <th style={{ paddingTop: 16 }}>Token</th>
              <th>Held by</th>
              <th className="r">Amount</th>
              <th className="r">Value</th>
              <th className="r">24h</th>
              <th className="r" style={{ paddingRight: 18 }}>Share</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              const meta: WalletTokenMeta = FR_CCY[t.sym] || {};
              const c = frFmtChange(t.change);
              const share = (t.usd / total) * 100;
              return (
                <tr key={t.sym}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <TokenIcon sym={t.sym} size={30} />
                      <div>
                        <div style={{ fontWeight: 500, letterSpacing: "-0.01em" }}>{meta.name}</div>
                        <div className="fw-mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 2 }}>{t.sym}</div>
                      </div>
                    </div>
                  </td>
                  <td className="fw-mono" style={{ color: "var(--fg-3)", fontSize: 12 }}>{t.holders} agents</td>
                  <td className="r fw-mono" style={{ color: "var(--fg-2)" }}>{frFmtAmount(t.sym, t.amount)}</td>
                  <td className="r" style={{ fontWeight: 500 }}>{frFmtUsdFull(t.usd)}</td>
                  <td className="r fw-mono" style={{ color: c.color, fontSize: 12 }}>{c.text}</td>
                  <td className="r" style={{ paddingRight: 18, width: 120 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, justifyContent: "flex-end" }}>
                      <span className="fr-meter" style={{ width: 56 }}><i style={{ width: Math.max(4, share) + "%", background: frBarColor(t.sym) }} /></span>
                      <span className="fw-mono" style={{ fontSize: 11.5, color: "var(--fg-3)", minWidth: 30 }}>{share.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function ActivityPanel() {
  const spent = FR_LEDGER.filter((e) => e.amt < 0 && e.token !== "HIVE").reduce((s, e) => s + e.amt, 0);
  const earned = FR_LEDGER.filter((e) => e.amt > 0 && e.token !== "HIVE").reduce((s, e) => s + e.amt, 0);
  return (
    <div className="fb-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", padding: "2px 4px" }}>
        <WStat value={"-" + frFmtUsdFull(Math.abs(spent))} label="spent · shown" tone="var(--danger)" />
        <WStat value={"+" + frFmtUsdFull(earned)} label="received · shown" tone="var(--live)" />
        <WStat value={frFmtUsdFull(earned + spent)} label="net · shown" />
        <WStat value={FR_LEDGER.length} label="entries" />
      </div>
      <div className="fb-card" style={{ overflow: "hidden" }}>
        {FR_LEDGER.length ? FR_LEDGER.map((e, i) => {
          const t = FR_LEDGER_TYPE[e.type] || { icon: "activity", label: e.type };
          const failed = e.state === "failed";
          const pos = e.amt > 0;
          const amtColor = failed ? "var(--fg-4)" : pos ? "var(--live)" : "var(--fg)";
          const amtText = e.amt === 0 ? "—" : (pos ? "+" : "-") + (e.token === "HIVE" ? frFmtAmount("HIVE", Math.abs(e.amt)) + " HIVE" : frFmtUsdFull(Math.abs(e.amt)));
          return (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 18px", borderTop: i ? "1px solid var(--line)" : 0 }}>
              <span className="fb-tile" style={{ color: failed ? "var(--danger)" : "var(--fg-3)" }}><BIcon name={t.icon} size={17} /></span>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.what}</div>
                <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>
                  <span style={{ color: "var(--fg-2)" }}>{e.agent}</span> · {t.label}{failed ? " · failed" : ""}
                </div>
              </div>
              <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                <div className="fw-mono" style={{ fontSize: 13, color: amtColor, fontWeight: 500 }}>{amtText}</div>
                <div style={{ fontSize: 10.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 2 }}>{e.at} ago</div>
              </div>
            </div>
          );
        }) : <div style={{ padding: 18, color: "var(--fg-3)", fontSize: 12.5 }}>No wallet payment activity has been recorded yet.</div>}
      </div>
    </div>
  );
}
function RailsPanel({ actions, selectedRailId, onSelectedRailHandled }: { actions?: WalletDropInActions; selectedRailId?: string; onSelectedRailHandled?: () => void }) {
  const [cfg, setCfg] = React.useState<WalletRail | null>(null);
  React.useEffect(() => {
    if (!selectedRailId) return;
    const rail = frRailCfg(selectedRailId);
    if (rail) setCfg(rail);
    onSelectedRailHandled && onSelectedRailHandled();
  }, [selectedRailId, onSelectedRailHandled]);
  const ready = FR_RAIL_CONFIG.filter((r) => r.enabled && r.setup === "ready").length;
  return (
    <div className="fb-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: 12.5, color: "var(--fg-3)", margin: 0, maxWidth: 560, lineHeight: 1.5 }}>
          Configure each rail once for the workspace — credentials, endpoints, and health live here. Agents then attach to a ready rail without repeating setup.
        </p>
        <span style={{ fontSize: 11.5, color: "var(--fg-3)", fontFamily: "var(--f-mono)" }}>{ready} of {FR_RAIL_CONFIG.length} ready</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16, alignItems: "start" }}>
        {FR_RAIL_CONFIG.map((r) => {
          const agents = frRailAgents(r.id);
          const isReady = r.enabled && r.setup === "ready";
          return (
            <div key={r.id} className="fw-railcard">
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <span className="fb-tile" style={{ width: 42, height: 42, color: isReady ? "var(--honey)" : "var(--fg-3)" }}><BIcon name={r.icon} size={20} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 16 }}>{r.name}</span>
                    <Badge tone={!r.enabled ? undefined : isReady ? "live" : "honey"}>{!r.enabled ? "Off" : isReady ? "Ready" : "Set up"}</Badge>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 2 }}>{r.kind}</div>
                  <p style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5, margin: "8px 0 0" }}>{r.blurb}</p>
                </div>
              </div>
              <div className="fw-kv">
                <div><span>Credential</span><strong className="fw-mono" style={{ color: r.env === "—" ? "var(--fg-3)" : r.cred ? "var(--fg)" : "var(--honey)" }}>{r.env === "—" ? "None" : r.cred ? "Present" : "Missing"}</strong></div>
                <div><span>Health</span><strong style={{ color: isReady ? "var(--live)" : "var(--fg-2)" }}>{r.health}</strong></div>
                <div><span>Network</span><strong>{r.network}</strong></div>
                <div><span>Endpoint</span><strong className="fw-mono">{r.baseUrl}</strong></div>
              </div>
              <div className="fw-chips">{r.caps.map((c) => <span key={c} className="fw-achip">{c}</span>)}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <span style={{ fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--f-mono)" }}>{agents.length} agent{agents.length === 1 ? "" : "s"} attached</span>
                <BBtn variant={isReady ? "ghost" : "primary"} sm onClick={() => setCfg(r)}>
                  <BIcon name={isReady ? "trade" : "plus"} size={14} /> {isReady ? "Configure" : "Set up"}
                </BBtn>
              </div>
              {agents.length ? (
                <div className="fw-chips">
                  {agents.slice(0, 6).map((w) => <span key={w.id} className="fw-achip" data-state="ready">{w.name}</span>)}
                  {agents.length > 6 ? <span className="fw-achip">+{agents.length - 6}</span> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {cfg ? <RailConfigModal rail={cfg} onClose={() => setCfg(null)} actions={actions} /> : null}
    </div>
  );
}
function fmtTokens(n: number) { return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n); }
function UsagePanel() {
  const rows = frUsage();
  const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
  const todaySpend = rows.reduce((s, r) => s + r.today, 0);
  const models = new Set(rows.filter((r) => r.model !== "—").map((r) => r.model)).size;
  const maxSpend = Math.max(1, ...FR_USAGE_SERIES.map((d) => d.spend));
  const maxToday = Math.max(1, Math.max.apply(null, rows.map((r) => r.today)));
  return (
    <div className="fb-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", padding: "2px 4px" }}>
        <WStat value={fmtTokens(totalTokens)} label="tokens · billed lifetime" />
        <WStat value={frFmtUsdFull(todaySpend)} label="compute spend · today" tone="var(--honey)" />
        <WStat value={models} label="active models" />
        <WStat value={rows.length} label="agents" />
      </div>
      <div className="fb-card pad">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span className="fb-eyebrow">Compute spend · last 7 days</span>
          <span style={{ fontSize: 11.5, color: "var(--fg-3)", fontFamily: "var(--f-mono)" }}>USDC</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 130, marginTop: 16 }}>
          {FR_USAGE_SERIES.length ? FR_USAGE_SERIES.map((d, i) => {
            const last = i === FR_USAGE_SERIES.length - 1;
            return (
              <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, height: "100%", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 10.5, color: last ? "var(--honey)" : "var(--fg-3)", fontFamily: "var(--f-mono)" }}>${d.spend}</span>
                <div style={{ width: "100%", maxWidth: 46, height: Math.max(4, (d.spend / maxSpend) * 92), borderRadius: 6, background: last ? "var(--honey)" : "color-mix(in srgb, var(--honey) 34%, var(--panel-hi))", transition: "height .4s" }} />
                <span style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{d.day}</span>
              </div>
            );
          }) : <div style={{ alignSelf: "center", width: "100%", textAlign: "center", color: "var(--fg-3)", fontSize: 12.5 }}>No runtime usage has been recorded yet.</div>}
        </div>
      </div>
      <div className="fb-card" style={{ overflow: "hidden" }}>
        <table className="fw-table">
          <thead>
            <tr>
              <th style={{ paddingTop: 16 }}>Agent</th>
              <th>Model</th>
              <th className="r">Tokens</th>
              <th className="r">Spend / day</th>
              <th className="r" style={{ paddingRight: 18 }}>Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Dot state={r.state} />
                    <div>
                      <div style={{ fontWeight: 500, letterSpacing: "-0.01em" }}>{r.name}</div>
                      <div className="fw-mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 2 }}>{r.runtime} · {r.machine}</div>
                    </div>
                  </div>
                </td>
                <td className="fw-mono" style={{ color: "var(--fg-2)", fontSize: 12 }}>{r.model}</td>
                <td className="r fw-mono" style={{ color: "var(--fg-2)" }}>{fmtTokens(r.tokens)}</td>
                <td className="r" style={{ fontWeight: 500, color: r.today ? "var(--fg)" : "var(--fg-4)" }}>{r.today ? frFmtUsdFull(r.today) : "—"}</td>
                <td className="r" style={{ paddingRight: 18, width: 120 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                    <span className="fr-meter" style={{ width: 72 }}><i style={{ width: Math.max(3, (r.today / maxToday) * 100) + "%", background: "var(--honey)" }} /></span>
                  </div>
                </td>
              </tr>
            )) : <tr><td colSpan={5} style={{ color: "var(--fg-3)", fontSize: 12.5 }}>No runtime usage rows yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function HoneyPanel({ actions }: { actions?: WalletDropInActions }) {
  const [on, setOn] = React.useState(D.FR_HONEY_ENABLED);
  React.useEffect(() => setOn(D.FR_HONEY_ENABLED), [D.FR_HONEY_ENABLED]);
  const s = frHoneySummary();
  const byAgent = frHoneyByAgent();
  const maxHoney = Math.max(1, ...byAgent.map((a) => a.honey));
  const toggleRewards = () => setOn((v) => { const next = !v; actions?.onToggleHoneyLedger?.(next); return next; });
  return (
    <div className="fb-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="fb-card pad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="fw-rtile" style={{ width: 44, height: 44, background: "var(--honey-soft)", border: "1px solid var(--honey-line)" }}><HiveMark size={22} stroke="var(--honey)" dot={false} /></span>
            <div>
              <span className="fb-eyebrow">Honey · rewards ledger</span>
              <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 32, letterSpacing: "-0.02em", lineHeight: 1.05, marginTop: 4 }}>{s.balance.toLocaleString()} <span style={{ fontSize: 16, color: "var(--honey)", fontWeight: 500 }}>Honey</span></div>
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, color: "var(--fg-2)", cursor: "pointer" }} onClick={toggleRewards}>
            Rewards {on ? "on" : "off"} <Toggle on={on} onChange={(e) => { e.stopPropagation(); toggleRewards(); }} />
          </label>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.55, margin: 0, maxWidth: 620 }}>
          Agents earn Honey for useful, reviewed work. Spend it on priority routing, or convert it to wallet runway. Earning and redemption are recorded here.
        </p>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <WStat value={"+" + s.earned.toLocaleString()} label="earned · this week" tone="var(--honey)" />
          <WStat value={"-" + s.redeemed.toLocaleString()} label="redeemed + converted" />
          <WStat value={fmtTokens(s.billed)} label="tokens billed" />
          <WStat value={s.holders} label="earning agents" />
        </div>
      </div>
      <WalletRewardsActions actions={actions} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.55fr) minmax(280px,1fr)", gap: 16, alignItems: "start" }}>
        <div className="fb-card" style={{ overflow: "hidden", opacity: on ? 1 : 0.5 }}>
          <div style={{ padding: "15px 18px 12px", borderBottom: "1px solid var(--line)", fontSize: 12.5, fontWeight: 500 }}>Recent ledger</div>
          {FR_HONEY_LEDGER.length ? FR_HONEY_LEDGER.map((e, i) => {
            const k = FR_HONEY_KIND[e.kind] || FR_HONEY_KIND.earn;
            const pos = e.amt > 0;
            return (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 18px", borderTop: i ? "1px solid var(--line)" : 0 }}>
                <span className="fb-tile" style={{ color: k.tone }}><BIcon name={k.icon} size={16} /></span>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.note}</div>
                  <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}><span style={{ color: "var(--fg-2)" }}>{e.agent}</span> · {k.label}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="fw-mono" style={{ fontSize: 13, fontWeight: 500, color: pos ? "var(--honey)" : "var(--fg-2)" }}>{pos ? "+" : "−"}{Math.abs(e.amt).toLocaleString()}</div>
                  <div style={{ fontSize: 10.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 2 }}>{e.at} ago</div>
                </div>
              </div>
            );
          }) : <div style={{ padding: 18, color: "var(--fg-3)", fontSize: 12.5 }}>No Honey ledger events have been recorded yet.</div>}
        </div>
        <div className="fb-card" style={{ overflow: "hidden", opacity: on ? 1 : 0.5 }}>
          <div style={{ padding: "15px 18px 12px", borderBottom: "1px solid var(--line)", fontSize: 12.5, fontWeight: 500 }}>Balances by agent</div>
          {byAgent.length ? byAgent.map((a, i) => (
            <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 7, padding: "12px 18px", borderTop: i ? "1px solid var(--line)" : 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <Dot state={a.state} />
                  <span style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                </div>
                <span className="fw-mono" style={{ fontSize: 12.5, color: "var(--honey)", fontWeight: 500, flex: "0 0 auto" }}>{a.honey.toLocaleString()}</span>
              </div>
              <span className="fr-meter"><i style={{ width: Math.max(3, (a.honey / maxHoney) * 100) + "%", background: "var(--honey)" }} /></span>
            </div>
          )) : <div style={{ padding: 18, color: "var(--fg-3)", fontSize: 12.5 }}>No Honey balances yet.</div>}
        </div>
      </div>
    </div>
  );
}
function WalletModeHeader({ panel, onPanel }: { panel: string; onPanel: (id: string) => void }) {
  const s = frWalletSummary();
  // panel is always one of FR_WALLET_PANELS' ids (guarded in FleetWallets).
  const copy = FR_WALLET_PANELS.find((p) => p.id === panel)!;
  const chg = frFmtChange(s.change);
  return (
    <header style={{ padding: "20px 30px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 11, minWidth: 0 }}>
          <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 18, letterSpacing: "-0.01em" }}>{copy.title}</span>
          <span style={{ fontSize: 12.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>{copy.subtitle}</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 22 }}>
          <WStat value={frFmtUsd(s.total)} label="Agent Treasury" sub={chg.text + " 24h"} />
          <WStat value={s.wallets} label="wallets" />
          <WStat value={s.on} label="spending" live tone="var(--live)" />
          <WStat value={s.tend} label="to tend" tone={s.tend ? "var(--honey)" : undefined} />
        </div>
      </div>
      <div className="fb-seg" style={{ marginTop: 16 }}>
        {FR_WALLET_PANELS.map((p) => (
          <button key={p.id} type="button" data-active={panel === p.id ? "" : undefined} onClick={() => onPanel(p.id)}>{p.label}</button>
        ))}
      </div>
    </header>
  );
}
function FleetWallets({ theme, onToggleTheme, onNavigate, actions }: { theme?: string; onToggleTheme?: () => void; onNavigate?: (id: string) => void; actions?: WalletDropInActions }) {
  const valid = FR_WALLET_PANELS.map((p) => p.id);
  const initial = (typeof location !== "undefined" && new URLSearchParams(location.search).get("walletPanel")) || "agents";
  const [panel, setPanel] = React.useState(valid.includes(initial) ? initial : "agents");
  const [selectedRailId, setSelectedRailId] = React.useState("");
  const openRailConfig = React.useCallback((railId: string) => {
    setSelectedRailId(railId);
    setPanel("rails");
  }, []);
  let body;
  if (panel === "holdings") body = <HoldingsPanel />;
  else if (panel === "activity") body = <ActivityPanel />;
  else if (panel === "usage") body = <UsagePanel />;
  else if (panel === "honey") body = <HoneyPanel actions={actions} />;
  else if (panel === "rails") body = <RailsPanel actions={actions} selectedRailId={selectedRailId} onSelectedRailHandled={() => setSelectedRailId("")} />;
  else body = <AgentsPanel onConfigure={openRailConfig} actions={actions} onNavigate={onNavigate} />;
  return (
    <div className="fr-root" style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", position: "relative", overflow: "hidden", paddingLeft: FR_SHELF_W }}>
      <NavShelf active="wallet" theme={theme} onToggleTheme={onToggleTheme} onNavigate={onNavigate} />
      <WalletModeHeader panel={panel} onPanel={setPanel} />
      <div className="fr-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
        <div className="fb-wrap">{body}</div>
      </div>
      <ChatPill placeholder="Ask the hive to fund an agent or set a spend cap…" onSubmitMessage={actions?.onMessageHive} />
    </div>
  );
}
export type WalletsViewProps = {
  runtimeData?: WalletRuntimeData | null;
  theme?: string;
  onToggleTheme?: () => void;
  onNavigate?: (id: string) => void;
  actions?: WalletDropInActions;
};

export function WalletsView({ runtimeData, theme, onToggleTheme, onNavigate, actions }: WalletsViewProps = {}) {
  const appliedRuntimeDataRef = React.useRef<WalletRuntimeData | null>(null);
  if (runtimeData && appliedRuntimeDataRef.current !== runtimeData) {
    D.frApplyRuntimeWalletData(runtimeData);
    appliedRuntimeDataRef.current = runtimeData;
  }
  const [selfTheme, setSelfTheme] = React.useState(theme || "dark");
  const active = theme || selfTheme;
  React.useEffect(() => {
    document.documentElement.dataset.frTheme = active === "light" ? "light" : "";
  }, [active]);
  const toggle = onToggleTheme || (() => setSelfTheme((t) => (t === "light" ? "dark" : "light")));
  return (
    <div className="fr-app" style={{ height: "100%" }}>
      <FleetWallets theme={active} onToggleTheme={toggle} onNavigate={onNavigate} actions={actions} />
    </div>
  );
}
export default WalletsView;
