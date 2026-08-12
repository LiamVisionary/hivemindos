/**
 * Per-machine review ledger for the company task watchdog.
 *
 * Kept out of `companies.json` on purpose: which stop a verifier has already
 * looked at is hot, per-machine operational state, exactly like the company run
 * ledger. Putting it in the replicated definitions file would churn Syncthing on
 * every driver tick and would make two machines fight over the same field.
 */
import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";

// Not `os.homedir()`: Next's bundled @vercel/nft can statically evaluate the real
// `os` module, which turns join(homedir(), …) in traced server code into an
// asset glob over the entire user profile. See src/lib/home-dir.ts.
import { homedir } from "@/lib/home-dir";

export const COMPANY_WATCHDOG_PATH = path.join(homedir(), ".hivemindos", "company-watchdog.json");

export type CompanyWatchdogReview = {
  /** Fingerprint of the stop that was handed to a verifier. */
  stopFingerprint: string;
  reviewedAt: number;
  /** Work Board task id of the verification task, when one was created. */
  verificationTaskId?: string;
  /** How many distinct stops this company has had reviewed. */
  reviewCount: number;
};

type CompanyWatchdogLedger = {
  version: 1;
  companies: Record<string, CompanyWatchdogReview>;
};

/**
 * A FUNCTION, not a shared constant. Spreading one `EMPTY` object would alias a
 * single `companies` record across every caller, so a write against a
 * missing-or-corrupt ledger would accumulate into module state and leak back out
 * of the next "empty" read.
 */
function emptyLedger(): CompanyWatchdogLedger {
  return { version: 1, companies: {} };
}

async function readLedger(): Promise<CompanyWatchdogLedger> {
  try {
    const raw = await readFile(COMPANY_WATCHDOG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CompanyWatchdogLedger>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.companies !== "object" || !parsed.companies) {
      return emptyLedger();
    }
    return { version: 1, companies: { ...(parsed.companies as Record<string, CompanyWatchdogReview>) } };
  } catch {
    // Missing or corrupt ledger means "nothing reviewed yet". Failing closed here
    // would permanently suppress the watchdog, which is worse than re-reviewing
    // one stop: a re-review is idempotent by fingerprint on the next tick.
    return emptyLedger();
  }
}

/** Serializes writes so two companies reviewed in the same tick cannot clobber each other. */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeChain.then(operation, operation);
  writeChain = next.catch(() => undefined);
  return next;
}

export async function readCompanyWatchdogReview(companyId: string): Promise<CompanyWatchdogReview | null> {
  const ledger = await readLedger();
  return ledger.companies[companyId] ?? null;
}

export async function recordCompanyWatchdogReview(
  companyId: string,
  input: { stopFingerprint: string; verificationTaskId?: string; reviewedAt?: number },
): Promise<CompanyWatchdogReview> {
  return enqueue(async () => {
    const ledger = await readLedger();
    const previous = ledger.companies[companyId];
    const review: CompanyWatchdogReview = {
      stopFingerprint: input.stopFingerprint,
      reviewedAt: input.reviewedAt ?? Date.now(),
      verificationTaskId: input.verificationTaskId,
      reviewCount: (previous?.reviewCount ?? 0) + 1,
    };
    ledger.companies[companyId] = review;
    await mkdir(path.dirname(COMPANY_WATCHDOG_PATH), { recursive: true });
    await writeFile(COMPANY_WATCHDOG_PATH, JSON.stringify(ledger, null, 2));
    return review;
  });
}

export async function clearCompanyWatchdogReview(companyId: string): Promise<void> {
  await enqueue(async () => {
    const ledger = await readLedger();
    if (!(companyId in ledger.companies)) return;
    delete ledger.companies[companyId];
    await mkdir(path.dirname(COMPANY_WATCHDOG_PATH), { recursive: true });
    await writeFile(COMPANY_WATCHDOG_PATH, JSON.stringify(ledger, null, 2));
  });
}
