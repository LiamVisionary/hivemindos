import "server-only";

// Park-and-take for desktop OAuth returns (github/linkedin/google/google-cloud).
//
// The consent flow finishes in an EXTERNAL browser. The callback route parks
// the outcome here, and the desktop app takes it (authenticated, exactly-once)
// when it regains focus or boots — that is what routes the app to the view the
// user started from. This is the only return path that works on ALREADY
// INSTALLED desktop shells: their Rust deep-link matcher predates the
// integrations/oauth-return branch and silently drops the URL, so the scheme
// activation only foregrounds the app. Mirrors managed-x-desktop-return-store;
// take-consumes because the desktop app is the single consumer and re-focusing
// later must not re-navigate.

export type ParkedOAuthReturn = {
  provider: string;
  view: "integrations" | "aeon" | "socials";
  status: "connected" | "error";
  receivedAt: number;
};

const RETURN_TTL_MS = 10 * 60_000;
const MAX_RETURNS = 10;
const STORE_KEY = "__hivemindosOAuthDesktopReturns";

type OAuthReturnStoreGlobal = typeof globalThis & {
  [STORE_KEY]?: ParkedOAuthReturn[];
};

function store(): ParkedOAuthReturn[] {
  const root = globalThis as OAuthReturnStoreGlobal;
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

export function parkOAuthReturn(input: Omit<ParkedOAuthReturn, "receivedAt">): void {
  const now = Date.now();
  prune(now);
  store().push({ ...input, receivedAt: now });
  prune(now);
}

/** Consume and return the most recent parked return (null when none). */
export function takeLatestOAuthReturn(): ParkedOAuthReturn | null {
  prune();
  const records = store();
  const latest = records.at(-1) ?? null;
  records.splice(0, records.length);
  return latest;
}
