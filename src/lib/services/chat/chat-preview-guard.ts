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
