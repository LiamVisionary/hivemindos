import "server-only";

import { normalizeHivemindosWalletPaidSlug } from "@/lib/config/hivemindos-wallet-paid-models";
import {
  getHivemindosModelCreditToken,
  listHivemindosModelCreditTokenSummaries,
  type HivemindosModelCreditTokenSummary,
} from "@/lib/services/hivemindos-model-credit-vault";
import { getManagedXConnections } from "@/lib/services/managed-x-api-client";
import {
  managedXConnectionId,
  managedXConnectionsFromPayload,
  type ManagedXConnectionRecord,
} from "@/lib/services/managed-x-connections";
import { updateSocialAccount } from "@/lib/services/socials/socials-store";
import type { SocialAccount } from "@/lib/services/socials/socials-types";

export type ManagedXCreditResolution = {
  credentials?: { creditToken: string; creditSlug: string; connectionId: string };
  error: string;
  status?: number;
  retryable?: boolean;
};

type ManagedXConnectionLookup = {
  ok: boolean;
  status?: number;
  connections: ManagedXConnectionRecord[];
};

export type ManagedXCreditBindingDependencies = {
  listCreditAccounts: () => Promise<HivemindosModelCreditTokenSummary[]>;
  getCreditToken: (creditAccountId: string, creditSlug: string) => Promise<string>;
  getConnections: (creditToken: string, creditSlug: string) => Promise<ManagedXConnectionLookup>;
  persistBinding: (accountId: string, binding: { creditAccountId: string; creditSlug: string }) => Promise<void>;
};

const defaultDependencies: ManagedXCreditBindingDependencies = {
  listCreditAccounts: listHivemindosModelCreditTokenSummaries,
  getCreditToken: getHivemindosModelCreditToken,
  async getConnections(creditToken, creditSlug) {
    const response = await getManagedXConnections(creditToken, creditSlug);
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      connections: managedXConnectionsFromPayload(payload),
    };
  },
  async persistBinding(accountId, binding) {
    await updateSocialAccount(accountId, (account) => ({
      ...account,
      binding: { ...(account.binding ?? {}), ...binding },
    }));
  },
};

type InspectedCreditAccount = {
  summary: HivemindosModelCreditTokenSummary;
  creditSlug: string;
  creditToken: string;
  verified: boolean;
  ownsConnection: boolean;
};

async function inspectCreditAccount(
  summary: HivemindosModelCreditTokenSummary,
  connectionId: string,
  dependencies: ManagedXCreditBindingDependencies,
): Promise<InspectedCreditAccount> {
  const creditSlug = normalizeHivemindosWalletPaidSlug(summary.slug);
  try {
    const creditToken = await dependencies.getCreditToken(summary.walletAgentId, creditSlug);
    if (!creditToken) return { summary, creditSlug, creditToken: "", verified: false, ownsConnection: false };
    const lookup = await dependencies.getConnections(creditToken, creditSlug);
    return {
      summary,
      creditSlug,
      creditToken,
      verified: lookup.ok,
      ownsConnection: lookup.ok && lookup.connections.some((connection) => managedXConnectionId(connection) === connectionId),
    };
  } catch {
    return { summary, creditSlug, creditToken: "", verified: false, ownsConnection: false };
  }
}

async function persistResolvedBinding(
  account: SocialAccount,
  match: Pick<InspectedCreditAccount, "summary" | "creditSlug" | "creditToken">,
  connectionId: string,
  dependencies: ManagedXCreditBindingDependencies,
): Promise<ManagedXCreditResolution> {
  try {
    await dependencies.persistBinding(account.id, {
      creditAccountId: match.summary.walletAgentId,
      creditSlug: match.creditSlug,
    });
  } catch {
    return {
      error: "HivemindOS identified the credit account for this X connection but could not save the repaired binding. Retry after checking the Socials store.",
      status: 500,
      retryable: true,
    };
  }
  return {
    credentials: {
      creditToken: match.creditToken,
      creditSlug: match.creditSlug,
      connectionId,
    },
    error: "",
  };
}

/**
 * Resolve the hosted payer for a managed X connection. Legacy Socials records
 * predate payer binding, so they are migrated only after every stored credit
 * account is inspected and exactly one exposes the saved connection id.
 */
export async function resolveManagedXCredit(
  account: SocialAccount,
  dependencies: ManagedXCreditBindingDependencies = defaultDependencies,
): Promise<ManagedXCreditResolution> {
  const connectionId = (account.binding?.connectionSlug ?? "").trim();
  if (!connectionId) {
    return { error: "Managed X posting needs a saved X connection. Reconnect this account." };
  }

  const savedCreditAccountId = (account.binding?.creditAccountId ?? "").trim();
  const savedCreditSlug = normalizeHivemindosWalletPaidSlug(account.binding?.creditSlug);
  if (savedCreditAccountId) {
    const creditToken = await dependencies.getCreditToken(savedCreditAccountId, savedCreditSlug).catch(() => "");
    return creditToken
      ? { credentials: { creditToken, creditSlug: savedCreditSlug, connectionId }, error: "" }
      : { error: "No hosted HivemindOS credit token is stored for this managed X account.", status: 402 };
  }

  const summaries = await dependencies.listCreditAccounts().catch(() => []);
  if (!summaries.length) {
    return { error: "Managed X posting needs a funded credit account. Fund credits, then reconnect this account.", status: 402 };
  }

  if (summaries.length === 1) {
    const summary = summaries[0];
    const creditSlug = normalizeHivemindosWalletPaidSlug(summary.slug);
    const creditToken = await dependencies.getCreditToken(summary.walletAgentId, creditSlug).catch(() => "");
    if (!creditToken) return { error: "No hosted HivemindOS credit token is stored for this managed X account.", status: 402 };
    return persistResolvedBinding(account, { summary, creditSlug, creditToken }, connectionId, dependencies);
  }

  const inspected = await Promise.all(summaries.map((summary) => inspectCreditAccount(summary, connectionId, dependencies)));
  const unavailable = inspected.filter((candidate) => !candidate.verified);
  if (unavailable.length) {
    return {
      error: `HivemindOS could not safely determine which credit account owns this X connection because ${unavailable.length} account lookup${unavailable.length === 1 ? "" : "s"} failed. Retry when the managed X gateway is reachable.`,
      status: 503,
      retryable: true,
    };
  }

  const matches = inspected.filter((candidate) => candidate.ownsConnection);
  if (matches.length !== 1) {
    return {
      error: matches.length
        ? "More than one credit account exposes this X connection, so HivemindOS will not guess which account to charge. Reconnect it with an explicit credit account."
        : "This saved X connection does not belong to any stored credit account. Reconnect it and choose the credit account to charge.",
    };
  }

  return persistResolvedBinding(account, matches[0], connectionId, dependencies);
}
