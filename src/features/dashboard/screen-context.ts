import { dashboardRouteForView, isDashboardView } from "@/features/dashboard/dashboard-navigation";
import type { DashboardView } from "@/features/dashboard/dashboard-types";

export type DashboardContextItem = {
  id?: string;
  kind?: string;
  label: string;
  detail?: string;
};

/**
 * The wallet the user has selected as the "acting wallet" on the current screen
 * (the Trade desk's picked wallet, or the selected agent's wallet on the Wallets
 * screen). When present, the hive treats it as the default owner/source for
 * wallet, payment, trading, and fee actions unless the user names another.
 *
 * `address` is the FULL on-chain address — it is carried structurally for the
 * deterministic send/swap source resolver and is deliberately NOT rendered raw
 * into the prompt prose (the formatter truncates it) so it can never be captured
 * by the natural-language "send/swap to 0x…" interceptors.
 */
export type DashboardActingWallet = {
  /** Resolution id: agentId, a `user:` personal-wallet id, or "bankr". */
  id?: string;
  label: string;
  /** "user" | "agent" | "bankr", or a provider name. */
  kind?: string;
  provider?: string;
  /** CAIP-2 network id, e.g. "eip155:8453" or "solana:mainnet". */
  network?: string;
  networkLabel?: string;
  /** Full address (structural only — truncated in the prompt prose). */
  address?: string;
  custody?: string;
  /** Per-trade USD guardrail; null/undefined = none / your custody. */
  capUsd?: number | null;
};

export type DashboardScreenContext = {
  view: DashboardView | string;
  viewLabel?: string;
  viewDetail?: string;
  route?: string;
  section?: DashboardContextItem;
  selections?: DashboardContextItem[];
  openModals?: DashboardContextItem[];
  openPanels?: DashboardContextItem[];
  /** The user's currently-selected acting wallet (Trade desk / Wallets screen). */
  actingWallet?: DashboardActingWallet | null;
  /** Concise capability briefing lines for the current route (e.g. trading). */
  capabilities?: string[];
};

const MAX_TEXT_LENGTH = 180;
const MAX_ITEMS = 8;

function cleanText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function contextItemKey(item: DashboardContextItem) {
  return [item.kind ?? "", item.id ?? "", item.label, item.detail ?? ""].join("\n");
}

function uniqueItems(items: DashboardContextItem[] = []) {
  const seen = new Set<string>();
  const unique: DashboardContextItem[] = [];
  for (const item of items) {
    const label = cleanText(item.label);
    if (!label) continue;
    const next: DashboardContextItem = {
      id: cleanText(item.id, 80) || undefined,
      kind: cleanText(item.kind, 40) || undefined,
      label,
      detail: cleanText(item.detail) || undefined,
    };
    const key = contextItemKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(next);
    if (unique.length >= MAX_ITEMS) break;
  }
  return unique;
}

function coerceContextItem(value: unknown): DashboardContextItem | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const label = cleanText(record.label);
  if (!label) return undefined;
  return {
    id: cleanText(record.id, 80) || undefined,
    kind: cleanText(record.kind, 40) || undefined,
    label,
    detail: cleanText(record.detail) || undefined,
  };
}

function coerceContextItems(value: unknown): DashboardContextItem[] {
  if (!Array.isArray(value)) return [];
  return uniqueItems(value.map(coerceContextItem).filter((item): item is DashboardContextItem => Boolean(item)));
}

/** Truncate an address for prompt prose so it can never match a 40-hex / base58
 *  address regex used by the natural-language send/swap interceptors. */
function shortWalletAddress(address: string): string {
  const value = address.trim();
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function coerceActingWallet(value: unknown): DashboardActingWallet | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const label = cleanText(record.label, 80);
  if (!label) return null;
  const capRaw = Number(record.capUsd);
  return {
    id: cleanText(record.id, 120) || undefined,
    label,
    kind: cleanText(record.kind, 40) || undefined,
    provider: cleanText(record.provider, 40) || undefined,
    network: cleanText(record.network, 60) || undefined,
    networkLabel: cleanText(record.networkLabel, 60) || undefined,
    address: cleanText(record.address, 120) || undefined,
    custody: cleanText(record.custody, 60) || undefined,
    capUsd: Number.isFinite(capRaw) && capRaw > 0 ? capRaw : null,
  };
}

function coerceCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of value) {
    const line = cleanText(entry, 400);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= 14) break;
  }
  return lines;
}

export function baseDashboardScreenContext(view: DashboardView | string): DashboardScreenContext {
  const route = isDashboardView(view) ? dashboardRouteForView(view) : null;
  return {
    view,
    viewLabel: route?.label ?? cleanText(view),
    viewDetail: route?.detail,
  };
}

export function coerceDashboardScreenContext(value: unknown): DashboardScreenContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const view = cleanText(record.view, 80);
  if (!view) return undefined;
  const route = isDashboardView(view) ? dashboardRouteForView(view) : null;
  return {
    view,
    viewLabel: cleanText(record.viewLabel) || route?.label,
    viewDetail: cleanText(record.viewDetail) || route?.detail,
    route: cleanText(record.route) || undefined,
    section: coerceContextItem(record.section),
    selections: coerceContextItems(record.selections),
    openModals: coerceContextItems(record.openModals),
    openPanels: coerceContextItems(record.openPanels),
    actingWallet: coerceActingWallet(record.actingWallet),
    capabilities: coerceCapabilities(record.capabilities),
  };
}

export function mergeDashboardScreenContext(
  base: DashboardScreenContext | undefined,
  patch: Partial<DashboardScreenContext> | undefined,
): DashboardScreenContext | undefined {
  if (!base && !patch?.view) return undefined;
  const view = base?.view ?? patch?.view ?? "";
  const merged: DashboardScreenContext = {
    ...baseDashboardScreenContext(view),
    ...base,
    ...(patch ?? {}),
    selections: uniqueItems([...(base?.selections ?? []), ...(patch?.selections ?? [])]),
    openModals: uniqueItems([...(base?.openModals ?? []), ...(patch?.openModals ?? [])]),
    openPanels: uniqueItems([...(base?.openPanels ?? []), ...(patch?.openPanels ?? [])]),
  };
  return coerceDashboardScreenContext(merged);
}

function itemLine(item: DashboardContextItem) {
  const prefix = item.kind ? `${item.kind}: ` : "";
  const id = item.id ? ` [${item.id}]` : "";
  const detail = item.detail ? ` - ${item.detail}` : "";
  return `${prefix}${item.label}${id}${detail}`;
}

export function formatDashboardScreenContextForPrompt(context: DashboardScreenContext | undefined): string {
  const safe = coerceDashboardScreenContext(context);
  if (!safe) return "";
  const lines = [
    `Current dashboard screen: ${safe.viewLabel || safe.view} (view: ${safe.view}).`,
  ];
  if (safe.viewDetail) lines.push(`Screen purpose: ${safe.viewDetail}.`);
  if (safe.route) lines.push(`Route: ${safe.route}.`);
  if (safe.section) lines.push(`Current section: ${itemLine(safe.section)}.`);
  if (safe.selections?.length) lines.push(`Selected context: ${safe.selections.map(itemLine).join("; ")}.`);
  if (safe.actingWallet?.label) {
    const w = safe.actingWallet;
    const descriptor = [w.custody || w.provider || w.kind, w.networkLabel || w.network].filter(Boolean).join(" on ");
    const addr = w.address ? `, wallet address ${shortWalletAddress(w.address)}` : "";
    // NOTE: this prose is prepended to the user's message before the deterministic
    // send/swap interceptors parse it, so it must contain NO "$<number>" or
    // "<number> usd/usdc" (would be grabbed as the send amount) and no full
    // address (would be grabbed as a recipient/source). The per-trade cap is
    // carried structurally in actingWallet.capUsd and enforced server-side — it
    // is deliberately not rendered here as a dollar figure.
    lines.push(`Acting wallet — the default owner/source for wallet, payment, trading, and fee actions on this screen: ${w.label}${descriptor ? ` (${descriptor})` : ""}${addr}.`);
    lines.push("Unless the user explicitly names a different wallet, run sends, swaps, trades, fee collection, balance and portfolio questions against THIS acting wallet, routed through its provider (a Bankr-managed wallet uses Bankr; a personal or governed-agent wallet uses the local rails).");
  }
  if (safe.capabilities?.length) {
    lines.push("Capabilities available from this screen (subject to configured credentials):");
    for (const capability of safe.capabilities) lines.push(`- ${capability}`);
  }
  if (safe.openPanels?.length) lines.push(`Open panels/popovers: ${safe.openPanels.map(itemLine).join("; ")}.`);
  lines.push(safe.openModals?.length
    ? `Open modals/dialogs: ${safe.openModals.map(itemLine).join("; ")}.`
    : "Open modals/dialogs: none detected.");
  return lines.join("\n");
}

function visibleElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0
    && rect.height > 0
    && style.visibility !== "hidden"
    && style.display !== "none";
}

function labelledByText(element: HTMLElement) {
  const id = element.getAttribute("aria-labelledby");
  if (!id) return "";
  return cleanText(document.getElementById(id)?.textContent);
}

function describeDialog(element: HTMLElement): DashboardContextItem {
  const label = cleanText(element.getAttribute("aria-label"))
    || labelledByText(element)
    || cleanText(element.querySelector("h1,h2,h3,[data-dialog-title]")?.textContent)
    || "Open dialog";
  const detail = cleanText(
    element.getAttribute("aria-describedby")
      ? document.getElementById(element.getAttribute("aria-describedby") ?? "")?.textContent
      : element.querySelector("[data-dialog-description],p")?.textContent,
  );
  return {
    kind: element.getAttribute("role") === "alertdialog" ? "alert dialog" : "dialog",
    label,
    detail: detail && detail !== label ? detail : undefined,
  };
}

export function readOpenDialogContextFromDom(): DashboardContextItem[] {
  if (typeof document === "undefined" || typeof window === "undefined") return [];
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="dialog"], [role="alertdialog"]'),
  )
    .filter(visibleElement)
    .map(describeDialog);
  return uniqueItems(dialogs);
}
