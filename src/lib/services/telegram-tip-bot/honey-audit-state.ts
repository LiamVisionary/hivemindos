export type HoneyRecognitionAuditSource = "command" | "reaction";

export type HoneyRecognitionAuditOutcome =
  | "received"
  | "awaiting-reason"
  | "recorded"
  | "duplicate"
  | "rejected"
  | "recorded-reply-failed"
  | "rejected-reply-failed";

export type HoneyRecognitionAuditEntry = {
  id: string;
  source: HoneyRecognitionAuditSource;
  updateId: number;
  chatId: string;
  messageId: number;
  giverUserId: string;
  recipientUserId?: string;
  outcome: HoneyRecognitionAuditOutcome;
  detail?: string;
  recognitionsRemainingToday?: number;
  dailyRecognitionLimit?: number;
  createdAt: string;
  updatedAt: string;
};

export type TipBotHoneyAuditState = {
  version: 1;
  entries: HoneyRecognitionAuditEntry[];
  updatedAt: string;
};

const MAX_AUDIT_ENTRIES = 2_000;
const MAX_DETAIL_LENGTH = 240;

export function emptyHoneyAuditState(): TipBotHoneyAuditState {
  return { version: 1, entries: [], updatedAt: new Date(0).toISOString() };
}

export function honeyRecognitionAuditId(source: HoneyRecognitionAuditSource, updateId: number): string {
  return `hny_${source}_${updateId}`;
}

export function appendHoneyRecognitionAudit(
  state: TipBotHoneyAuditState,
  entry: HoneyRecognitionAuditEntry,
): HoneyRecognitionAuditEntry {
  const existing = state.entries.find((candidate) => candidate.id === entry.id);
  if (existing) return existing;
  state.entries.push(entry);
  if (state.entries.length > MAX_AUDIT_ENTRIES) {
    state.entries.splice(0, state.entries.length - MAX_AUDIT_ENTRIES);
  }
  return entry;
}

export function completeHoneyRecognitionAudit(
  state: TipBotHoneyAuditState,
  id: string,
  patch: Pick<HoneyRecognitionAuditEntry, "outcome"> &
    Partial<Pick<HoneyRecognitionAuditEntry, "recipientUserId" | "detail" | "recognitionsRemainingToday" | "dailyRecognitionLimit">>,
): HoneyRecognitionAuditEntry {
  const entry = state.entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`HONEY audit receipt ${id} was not found.`);
  Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
  return entry;
}

export function listHoneyRecognitionAudit(
  state: TipBotHoneyAuditState,
  filters: { chatId: string; userId?: string; limit?: number },
): HoneyRecognitionAuditEntry[] {
  const limit = Math.max(1, Math.min(25, Math.floor(filters.limit ?? 10)));
  return state.entries
    .filter((entry) => entry.chatId === filters.chatId)
    .filter((entry) => !filters.userId || entry.giverUserId === filters.userId || entry.recipientUserId === filters.userId)
    .slice(-limit)
    .reverse();
}

export function honeyAuditDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error || "Unknown HONEY error");
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL_LENGTH) || "Unknown HONEY error";
}
