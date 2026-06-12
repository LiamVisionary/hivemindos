import "server-only";

import { formatTokenAmount, parseTokenAmount } from "./amounts";
import { bankrGaslessConfigured, getBankrWalletAddress, sendHiveViaBankr } from "./bankr-withdrawal";
import {
  depositCreditedMessage,
  handleTipBotUpdate,
  notifyUser,
  withdrawalSentMessage,
  type TipBotConfig,
  type TipBotRuntime,
} from "./commands";
import { ensureTreasuryWallet, getFinalizedBlockNumber, getHiveTokenMeta, scanHiveDeposits, sendHiveFromTreasury } from "./hive-chain";
import { applyDepositCredit, claimNextWithdrawal, expireClaims, resolveWithdrawal } from "./ledger";
import { mutateTipBotState, newLedgerEntryId, readTipBotState } from "./store";
import { TelegramBotApi } from "./telegram-api";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";

const POLL_TIMEOUT_SEC = 25;
const DEPOSIT_SCAN_INTERVAL_MS = 30_000;
const WITHDRAWAL_INTERVAL_MS = 15_000;
const CLAIM_SWEEP_INTERVAL_MS = 10 * 60_000;
const MAX_WITHDRAWAL_ATTEMPTS = 3;

export type TipBotRunnerStatus = {
  status: "running" | "stopped";
  botUsername?: string;
  treasuryAddress?: string;
  withdrawalProvider?: "treasury" | "bankr";
  startedAt?: string;
  lastError?: string;
};

type TipBotRunner = TipBotRunnerStatus & { stopRequested: boolean; stopped: Promise<void> };

const globalState = globalThis as typeof globalThis & { __hivemindTelegramTipBotRunner?: TipBotRunner };

function sleepUnlessStopped(runner: TipBotRunner, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const interval = setInterval(() => {
      if (runner.stopRequested || Date.now() - started >= ms) {
        clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

// Config reads go through hiveEnvValue so credentials and knobs can live in
// the shared hive env (~/.hivemindos/.env); process.env still wins when set.
// Each knob accepts bare, HIVEMINDOS_-prefixed, and prefixed-without-TELEGRAM
// spellings (e.g. HIVEMINDOS_TIP_BOT_TOKEN).
async function tipBotEnv(suffix: string): Promise<string> {
  const names = [
    `TELEGRAM_TIP_BOT_${suffix}`,
    `HIVEMINDOS_TELEGRAM_TIP_BOT_${suffix}`,
    `HIVEMINDOS_TIP_BOT_${suffix}`,
  ];
  for (const name of names) {
    const value = await hiveEnvValue(name);
    if (value) return value;
  }
  return "";
}

async function envRawAmount(suffix: string, decimals: number): Promise<bigint | null> {
  const value = await tipBotEnv(suffix);
  if (!value) return null;
  return parseTokenAmount(value, decimals);
}

async function buildConfig(api: TelegramBotApi, botUsername: string): Promise<TipBotConfig> {
  const tokenMeta = await getHiveTokenMeta();
  const wantsBankr = (await tipBotEnv("WITHDRAWAL_PROVIDER")).toLowerCase() === "bankr";
  if (wantsBankr && !(await bankrGaslessConfigured())) {
    throw new Error("TELEGRAM_TIP_BOT_WITHDRAWAL_PROVIDER=bankr but BANKR_API_KEY is not set in the shared hive env.");
  }
  const withdrawalProvider: "treasury" | "bankr" = wantsBankr ? "bankr" : "treasury";
  const treasuryAddress = wantsBankr ? await getBankrWalletAddress() : (await ensureTreasuryWallet()).address;
  const adminIds = new Set(
    (await tipBotEnv("ADMIN_IDS"))
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^\d+$/.test(id)),
  );
  const claimTtlHours = Number(await tipBotEnv("CLAIM_TTL_HOURS"));
  return {
    botUsername,
    adminIds,
    claimTtlHours: claimTtlHours > 0 ? claimTtlHours : 168,
    maxWithdrawalRaw: await envRawAmount("MAX_WITHDRAWAL", tokenMeta.decimals),
    reviewThresholdRaw: await envRawAmount("REVIEW_THRESHOLD", tokenMeta.decimals),
    withdrawalProvider,
    treasuryAddress,
    token: { address: tokenMeta.address, symbol: tokenMeta.symbol, decimals: tokenMeta.decimals },
  };
}

async function updatesLoop(runner: TipBotRunner, runtime: TipBotRuntime) {
  let offset: number | undefined;
  while (!runner.stopRequested) {
    try {
      const updates = await runtime.api.getUpdates(offset, POLL_TIMEOUT_SEC);
      for (const update of updates) {
        offset = update.update_id + 1;
        await handleTipBotUpdate(runtime, update).catch((error) => {
          runner.lastError = error instanceof Error ? error.message : String(error);
        });
      }
    } catch (error) {
      runner.lastError = error instanceof Error ? error.message : String(error);
      await sleepUnlessStopped(runner, 5_000);
    }
  }
}

async function depositLoop(runner: TipBotRunner, runtime: TipBotRuntime) {
  while (!runner.stopRequested) {
    try {
      const state = await readTipBotState();
      const finalized = await getFinalizedBlockNumber();
      if (!state.settings.lastScannedBlock) {
        // First boot: start watching from now rather than replaying history.
        await mutateTipBotState((draft) => {
          draft.settings.lastScannedBlock = finalized.toString();
        });
      } else {
        const fromBlock = BigInt(state.settings.lastScannedBlock) + 1n;
        if (fromBlock <= finalized) {
          const logs = await scanHiveDeposits({
            treasuryAddress: runtime.config.treasuryAddress,
            fromBlock,
            toBlock: finalized,
          });
          const credited = await mutateTipBotState((draft) => {
            const walletOwners = new Map<string, string>();
            for (const user of Object.values(draft.users)) {
              for (const wallet of user.linkedWallets) walletOwners.set(wallet, user.id);
            }
            const creditedDeposits: Array<{ userId: string; amountRaw: string; txHash: string }> = [];
            for (const log of logs) {
              const userId = walletOwners.get(log.fromAddress);
              if (!userId) continue; // unattributed deposit — visible on-chain, surfaced in /botstats solvency
              const deposit = applyDepositCredit(draft, {
                id: newLedgerEntryId(),
                txHash: log.txHash,
                logIndex: log.logIndex,
                fromAddress: log.fromAddress,
                userId,
                amountRaw: log.amountRaw,
                blockNumber: log.blockNumber,
                createdAt: new Date().toISOString(),
              });
              if (deposit) creditedDeposits.push({ userId, amountRaw: deposit.amountRaw, txHash: deposit.txHash });
            }
            draft.settings.lastScannedBlock = finalized.toString();
            return creditedDeposits;
          });
          for (const deposit of credited) {
            await notifyUser(runtime, deposit.userId, depositCreditedMessage(runtime.config, deposit.amountRaw, deposit.txHash));
          }
        }
      }
    } catch (error) {
      runner.lastError = error instanceof Error ? error.message : String(error);
    }
    await sleepUnlessStopped(runner, DEPOSIT_SCAN_INTERVAL_MS);
  }
}

async function withdrawalLoop(runner: TipBotRunner, runtime: TipBotRuntime) {
  while (!runner.stopRequested) {
    try {
      const paused = (await readTipBotState()).settings.paused;
      const job = paused ? null : await mutateTipBotState((draft) => claimNextWithdrawal(draft, new Date().toISOString()));
      if (!job) {
        await sleepUnlessStopped(runner, WITHDRAWAL_INTERVAL_MS);
        continue;
      }
      try {
        const result =
          job.provider === "bankr"
            ? await sendHiveViaBankr({
                tokenAddress: runtime.config.token.address,
                toAddress: job.toAddress,
                amountHuman: formatTokenAmount(job.amountRaw, runtime.config.token.decimals),
              })
            : await sendHiveFromTreasury(job.toAddress, BigInt(job.amountRaw));
        await mutateTipBotState((draft) =>
          resolveWithdrawal(draft, { id: job.id, status: "sent", txHash: result.txHash, updatedAt: new Date().toISOString() }),
        );
        await notifyUser(runtime, job.userId, withdrawalSentMessage(runtime.config, job.amountRaw, result.txHash));
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        const exhausted = job.attempts >= MAX_WITHDRAWAL_ATTEMPTS;
        await mutateTipBotState((draft) =>
          resolveWithdrawal(draft, {
            id: job.id,
            status: exhausted ? "failed" : "pending",
            error: text,
            refundEntryId: exhausted ? newLedgerEntryId() : undefined,
            updatedAt: new Date().toISOString(),
          }),
        );
        if (exhausted) {
          await notifyUser(
            runtime,
            job.userId,
            `⚠️ Withdrawal <code>${job.id}</code> failed after ${MAX_WITHDRAWAL_ATTEMPTS} attempts and was refunded to your balance.`,
          );
        } else {
          await sleepUnlessStopped(runner, WITHDRAWAL_INTERVAL_MS);
        }
      }
    } catch (error) {
      runner.lastError = error instanceof Error ? error.message : String(error);
      await sleepUnlessStopped(runner, WITHDRAWAL_INTERVAL_MS);
    }
  }
}

async function claimSweepLoop(runner: TipBotRunner, runtime: TipBotRuntime) {
  while (!runner.stopRequested) {
    try {
      const refunded = await mutateTipBotState((draft) =>
        expireClaims(draft, { now: new Date().toISOString(), makeEntryId: newLedgerEntryId }).map((claim) => ({ ...claim })),
      );
      for (const claim of refunded) {
        await notifyUser(
          runtime,
          claim.fromUserId,
          `↩️ Your tip of ${formatTokenAmount(claim.amountRaw, runtime.config.token.decimals)} ${runtime.config.token.symbol} ` +
            `to @${claim.toUsername} expired unclaimed and was refunded.`,
        );
      }
    } catch (error) {
      runner.lastError = error instanceof Error ? error.message : String(error);
    }
    await sleepUnlessStopped(runner, CLAIM_SWEEP_INTERVAL_MS);
  }
}

export async function startTelegramTipBot(): Promise<TipBotRunnerStatus> {
  const existing = globalState.__hivemindTelegramTipBotRunner;
  if (existing?.status === "running") return getTelegramTipBotStatus();

  const token = (await tipBotEnv("TOKEN")) || (await hiveEnvValue("TELEGRAM_BOT_TOKEN"));
  if (!token) {
    throw new Error("Set TELEGRAM_TIP_BOT_TOKEN (or TELEGRAM_BOT_TOKEN) in ~/.hivemindos/.env — get one from @BotFather.");
  }
  const api = new TelegramBotApi(token);
  const me = await api.getMe();
  if (!me.username) throw new Error("Bot has no username — check the token.");
  const config = await buildConfig(api, me.username);
  const runtime: TipBotRuntime = { api, config };

  await mutateTipBotState((draft) => {
    draft.settings.botUsername = config.botUsername;
    draft.settings.tokenAddress = config.token.address;
    draft.settings.tokenSymbol = config.token.symbol;
    draft.settings.tokenDecimals = config.token.decimals;
    draft.settings.treasuryAddress = config.treasuryAddress;
    draft.settings.withdrawalProvider = config.withdrawalProvider;
  });

  await api
    .setMyCommands([
      { command: "tip", description: "Tip HIVE: reply with /tip 10, or /tip 10 @name" },
      { command: "balance", description: "Show your balance" },
      { command: "deposit", description: "Top up your balance on Base" },
      { command: "linkwallet", description: "Link your Base wallet for deposits" },
      { command: "withdraw", description: "Withdraw to your wallet (DM only)" },
      { command: "leaderboard", description: "Top tippers in this chat" },
      { command: "help", description: "How this works" },
    ])
    .catch(() => undefined);

  const runner: TipBotRunner = {
    status: "running",
    botUsername: config.botUsername,
    treasuryAddress: config.treasuryAddress,
    withdrawalProvider: config.withdrawalProvider,
    startedAt: new Date().toISOString(),
    stopRequested: false,
    stopped: Promise.resolve(),
  };
  runner.stopped = Promise.all([
    updatesLoop(runner, runtime),
    depositLoop(runner, runtime),
    withdrawalLoop(runner, runtime),
    claimSweepLoop(runner, runtime),
  ]).then(() => {
    runner.status = "stopped";
  });
  globalState.__hivemindTelegramTipBotRunner = runner;
  return getTelegramTipBotStatus();
}

export async function stopTelegramTipBot(): Promise<TipBotRunnerStatus> {
  const runner = globalState.__hivemindTelegramTipBotRunner;
  if (runner && runner.status === "running") {
    runner.stopRequested = true;
    await runner.stopped;
  }
  return getTelegramTipBotStatus();
}

export function getTelegramTipBotStatus(): TipBotRunnerStatus {
  const runner = globalState.__hivemindTelegramTipBotRunner;
  if (!runner) return { status: "stopped" };
  return {
    status: runner.status,
    botUsername: runner.botUsername,
    treasuryAddress: runner.treasuryAddress,
    withdrawalProvider: runner.withdrawalProvider,
    startedAt: runner.startedAt,
    lastError: runner.lastError,
  };
}
