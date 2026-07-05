// Failure-reason vocabulary for Work Board task runs: normalize free-form
// reasons to the typed KanbanFailureReason set, classify raw error text into a
// reason, and decide which reasons are retryable. Pure — extracted from
// local-kanban-store.ts (which sits at the file-size ratchet ceiling).
import type { KanbanFailureReason } from "@/lib/types/kanban";

export function normalizeFailureReason(
  value?: string | null,
): KanbanFailureReason | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  return [
    "agent-error",
    "timeout",
    "runtime-offline",
    "runtime-recovery",
    "local-directory-error",
    "manual",
  ].includes(normalized)
    ? (normalized as KanbanFailureReason)
    : undefined;
}

export function classifyKanbanFailure(value?: string | null): KanbanFailureReason {
  const normalized = value?.toLowerCase() ?? "";
  if (
    /local directory|workdir|workspace path|folder|enoent|permission denied/.test(
      normalized,
    )
  )
    return "local-directory-error";
  if (/orphan|recover|reclaim|daemon restart|runtime recovery/.test(normalized))
    return "runtime-recovery";
  if (
    /offline|unreachable|connection refused|network|econnrefused|not available/.test(
      normalized,
    )
  )
    return "runtime-offline";
  if (
    /timeout|timed out|expired|stale|heartbeat|no progress|without worker progress/.test(
      normalized,
    )
  )
    return "timeout";
  if (/manual|cancelled|canceled|user requested/.test(normalized))
    return "manual";
  return "agent-error";
}

export function isRetryableFailureReason(reason: KanbanFailureReason) {
  return [
    "timeout",
    "runtime-offline",
    "runtime-recovery",
    "local-directory-error",
  ].includes(reason);
}
