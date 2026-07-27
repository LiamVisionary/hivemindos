import "server-only";

import { normalizeHivemindosWalletPaidSlug } from "@/lib/config/hivemindos-wallet-paid-models";
import {
  listHivemindosModelCreditTokenSummaries,
  resolvePooledHivemindosModelCreditToken,
} from "@/lib/services/hivemindos-model-credit-vault";

export async function resolveBeelineBrokerCredential(slug: string): Promise<{ token: string; slug: string }> {
  const normalizedSlug = normalizeHivemindosWalletPaidSlug(slug);
  const summaries = (await listHivemindosModelCreditTokenSummaries())
    .filter((summary) => normalizeHivemindosWalletPaidSlug(summary.slug) === normalizedSlug);
  const token = await resolvePooledHivemindosModelCreditToken(
    normalizedSlug,
    summaries.map((summary) => summary.walletAgentId),
  ).catch(() => "");
  return { token, slug: normalizedSlug };
}
