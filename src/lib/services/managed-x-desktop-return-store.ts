import "server-only";

import type { ManagedXReturnPayload } from "@/lib/services/managed-x-return";

export type StoredManagedXReturnPayload = ManagedXReturnPayload & {
  id: string;
  receivedAt: number;
};

const MAX_RETURNS = 20;
const RETURN_TTL_MS = 10 * 60_000;
const STORE_KEY = "__hivemindosManagedXDesktopReturns";

type ManagedXReturnStoreGlobal = typeof globalThis & {
  [STORE_KEY]?: StoredManagedXReturnPayload[];
};

function store(): StoredManagedXReturnPayload[] {
  const root = globalThis as ManagedXReturnStoreGlobal;
  root[STORE_KEY] ??= [];
  return root[STORE_KEY]!;
}

function prune(now = Date.now()) {
  const records = store();
  const fresh = records
    .filter((record) => now - record.receivedAt <= RETURN_TTL_MS)
    .slice(-MAX_RETURNS);
  records.splice(0, records.length, ...fresh);
}

export function storeManagedXDesktopReturn(payload: ManagedXReturnPayload): StoredManagedXReturnPayload {
  const now = Date.now();
  prune(now);
  const record: StoredManagedXReturnPayload = {
    ...payload,
    id: crypto.randomUUID(),
    receivedAt: now,
  };
  store().push(record);
  prune(now);
  return record;
}

export function latestManagedXDesktopReturn(input: {
  creditAccountId?: string;
  slug?: string;
  since?: number;
}): StoredManagedXReturnPayload | null {
  prune();
  const since = Number.isFinite(input.since) ? Number(input.since) : 0;
  const records = store().filter((record) => {
    if (since && record.receivedAt < since) return false;
    if (input.creditAccountId && record.creditAccountId !== input.creditAccountId) return false;
    if (input.slug && record.slug !== input.slug) return false;
    return true;
  });
  return records.at(-1) ?? null;
}
