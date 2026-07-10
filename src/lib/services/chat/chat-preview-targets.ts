// Pure, CLIENT-SAFE selection helpers for the chat route's preview pane. The
// pane must only ever preview a REAL, fleet-discovered hosted app — never a
// fabricated mock. These helpers do NO network I/O and import nothing
// server-only, because the chat panel is a client component.
//
// The SSRF gate (`isAllowedChatPreviewUrl`) lives in the server-only sibling
// `chat-preview-guard.ts`: it needs `isFleetCollectorUrl`, whose module reaches
// for `fs/promises` and cannot be pulled into the browser bundle.

import type { FoundryHostedApp } from "@/components/apps/apps-types";

/**
 * The subset of a discovered hosted app these helpers read. `FoundryHostedApp`
 * (the client-facing app-card type) is structurally assignable to this, so
 * `selectChatPreviewTargets(fleetHostedApps, …)` type-checks with the real
 * `FoundryHostedApp[]`; the /api/chat/preview route maps the raw
 * `/api/fleet/apps` `HostedApp` records into this same shape. Narrowing the
 * input keeps the helpers pure and cheap to fixture in tests.
 */
export type ChatPreviewHostedApp = Pick<
  FoundryHostedApp,
  "id" | "name" | "machine" | "port" | "state" | "openUrl" | "healthUrl" | "interactive"
>;

export type ChatPreviewTarget = {
  id: string;
  name: string;
  machine: string;
  port: number;
  url: string;
  interactive: boolean;
};

// A hosted app is previewable only when its collector reports it live. The
// discovery→FoundryHostedApp mapping only ever emits "running" for an online
// app (foundryStateFor in MyAppsPanel.tsx), so "running" is the single live
// state; "stopped"/"error"/"updating" are not reachable previews.
function isLivePreviewState(state: FoundryHostedApp["state"]) {
  return state === "running";
}

function normalizedMachine(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

/**
 * Real, previewable hosted apps for the chat pane. Filters to apps on the
 * requested machine (case-insensitive; empty `machineName` returns every
 * machine), in a live/running state, with a non-empty openUrl. Sorted stably:
 * interactive apps first, then by name.
 */
export function selectChatPreviewTargets(
  hostedApps: readonly ChatPreviewHostedApp[],
  machineName?: string,
): ChatPreviewTarget[] {
  const wantedMachine = normalizedMachine(machineName);
  const targets: ChatPreviewTarget[] = [];
  for (const app of hostedApps ?? []) {
    if (!isLivePreviewState(app.state)) continue;
    const url = app.openUrl?.trim() ?? "";
    if (!url) continue;
    if (wantedMachine && normalizedMachine(app.machine) !== wantedMachine) continue;
    targets.push({
      id: app.id ?? "",
      name: app.name ?? "",
      machine: app.machine ?? "",
      port: app.port ?? 0,
      url,
      interactive: Boolean(app.interactive),
    });
  }
  return targets.sort((a, b) => {
    if (a.interactive !== b.interactive) return a.interactive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
