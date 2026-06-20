import { dashboardRouteForView, isDashboardView } from "@/features/dashboard/dashboard-navigation";
import type { DashboardView } from "@/features/dashboard/dashboard-types";

export type DashboardContextItem = {
  id?: string;
  kind?: string;
  label: string;
  detail?: string;
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
