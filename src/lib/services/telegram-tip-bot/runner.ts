import "server-only";

import { formatTokenAmount, parseTokenAmount } from "./amounts";
import { bankrGaslessConfigured, getBankrWalletAddress, sendHiveViaBankr } from "./bankr-withdrawal";
import {
  depositCreditedMessage,
  handleTipBotUpdate,
  notifyAdmins,
  notifyUser,
  withdrawalSentMessage,
  type TipBotConfig,
  type TipBotRuntime,
} from "./commands";
import { ensureTreasuryWallet, getHiveTokenMeta, getSafeDepositBlockNumber, scanHiveDeposits, sendHiveFromTreasury } from "./hive-chain";
import { applyDepositCredit, claimNextWithdrawal, expireBounties, expireClaims, resolveWithdrawal } from "./ledger";
import {
  DEFAULT_MEMBER_TAG_TOP_LIMIT,
  DEFAULT_MEMBER_TAG_WINDOW_DAYS,
  knownMemberTagChatIds,
  memberTagSinceIso,
  planMemberTagSync,
  recordMemberTagSync,
  type MemberTagSyncResult,
  type MemberTagTier,
} from "./member-tags";
import {
  handleTipBotModerationUpdate,
  moderationPermissionWarnings,
  type TipBotModerationRuntime,
} from "./moderation";
import { mutateTipBotState, newLedgerEntryId, readTipBotState } from "./store";
import { TelegramBotApi } from "./telegram-api";
import {
  createHiveStakingPublicClient,
  getHiveStakeAccountStatus,
  hiveTierForStakedRaw,
  isHiveEvmAddress,
} from "@/lib/services/hive-staking";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";

const POLL_TIMEOUT_SEC = 25;
const DEPOSIT_SCAN_INTERVAL_MS = 15_000;
const DEFAULT_DEPOSIT_CONFIRMATIONS = 15; // ~30s on Base's 2s blocks
const WITHDRAWAL_INTERVAL_MS = 15_000;
const CLAIM_SWEEP_INTERVAL_MS = 10 * 60_000;
const MEMBER_TAG_SYNC_INTERVAL_MS = 30 * 60_000;
const MEMBER_TAG_MAX_ACTIONS_PER_CYCLE = 100;
const MAX_WITHDRAWAL_ATTEMPTS = 3;

export type TipBotRunnerStatus = {
  status: "running" | "stopped";
  botUsername?: string;
  memberTagBotUsername?: string;
  treasuryAddress?: string;
  withdrawalProvider?: "treasury" | "bankr";
  moderation?: "disabled" | "audit" | "enforce";
  moderationPermissionWarningCount?: number;
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

function parseEnabled(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) return false;
  if (["1", "true", "on", "yes", "enabled"].includes(normalized)) return true;
  return fallback;
}

function parsePositiveInteger(value: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parsePositiveNumber(value: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseStringList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
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
  const confirmations = Number(await tipBotEnv("CONFIRMATIONS"));
  const tagSyncMinutes = parsePositiveNumber(await tipBotEnv("MEMBER_TAG_SYNC_INTERVAL_MINUTES"), MEMBER_TAG_SYNC_INTERVAL_MS / 60_000, 24 * 60);
  const moderationChatIds = parseStringList(await tipBotEnv("MODERATION_CHAT_IDS"));
  const moderationEnabled = parseEnabled(await tipBotEnv("MODERATION"), false) && moderationChatIds.length > 0;
  const communityHoneyBotToken = (await tipBotEnv("HONEY_COMMUNITY_BOT_TOKEN"))
    || (await hiveEnvValue("HONEY_COMMUNITY_BOT_TOKEN"));
  const communityHoneyApiUrl = (await tipBotEnv("HONEY_COMMUNITY_API_URL"))
    || "https://hivemindos-compute-gateway.hivemindos.workers.dev";
  return {
    botUsername,
    adminIds,
    claimTtlHours: claimTtlHours > 0 ? claimTtlHours : 168,
    depositConfirmations: confirmations > 0 ? confirmations : DEFAULT_DEPOSIT_CONFIRMATIONS,
    maxWithdrawalRaw: await envRawAmount("MAX_WITHDRAWAL", tokenMeta.decimals),
    reviewThresholdRaw: await envRawAmount("REVIEW_THRESHOLD", tokenMeta.decimals),
    withdrawalProvider,
    treasuryAddress,
    token: { address: tokenMeta.address, symbol: tokenMeta.symbol, decimals: tokenMeta.decimals },
    memberTags: {
      enabled: parseEnabled(await tipBotEnv("MEMBER_TAGS"), true),
      chatIds: parseStringList(await tipBotEnv("MEMBER_TAG_CHAT_IDS")),
      topLimit: parsePositiveInteger(await tipBotEnv("MEMBER_TAG_TOP_LIMIT"), DEFAULT_MEMBER_TAG_TOP_LIMIT, 50),
      windowDays: parsePositiveNumber(await tipBotEnv("MEMBER_TAG_WINDOW_DAYS"), DEFAULT_MEMBER_TAG_WINDOW_DAYS, 365),
      syncIntervalMs: tagSyncMinutes * 60_000,
      maxActionsPerCycle: parsePositiveInteger(
        await tipBotEnv("MEMBER_TAG_MAX_ACTIONS_PER_CYCLE"),
        MEMBER_TAG_MAX_ACTIONS_PER_CYCLE,
        500,
      ),
    },
    moderation: {
      enabled: moderationEnabled,
      auditOnly: parseEnabled(await tipBotEnv("MODERATION_AUDIT_ONLY"), true),
      chatIds: new Set(moderationChatIds),
      salesInboxChatIds: parseStringList(await tipBotEnv("MODERATION_SALES_CHAT_IDS")),
      trustedUserIds: new Set(parseStringList(await tipBotEnv("MODERATION_TRUSTED_USER_IDS")).filter((id) => /^\d+$/.test(id))),
      allowedDomains: parseStringList(await tipBotEnv("MODERATION_ALLOWED_DOMAINS")),
      blockedDomains: parseStringList(await tipBotEnv("MODERATION_BLOCKED_DOMAINS")),
      newMemberMessageLimit: parsePositiveInteger(await tipBotEnv("MODERATION_NEW_MEMBER_MESSAGE_LIMIT"), 3, 20),
      floodMaxMessages: parsePositiveInteger(await tipBotEnv("MODERATION_FLOOD_MAX_MESSAGES"), 5, 50),
      floodWindowMs: parsePositiveNumber(await tipBotEnv("MODERATION_FLOOD_WINDOW_SECONDS"), 10, 600) * 1_000,
      duplicateMinCharacters: parsePositiveInteger(await tipBotEnv("MODERATION_DUPLICATE_MIN_CHARACTERS"), 32, 2_000),
      duplicateMinOccurrences: parsePositiveInteger(await tipBotEnv("MODERATION_DUPLICATE_MIN_OCCURRENCES"), 3, 10),
      duplicateWindowMs: parsePositiveNumber(await tipBotEnv("MODERATION_DUPLICATE_WINDOW_MINUTES"), 10, 24 * 60) * 60_000,
      muteMinutes: parsePositiveInteger(await tipBotEnv("MODERATION_MUTE_MINUTES"), 60, 10_080),
      banAfterStrikes: parsePositiveInteger(await tipBotEnv("MODERATION_BAN_AFTER_STRIKES"), 3, 20),
    },
    communityHoney: {
      enabled: parseEnabled(await tipBotEnv("HONEY_COMMUNITY"), Boolean(communityHoneyBotToken)),
      apiUrl: communityHoneyApiUrl.replace(/\/+$/, ""),
      botToken: communityHoneyBotToken,
    },
  };
}

async function buildMemberTagApi(primaryToken: string): Promise<{ api?: TelegramBotApi; username?: string }> {
  const tagToken =
    (await tipBotEnv("MEMBER_TAG_TOKEN")) ||
    (await hiveEnvValue("HIVEMINDOS_TELEGRAM_MEMBER_TAG_BOT_TOKEN")) ||
    (await hiveEnvValue("SWARM_SOVEREIGN_TELEGRAM_BOT_TOKEN"));
  if (!tagToken || tagToken === primaryToken) return {};
  const api = new TelegramBotApi(tagToken);
  const me = await api.getMe().catch(() => null);
  return me?.username ? { api, username: me.username } : {};
}

async function updatesLoop(runner: TipBotRunner, runtime: TipBotRuntime, moderationRuntime: TipBotModerationRuntime) {
  let offset: number | undefined;
  while (!runner.stopRequested) {
    try {
      const updates = await runtime.api.getUpdates(offset, POLL_TIMEOUT_SEC);
      for (const update of updates) {
        offset = update.update_id + 1;
        const consumed = await handleTipBotModerationUpdate(moderationRuntime, update).catch((error) => {
          runner.lastError = error instanceof Error ? error.message : String(error);
          return false;
        });
        if (!consumed) {
          await handleTipBotUpdate(runtime, update).catch((error) => {
            runner.lastError = error instanceof Error ? error.message : String(error);
          });
        }
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
      const safeBlock = await getSafeDepositBlockNumber(runtime.config.depositConfirmations);
      if (!state.settings.lastScannedBlock) {
        // First boot: start watching from now rather than replaying history.
        await mutateTipBotState((draft) => {
          draft.settings.lastScannedBlock = safeBlock.toString();
        });
      } else {
        const fromBlock = BigInt(state.settings.lastScannedBlock) + 1n;
        if (fromBlock <= safeBlock) {
          const logs = await scanHiveDeposits({
            treasuryAddress: runtime.config.treasuryAddress,
            fromBlock,
            toBlock: safeBlock,
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
            draft.settings.lastScannedBlock = safeBlock.toString();
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
      const now = new Date().toISOString();
      const expired = await mutateTipBotState((draft) => ({
        claims: expireClaims(draft, { now, makeEntryId: newLedgerEntryId }).map((claim) => ({ ...claim })),
        bounties: expireBounties(draft, { now, makeEntryId: newLedgerEntryId }).map((bounty) => ({ ...bounty })),
      }));
      for (const claim of expired.claims) {
        await notifyUser(
          runtime,
          claim.fromUserId,
          `↩️ Your tip of ${formatTokenAmount(claim.amountRaw, runtime.config.token.decimals)} ${runtime.config.token.symbol} ` +
            `to @${claim.toUsername} expired unclaimed and was refunded.`,
        );
      }
      for (const bounty of expired.bounties) {
        await notifyUser(
          runtime,
          bounty.creatorUserId,
          `↩️ Bounty <code>${bounty.id}</code> expired and its reward/boost escrow was refunded.`,
        );
      }
    } catch (error) {
      runner.lastError = error instanceof Error ? error.message : String(error);
    }
    await sleepUnlessStopped(runner, CLAIM_SWEEP_INTERVAL_MS);
  }
}

async function memberTagLoop(runner: TipBotRunner, runtime: TipBotRuntime) {
  while (!runner.stopRequested) {
    try {
      const result = await syncMemberTags(runtime);
      if (result.errors.length) {
        runner.lastError = `Telegram member tag sync skipped ${result.errors.length} update${result.errors.length === 1 ? "" : "s"}.`;
        console.warn(`[tip-bot] member tag sync skipped ${result.errors.length} update${result.errors.length === 1 ? "" : "s"}: ${result.errors.slice(0, 3).join(" | ")}`);
      }
    } catch (error) {
      runner.lastError = error instanceof Error ? error.message : String(error);
    }
    await sleepUnlessStopped(runner, runtime.config.memberTags.syncIntervalMs);
  }
}

async function syncMemberTags(runtime: TipBotRuntime): Promise<{ applied: number; errors: string[] }> {
  const settings = runtime.config.memberTags;
  if (!settings.enabled) return { applied: 0, errors: [] };

  const state = await readTipBotState();
  const chatIds = knownMemberTagChatIds(state, settings.chatIds);
  if (!chatIds.length) return { applied: 0, errors: [] };

  const tiersByUserId = await readMemberTagTiers(state, runtime.config.token.decimals);
  const sinceIso = memberTagSinceIso(settings.windowDays);
  const actions = planMemberTagSync(state, {
    chatIds,
    topLimit: settings.topLimit,
    sinceIso,
    tiersByUserId,
  }).slice(0, settings.maxActionsPerCycle);
  if (!actions.length) return { applied: 0, errors: [] };

  const applied: MemberTagSyncResult[] = [];
  const errors: string[] = [];
  for (const action of actions) {
    try {
      const member = await runtime.api.getChatMember({ chatId: action.chatId, userId: action.userId });
      if (member.status !== "member" && member.status !== "restricted") {
        applied.push({ chatId: action.chatId, userId: action.userId, tag: action.tag });
        continue;
      }
      if ((member.tag ?? "") !== action.tag) {
        await setMemberTag(runtime, action);
      }
      applied.push({ chatId: action.chatId, userId: action.userId, tag: action.tag });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (applied.length) {
    const now = new Date().toISOString();
    await mutateTipBotState((draft) => {
      recordMemberTagSync(draft, applied, now);
    });
  }
  return { applied: applied.length, errors };
}

async function setMemberTag(runtime: TipBotRuntime, action: { chatId: string; userId: string; tag: string }) {
  try {
    await runtime.api.setChatMemberTag({ chatId: action.chatId, userId: action.userId, tag: action.tag });
  } catch (error) {
    if (!runtime.memberTagApi || !isChatAdminRequired(error)) throw error;
    await runtime.memberTagApi.setChatMemberTag({ chatId: action.chatId, userId: action.userId, tag: action.tag });
  }
}

function isChatAdminRequired(error: unknown): boolean {
  return error instanceof Error && /CHAT_ADMIN_REQUIRED/i.test(error.message);
}

async function readMemberTagTiers(state: Awaited<ReturnType<typeof readTipBotState>>, decimals: number): Promise<Map<string, MemberTagTier>> {
  const tiers = new Map<string, MemberTagTier>();
  const users = Object.values(state.users).filter((user) => user.linkedWallets.length);
  if (!users.length) return tiers;

  const client = createHiveStakingPublicClient();
  for (const user of users) {
    let activeStakedRaw = 0n;
    for (const wallet of user.linkedWallets) {
      if (!isHiveEvmAddress(wallet)) continue;
      try {
        const status = await getHiveStakeAccountStatus({ account: wallet, client, decimals });
        activeStakedRaw += status.activeStakedRaw;
      } catch {
        // Public RPC reads can fail transiently; a missed cycle should not
        // affect balances, withdrawals, or future tag sync attempts.
      }
    }
    const tier = hiveTierForStakedRaw(activeStakedRaw, decimals);
    if (tier) tiers.set(user.id, { id: tier.id, label: tier.label });
  }
  return tiers;
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
  const memberTagApi = await buildMemberTagApi(token);
  const config = await buildConfig(api, me.username);
  const runtime: TipBotRuntime = { api, memberTagApi: memberTagApi.api, config };
  const moderationRuntime: TipBotModerationRuntime = {
    api,
    botUsername: me.username,
    botUserId: String(me.id),
    adminIds: config.adminIds,
    config: config.moderation,
  };
  const permissionWarnings = config.moderation.enabled ? await moderationPermissionWarnings(moderationRuntime) : [];
  if (permissionWarnings.length > 0) {
    console.warn(`[tip-bot] moderation permission warnings: ${permissionWarnings.join(" | ")}`);
    await notifyAdmins(
      runtime,
      `⚠️ Telegram moderation is configured but ${permissionWarnings.length} required bot permission${permissionWarnings.length === 1 ? " is" : "s are"} missing. Audit/routing still works; deletion, mute, or ban actions need can_delete_messages and can_restrict_members.`,
    );
  }

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
      { command: "bounties", description: "Show active community bounties" },
      { command: "bounty", description: "Create or inspect a bounty" },
      { command: "boost", description: "Boost a bounty with your HIVE balance" },
      { command: "submit", description: "Submit bounty or HONEY mission evidence" },
      { command: "honey", description: "View or give HONEY recognition" },
      { command: "honeyaudit", description: "Audit HONEY recognition attempts (admins)" },
      { command: "linkhoney", description: "Connect Telegram to HivemindOS HONEY" },
      { command: "missions", description: "Show open HONEY contribution missions" },
      { command: "mission", description: "Create a HONEY mission (admins)" },
      { command: "review", description: "Review HONEY submissions (admins)" },
      { command: "honeyboard", description: "Contribution leaderboard" },
      { command: "compute", description: "Ways to earn HONEY through useful compute" },
      { command: "modhelp", description: "Moderator commands (admins only)" },
      { command: "modaudit", description: "Audit a member's moderation history (admins)" },
      { command: "modstats", description: "Moderation status (admins only)" },
      { command: "help", description: "How this works" },
    ])
    .catch(() => undefined);

  const runner: TipBotRunner = {
    status: "running",
    botUsername: config.botUsername,
    memberTagBotUsername: memberTagApi.username,
    treasuryAddress: config.treasuryAddress,
    withdrawalProvider: config.withdrawalProvider,
    moderation: config.moderation.enabled ? (config.moderation.auditOnly ? "audit" : "enforce") : "disabled",
    moderationPermissionWarningCount: permissionWarnings.length,
    startedAt: new Date().toISOString(),
    stopRequested: false,
    stopped: Promise.resolve(),
  };
  runner.stopped = Promise.all([
    updatesLoop(runner, runtime, moderationRuntime),
    depositLoop(runner, runtime),
    withdrawalLoop(runner, runtime),
    claimSweepLoop(runner, runtime),
    memberTagLoop(runner, runtime),
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
    memberTagBotUsername: runner.memberTagBotUsername,
    treasuryAddress: runner.treasuryAddress,
    withdrawalProvider: runner.withdrawalProvider,
    moderation: runner.moderation,
    moderationPermissionWarningCount: runner.moderationPermissionWarningCount,
    startedAt: runner.startedAt,
    lastError: runner.lastError,
  };
}
