// Server-only SSRF gate for the chat preview probe.
//
// Split out of `chat-preview-targets.ts` because `local-collector-url` imports
// `fs/promises`; pulling it into the client bundle breaks the whole dashboard.
// Import this ONLY from route handlers.

import {
  isFleetCollectorUrl,
  normalizeCollectorUrl,
} from "@/lib/services/local-collector-url";
import type { ChatPreviewHostedApp } from "@/lib/services/chat/chat-preview-targets";

type ThreadAppPreviewIdentity = {
  projectId?: string;
  directory?: string;
};

type ThreadAppProject = {
  id?: unknown;
  directory?: unknown;
  status?: unknown;
  previewUrl?: unknown;
  lastError?: unknown;
};

export type ThreadAppPreviewOutage = {
  projectStatus: "stopped" | "error" | "running";
  reason: string;
};

/**
 * SSRF gate for the preview probe. Returns true ONLY when `url` exactly matches
 * (trailing-slash-normalized) the openUrl or healthUrl of a discovered hosted
 * app AND that URL targets the trusted fleet host surface
 * (`isFleetCollectorUrl`: loopback / this machine / Tailscale / `.local`). The
 * exact-match layer defeats a look-alike on a real fleet host (same host,
 * different port); the host-allowlist layer defeats a discovered URL that
 * somehow points off-fleet. A raw, unmatched user URL is never probeable.
 */
export function isAllowedChatPreviewUrl(
  url: string,
  hostedApps: readonly ChatPreviewHostedApp[],
): boolean {
  const candidate = normalizeCollectorUrl(url);
  if (!candidate) return false;
  const known = new Set<string>();
  for (const app of hostedApps ?? []) {
    for (const appUrl of [app.openUrl, app.healthUrl]) {
      const normalized = normalizeCollectorUrl(appUrl);
      if (normalized) known.add(normalized);
    }
  }
  if (!known.has(candidate)) return false;
  return isFleetCollectorUrl(candidate);
}

export function isAllowedThreadAppPreviewUrl(
  url: string,
  identity: ThreadAppPreviewIdentity,
  project: ThreadAppProject | null | undefined,
) {
  const candidate = normalizeCollectorUrl(url);
  const previewUrl = normalizeCollectorUrl(typeof project?.previewUrl === "string" ? project.previewUrl : "");
  return Boolean(
    candidate
    && identity.projectId
    && identity.directory
    && project?.id === identity.projectId
    && project?.directory === identity.directory
    && project?.status === "running"
    && previewUrl === candidate
    && isFleetCollectorUrl(candidate),
  );
}

/**
 * When the gate rejects a thread-app preview URL, explain WHY honestly if the
 * identity still matches this thread's registered project: the runtime is
 * stopped or errored (collector restart, crash, failed boot), or it restarted
 * on a different address. Returns null when the URL simply isn't this
 * project's preview — the generic 403 refusal stays correct for that. The
 * caller must NOT probe the URL on a non-null result; this is a status
 * report, not an allowlist pass.
 */
export function describeThreadAppPreviewOutage(
  url: string,
  identity: ThreadAppPreviewIdentity,
  project: ThreadAppProject | null | undefined,
): ThreadAppPreviewOutage | null {
  // A stopped manifest has previewUrl null, so the pane's stale URL can no
  // longer be matched exactly — but it must at least be a fleet-surface URL
  // before it earns a project status report; anything off-fleet keeps the
  // generic refusal.
  const probed = normalizeCollectorUrl(url);
  if (!probed || !isFleetCollectorUrl(probed)) return null;
  if (!identity.projectId || !identity.directory || !project) return null;
  if (project.id !== identity.projectId || project.directory !== identity.directory) return null;
  const lastError = typeof project.lastError === "string" ? project.lastError.trim() : "";
  if (project.status === "stopped") {
    return {
      projectStatus: "stopped",
      // A stopped project with a lastError was interrupted (process exited /
      // collector restart); a clean stop was user-requested. Both restart from
      // the same Preview button.
      reason: lastError
        ? "The app preview stopped — press Preview to restart it."
        : "The app preview is stopped. Press Preview to start it.",
    };
  }
  if (project.status === "error") {
    return {
      projectStatus: "error",
      reason: `${lastError || "The app preview failed to start."} Press Preview to retry.`,
    };
  }
  if (project.status === "running") {
    const previewUrl = normalizeCollectorUrl(typeof project.previewUrl === "string" ? project.previewUrl : "");
    const candidate = normalizeCollectorUrl(url);
    if (previewUrl && candidate && previewUrl !== candidate) {
      return {
        projectStatus: "running",
        reason: "The app preview restarted on a new address. Press Preview to reconnect.",
      };
    }
  }
  return null;
}
