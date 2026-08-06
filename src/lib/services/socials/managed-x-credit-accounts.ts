import { HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID } from "@/lib/config/hivemindos-wallet-paid-models";

type ManagedXCreditAccountAlias = {
  accountId: string;
  hostedAccountId?: string | null;
};

/**
 * One hosted credit token can remain stored under several legacy local labels.
 * Collapse only aliases proven to resolve to the same hosted account, and put
 * the canonical per-install shared pool first so it becomes the safe default.
 */
export function dedupeManagedXCreditAccountAliases<T extends ManagedXCreditAccountAlias>(
  accounts: readonly T[],
): T[] {
  const canonical = accounts.filter((account) => account.accountId === HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID);
  const remaining = accounts.filter((account) => account.accountId !== HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID);
  const seenHostedAccountIds = new Set<string>();
  const result: T[] = [];

  for (const account of [...canonical, ...remaining]) {
    const hostedAccountId = account.hostedAccountId?.trim() || "";
    if (hostedAccountId && seenHostedAccountIds.has(hostedAccountId)) continue;
    if (hostedAccountId) seenHostedAccountIds.add(hostedAccountId);
    result.push(account);
  }

  return result;
}
