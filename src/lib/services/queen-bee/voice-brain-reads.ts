import "server-only";

import { isWalletBalanceReadQuery } from "@/lib/services/queen-bee/voice-conversation-policy";
import { readQueenWalletBalances } from "@/lib/services/queen-bee/wallet-balance-read";

export async function readQueenVoiceBrainContext(query: string): Promise<string> {
  if (isWalletBalanceReadQuery(query)) return readQueenWalletBalances(query);
  const { queenVoiceBrainContext } = await import(
    "@/lib/services/queen-bee/voice-brain-context"
  );
  // A silent per-turn preload stays sub-second. Once Queen explicitly calls
  // this tool (and has acknowledged it aloud), allow the canonical stores time
  // to answer instead of turning a slow disk/index read into an access denial.
  return queenVoiceBrainContext(query, {
    includeAccessHistory: true,
    budgetMs: 5_000,
  });
}
