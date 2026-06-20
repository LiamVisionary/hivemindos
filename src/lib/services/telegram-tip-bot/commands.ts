import "server-only";

import { formatCompactTokenAmount, formatTokenAmount, parseTokenAmount } from "./amounts";
import { renderTelegramCardPng, type TelegramCardCell, type TelegramCardSection } from "./card-renderer";
import { explorerTxUrl, getTreasuryOverview } from "./hive-chain";
import {
  applyBountyBoost,
  applyBountyCreate,
  applyBountyPayout,
  applyBountyRefund,
  applyBountySubmission,
  applyClaimCredit,
  applyClaimEscrow,
  applyTip,
  applyWithdrawalRequest,
  approveWithdrawal,
  balanceOf,
  bountyBoard,
  ensureUser,
  findBounty,
  findUserByUsername,
  findWithdrawal,
  resolveWithdrawal,
  tipLeaderboard,
  totalLiabilitiesRaw,
  type TipBotBounty,
  type TipBotBountyBoardRow,
  type TipBotState,
  type TipBotUser,
} from "./ledger";
import { parseCommand, resolveTipRecipient, type ParsedCommand } from "./parse";
import { rememberMemberTagChat } from "./member-tags";
import {
  mutateTipBotState,
  newBountyBoostId,
  newBountyId,
  newBountySubmissionId,
  newClaimToken,
  newLedgerEntryId,
  newWithdrawalId,
  readTipBotState,
} from "./store";
import { richAccent, richBold, richCode, richMuted, richTable, type RichTableCell } from "./rich-formatting";
import { escapeHtml, mentionHtml, type TelegramBotApi, type TgMessage, type TgUpdate, type TgUser } from "./telegram-api";

export type TipBotConfig = {
  botUsername: string;
  adminIds: Set<string>;
  claimTtlHours: number;
  depositConfirmations: number;
  maxWithdrawalRaw: bigint | null;
  reviewThresholdRaw: bigint | null;
  withdrawalProvider: "treasury" | "bankr";
  treasuryAddress: string;
  token: { address: string; symbol: string; decimals: number };
  memberTags: {
    enabled: boolean;
    chatIds: string[];
    topLimit: number;
    windowDays: number;
    syncIntervalMs: number;
    maxActionsPerCycle: number;
  };
};

export type TipBotRuntime = {
  api: TelegramBotApi;
  memberTagApi?: TelegramBotApi;
  config: TipBotConfig;
};

const MAX_LINKED_WALLETS = 5;

function fmt(config: TipBotConfig, amountRaw: bigint | string): string {
  return `${formatTokenAmount(amountRaw, config.token.decimals)} ${config.token.symbol}`;
}

function fmtCompact(config: TipBotConfig, amountRaw: bigint | string): string {
  return `${formatCompactTokenAmount(amountRaw, config.token.decimals)} ${config.token.symbol}`;
}

function fmtCompactValue(config: TipBotConfig, amountRaw: bigint | string): string {
  return formatCompactTokenAmount(amountRaw, config.token.decimals);
}

function isAdmin(config: TipBotConfig, from: TgUser): boolean {
  return config.adminIds.has(String(from.id));
}

export async function notifyAdmins(runtime: TipBotRuntime, text: string) {
  for (const adminId of runtime.config.adminIds) {
    await runtime.api.sendMessage({ chatId: adminId, text }).catch(() => undefined);
  }
}

// DM a user; fails silently when they haven't started the bot (Telegram 403).
export async function notifyUser(runtime: TipBotRuntime, userId: string, text: string) {
  await runtime.api.sendMessage({ chatId: userId, text }).catch(() => undefined);
}

function helpText(config: TipBotConfig): string {
  const symbol = config.token.symbol;
  return [
    `🍯 <b>${symbol} Tip Bot</b> — tips are instant and off-chain; deposits and withdrawals settle on Base.`,
    "",
    `/tip 10 — reply to someone's message to tip them ${symbol}`,
    `/tip 10 @name — tip by username (they get a claim link if I haven't met them)`,
    "Amounts take 1,000 / 5k / 1.5m shorthand.",
    "/balance — your balance",
    "/deposit — how to top up",
    "/linkwallet 0x… — link your Base wallet (required before depositing)",
    `/withdraw 25 0x… — send ${symbol} to your wallet on Base (DM me for this)`,
    "/leaderboard [week] — top tippers in this chat",
    `/bounty create Build thing | reward 100 | due 2026-07-01 — lock ${symbol} for a community bounty`,
    "/bounties — active bounty board",
    "/boost &lt;id&gt; 25 — add your balance to a bounty escrow",
    "/submit &lt;id&gt; &lt;url or note&gt; — submit work",
    "",
    "Missing a detail? I'll ask — just reply to my question.",
  ].join("\n");
}

// Only mutate (and hit disk) when the message actually teaches us something
// new about the sender — most group traffic is repeat users.
async function registerSeenUsers(state: TipBotState, message: TgMessage) {
  const seen = [message.from, message.reply_to_message?.from].filter(
    (user): user is TgUser => Boolean(user && !user.is_bot),
  );
  const chatId = message.chat.type === "group" || message.chat.type === "supergroup" ? String(message.chat.id) : "";
  const stale = seen.some((user) => {
    const existing = state.users[String(user.id)];
    return (
      !existing ||
      (user.username && existing.username?.toLowerCase() !== user.username.toLowerCase()) ||
      (user.first_name && existing.firstName !== user.first_name)
    );
  });
  const staleChat = Boolean(chatId && !(state.memberTags?.chatIds ?? []).includes(chatId));
  if (!stale && !staleChat) return;
  const createdAt = new Date().toISOString();
  await mutateTipBotState((draft) => {
    if (chatId) rememberMemberTagChat(draft, chatId);
    for (const user of seen) {
      ensureUser(draft, { id: user.id, username: user.username, firstName: user.first_name, createdAt });
    }
  });
}

// Ask-instead-of-error: when a command is missing an argument, the bot sends
// a ForceReply question and remembers it here. The user's reply to that exact
// message completes the command. In-memory on purpose — prompts are
// short-lived and a restart just means the user re-runs the command.
type PendingPrompt = { command: string; userId: string; targetUserId?: string; expiresAt: number };
const pendingPrompts = new Map<string, PendingPrompt>();
const PROMPT_TTL_MS = 15 * 60_000;

async function promptForReply(
  reply: ReplyFn,
  params: { chatId: number; text: string; command: string; userId: string; targetUserId?: string },
) {
  const sent = await reply(params.text, { forceReply: true });
  if (sent?.message_id) {
    if (pendingPrompts.size > 500) {
      for (const [key, prompt] of pendingPrompts) {
        if (prompt.expiresAt < Date.now()) pendingPrompts.delete(key);
      }
    }
    pendingPrompts.set(`${params.chatId}:${sent.message_id}`, {
      command: params.command,
      userId: params.userId,
      targetUserId: params.targetUserId,
      expiresAt: Date.now() + PROMPT_TTL_MS,
    });
  }
}

function consumePromptReply(message: TgMessage): ParsedCommand | null {
  if (!message.reply_to_message || !message.from || !message.text) return null;
  const key = `${message.chat.id}:${message.reply_to_message.message_id}`;
  const prompt = pendingPrompts.get(key);
  if (!prompt || prompt.expiresAt < Date.now() || prompt.userId !== String(message.from.id)) return null;
  pendingPrompts.delete(key);
  return { command: prompt.command, args: message.text.trim(), targetUserId: prompt.targetUserId };
}

function displayName(user: TipBotUser): string {
  return user.username ? `@${user.username}` : user.firstName || `user ${user.id}`;
}

function parseDueAt(raw: string, now = Date.now()): string {
  const value = raw.trim();
  const days = value.match(/^(\d{1,3})d$/i);
  if (days) return new Date(now + Number(days[1]) * 24 * 3_600_000).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T23:59:59.999Z`).toISOString();
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error("Due date should be YYYY-MM-DD, 7d, or a parseable date.");
  return new Date(parsed).toISOString();
}

function shortDate(iso?: string): string {
  if (!iso) return "-";
  return iso.slice(0, 10);
}

function bountyTotalRaw(bounty: TipBotBounty): bigint {
  return BigInt(bounty.rewardRaw) + bounty.boosts.reduce((total, boost) => total + (boost.refundedAt ? 0n : BigInt(boost.amountRaw)), 0n);
}

function visibleBountyRows(config: TipBotConfig, rows: TipBotBountyBoardRow[]): RichTableCell[][] {
  return rows.slice(0, 12).map((row, index) => [
    richMuted(String(index + 1)),
    richCode(row.id),
    row.status === "active" || row.status === "submitted" ? richAccent(row.status) : richBold(row.status),
    row.title,
    richAccent(fmtCompactValue(config, row.totalRaw)),
    row.boosterCount > 0 ? richBold(String(row.boosterCount)) : richMuted("0"),
    row.dueAt ? richMuted(shortDate(row.dueAt)) : row.submissionCount ? richMuted(`${row.submissionCount} sub`) : richMuted("-"),
  ]);
}

function leaderboardCardRows(
  config: TipBotConfig,
  state: TipBotState,
  rows: ReturnType<typeof tipLeaderboard>["tippers"],
): TelegramCardCell[][] {
  return rows.slice(0, 10).map((row, index) => {
    const user = state.users[row.userId];
    return [
      { text: String(index + 1), tone: index < 3 ? "accent" : "muted", align: "center" },
      { text: user ? displayName(user) : `user ${row.userId}` },
      { text: fmtCompactValue(config, row.totalRaw), tone: "accent", align: "right" },
      { text: String(row.count), align: "center" },
    ];
  });
}

function bountyCardRows(config: TipBotConfig, rows: TipBotBountyBoardRow[]): TelegramCardCell[][] {
  return rows.slice(0, 12).map((row, index) => [
    { text: String(index + 1), tone: "muted", align: "center" },
    { text: row.id, tone: "code" },
    { text: row.status, tone: row.status === "active" || row.status === "submitted" ? "accent" : "default" },
    { text: row.title },
    { text: fmtCompactValue(config, row.totalRaw), tone: "accent", align: "right" },
    { text: String(row.boosterCount), tone: row.boosterCount > 0 ? "default" : "muted", align: "center" },
    { text: row.dueAt ? shortDate(row.dueAt) : row.submissionCount ? `${row.submissionCount} sub` : "-", tone: "muted" },
  ]);
}

async function renderCardOrNull(card: { title: string; subtitle?: string; sections: TelegramCardSection[] }): Promise<ArrayBuffer | undefined> {
  return renderTelegramCardPng(card).catch(() => undefined);
}

function parseBountyCreateArgs(args: string, decimals: number): { title: string; rewardRaw: string; dueAt?: string } {
  const rest = args.replace(/^create\b/i, "").trim();
  const parts = rest
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  const title = parts[0] ?? "";
  const rewardPart = parts.find((part) => /^reward\b/i.test(part));
  if (!title || !rewardPart) throw new Error("Usage: /bounty create <title> | reward <amount> | due <YYYY-MM-DD optional>");
  const rewardToken = rewardPart.replace(/^reward\b/i, "").trim().split(/\s+/)[0];
  if (!rewardToken) throw new Error("Bounty reward amount is required.");
  const duePart = parts.find((part) => /^due\b/i.test(part));
  return {
    title,
    rewardRaw: parseTokenAmount(rewardToken, decimals).toString(),
    dueAt: duePart ? parseDueAt(duePart.replace(/^due\b/i, "")) : undefined,
  };
}

function parseIdAndAmount(args: string, decimals: number, usage: string): { id: string; amountRaw: string } {
  const [id, amountToken] = args.split(/\s+/).filter(Boolean);
  if (!id || !amountToken) throw new Error(usage);
  return { id, amountRaw: parseTokenAmount(amountToken, decimals).toString() };
}

export async function handleTipBotUpdate(runtime: TipBotRuntime, update: TgUpdate) {
  const message = update.message;
  if (!message?.from || message.from.is_bot || !message.text) return;

  const state = await readTipBotState();
  await registerSeenUsers(state, message);

  const parsed = parseCommand(message.text, runtime.config.botUsername) ?? consumePromptReply(message);
  if (!parsed) return;

  const reply: ReplyFn = async (text, extra) => {
    if (extra?.photoPng) {
      try {
        return await runtime.api.sendPhoto({
          chatId: message.chat.id,
          png: extra.photoPng,
          caption: extra.photoCaption,
          replyToMessageId: message.message_id,
        });
      } catch {
        // Fall through to rich/plain text. The card renderer is polish, not a
        // reason to fail the command.
      }
    }
    return extra?.richHtml
      ? runtime.api.sendRichMessage({
          chatId: message.chat.id,
          html: extra.richHtml,
          fallbackText: text,
          replyToMessageId: message.message_id,
        })
      : runtime.api.sendMessage({
          chatId: message.chat.id,
          text,
          replyToMessageId: message.message_id,
          inlineKeyboard: extra?.inlineKeyboard,
          forceReply: extra?.forceReply,
        });
  };

  try {
    switch (parsed.command) {
      case "start":
        return await handleStart(runtime, message, parsed.args, reply);
      case "help":
        return void (await reply(helpText(runtime.config)));
      case "balance":
        return await handleBalance(runtime, message, reply);
      case "deposit":
        return await handleDeposit(runtime, message, reply);
      case "linkwallet":
        return await handleLinkWallet(runtime, message, parsed.args, reply);
      case "tip":
        return await handleTip(runtime, message, parsed.args, reply, parsed.targetUserId);
      case "withdraw":
        return await handleWithdraw(runtime, message, parsed.args, reply);
      case "leaderboard":
        return await handleLeaderboard(runtime, message, parsed.args, reply);
      case "bounty":
        return await handleBounty(runtime, message, parsed.args, reply);
      case "bounties":
        return await handleBounties(runtime, message, reply);
      case "boost":
        return await handleBoost(runtime, message, parsed.args, reply);
      case "submit":
        return await handleSubmit(runtime, message, parsed.args, reply);
      case "accept":
        return await handleAccept(runtime, message, parsed.args, reply);
      case "refund":
        return await handleRefund(runtime, message, parsed.args, reply);
      case "bountystats":
        return await handleBountyStats(runtime, message, reply);
      case "pause":
      case "resume":
        return await handlePauseResume(runtime, message, parsed.command, reply);
      case "approve":
      case "reject":
        return await handleReviewDecision(runtime, message, parsed.command, parsed.args, reply);
      case "botstats":
        return await handleBotStats(runtime, message, reply);
      default:
        return;
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : "Something went wrong.";
    await reply(`⚠️ ${escapeHtml(text)}`).catch(() => undefined);
  }
}

type ReplyExtra = {
  inlineKeyboard?: Array<Array<{ text: string; url: string }>>;
  forceReply?: boolean;
  richHtml?: string;
  photoPng?: ArrayBuffer;
  photoCaption?: string;
};
type ReplyFn = (text: string, extra?: ReplyExtra) => Promise<TgMessage>;

async function handleStart(runtime: TipBotRuntime, message: TgMessage, args: string, reply: ReplyFn) {
  const from = message.from as TgUser;
  if (args.startsWith("claim_")) {
    const token = args.slice("claim_".length);
    const createdAt = new Date().toISOString();
    const result = await mutateTipBotState((draft) => {
      ensureUser(draft, { id: from.id, username: from.username, firstName: from.first_name, createdAt });
      const claim = applyClaimCredit(draft, { id: newLedgerEntryId(), token, userId: String(from.id), createdAt });
      return { claim, balanceRaw: balanceOf(draft, String(from.id)).toString(), sender: draft.users[claim.fromUserId] };
    });
    await reply(
      `🎉 Claimed ${fmt(runtime.config, result.claim.amountRaw)} from ${result.sender ? escapeHtml(displayName(result.sender)) : "a tipper"}!\n` +
        `Your balance: <b>${fmt(runtime.config, result.balanceRaw)}</b>`,
    );
    if (result.sender) {
      await notifyUser(
        runtime,
        result.sender.id,
        `✅ Your tip of ${fmt(runtime.config, result.claim.amountRaw)} to @${escapeHtml(result.claim.toUsername)} was claimed.`,
      );
    }
    return;
  }
  await reply(
    `Welcome! I move ${runtime.config.token.symbol} tips between Telegram users instantly, settling deposits and withdrawals on Base.\n\n${helpText(runtime.config)}`,
  );
}

async function handleBalance(runtime: TipBotRuntime, message: TgMessage, reply: ReplyFn) {
  const from = message.from as TgUser;
  const state = await readTipBotState();
  const balanceRaw = balanceOf(state, String(from.id));
  const openClaims = Object.values(state.claims).filter(
    (claim) => claim.status === "open" && claim.fromUserId === String(from.id),
  );
  const lines = [`💰 Balance: <b>${fmt(runtime.config, balanceRaw)}</b>`];
  if (openClaims.length) {
    lines.push(`⏳ ${openClaims.length} unclaimed tip${openClaims.length > 1 ? "s" : ""} waiting (refunded if they expire).`);
  }
  if (message.chat.type === "private") {
    await reply(lines.join("\n"));
    return;
  }
  // Prefer DMing the number to keep group chats clean — but the user asked,
  // so if Telegram won't let us DM them (they never /start-ed the bot), show
  // it inline rather than turning their question into an errand.
  const dmSent = await runtime.api
    .sendMessage({ chatId: String(from.id), text: lines.join("\n") })
    .then(() => true)
    .catch(() => false);
  if (dmSent) {
    await reply("📬 Sent your balance to your DMs.");
  } else {
    lines.push(`<i>Tap @${escapeHtml(runtime.config.botUsername)} and press Start, and I'll keep this private next time.</i>`);
    await reply(lines.join("\n"));
  }
}

async function handleDeposit(runtime: TipBotRuntime, message: TgMessage, reply: ReplyFn) {
  const from = message.from as TgUser;
  const state = await readTipBotState();
  const user = state.users[String(from.id)];
  if (!user?.linkedWallets.length) {
    await promptForReply(reply, {
      chatId: message.chat.id,
      text:
        "Deposits are credited by matching the sender address, so first I need to know which wallet is yours.\n" +
        "🔗 Reply to this message with your Base wallet address (<code>0x…</code>), then run /deposit again.",
      command: "linkwallet",
      userId: String(from.id),
    });
    return;
  }
  await reply(
    [
      `To top up, send ${runtime.config.token.symbol} <b>on Base</b> from one of your linked wallets to:`,
      `<code>${runtime.config.treasuryAddress}</code>`,
      "",
      `Linked wallets:\n${user.linkedWallets.map((wallet) => `• <code>${wallet}</code>`).join("\n")}`,
      "",
      `⚠️ Only ${runtime.config.token.symbol} on Base, only from a linked wallet — anything else can't be credited automatically.`,
      "I'll DM you once the deposit is confirmed — usually under a minute.",
    ].join("\n"),
  );
}

async function handleLinkWallet(runtime: TipBotRuntime, message: TgMessage, args: string, reply: ReplyFn) {
  const from = message.from as TgUser;
  // Accept the address anywhere in the text — pasted alone, or with words
  // around it. If it's missing, ask for it instead of erroring.
  const address = args.match(/0x[a-fA-F0-9]{40}/)?.[0]?.toLowerCase();
  if (!address) {
    await promptForReply(reply, {
      chatId: message.chat.id,
      text: "🔗 Reply to this message with your Base wallet address — it looks like <code>0x</code> followed by 40 characters.",
      command: "linkwallet",
      userId: String(from.id),
    });
    return;
  }
  const createdAt = new Date().toISOString();
  await mutateTipBotState((draft) => {
    const owner = Object.values(draft.users).find(
      (candidate) => candidate.id !== String(from.id) && candidate.linkedWallets.includes(address),
    );
    if (owner) throw new Error("That wallet is already linked to another user.");
    const user = ensureUser(draft, { id: from.id, username: from.username, firstName: from.first_name, createdAt });
    if (!user.linkedWallets.includes(address)) {
      if (user.linkedWallets.length >= MAX_LINKED_WALLETS) {
        throw new Error(`You can link up to ${MAX_LINKED_WALLETS} wallets.`);
      }
      user.linkedWallets.push(address);
    }
  });
  await reply(`🔗 Linked <code>${address}</code>. Deposits from it are credited automatically — see /deposit.`);
}

async function handleTip(
  runtime: TipBotRuntime,
  message: TgMessage,
  args: string,
  reply: ReplyFn,
  presetTargetUserId?: string,
) {
  const from = message.from as TgUser;
  const config = runtime.config;
  const state = await readTipBotState();
  const tokens = args.split(/\s+/).filter(Boolean).map((token) => token.replace(/[.,!?;:]+$/, ""));
  const amountToken = tokens.find((token) => /^\d/.test(token));
  if (!amountToken) {
    // We know who (reply target) but not how much — ask for the amount.
    const target = presetTargetUserId
      ? state.users[presetTargetUserId]
      : message.reply_to_message?.from && !message.reply_to_message.from.is_bot
        ? message.reply_to_message.from
        : undefined;
    if (target) {
      const name =
        "username" in target && target.username
          ? `@${escapeHtml(target.username)}`
          : escapeHtml(("firstName" in target ? target.firstName : (target as TgUser).first_name) || "them");
      await promptForReply(reply, {
        chatId: message.chat.id,
        text: `How much ${config.token.symbol} for ${name}? Reply to this message with the amount — 100, 5k, 1.5m all work.`,
        command: "tip",
        userId: String(from.id),
        targetUserId: presetTargetUserId ?? String((target as TgUser).id),
      });
      return;
    }
    throw new Error("Reply to someone's message with /tip 100, or use /tip 100 @name.");
  }
  const amountRaw = parseTokenAmount(amountToken, config.token.decimals);
  const chatId = message.chat.type === "private" ? undefined : String(message.chat.id);

  if (state.settings.paused) throw new Error("Tipping is paused right now.");
  const presetUser = presetTargetUserId ? state.users[presetTargetUserId] : undefined;
  const recipient = presetUser ? { kind: "stored" as const, user: presetUser } : resolveTipRecipient(state, message, config.botUsername);
  if (!recipient) throw new Error("Tell me who to tip: reply to their message or use /tip 100 @name.");
  if (recipient.kind === "user" && recipient.user.is_bot) throw new Error("Bots don't need tips.");

  const createdAt = new Date().toISOString();

  if (recipient.kind === "claim") {
    const expiresAt = new Date(Date.now() + config.claimTtlHours * 3_600_000).toISOString();
    const token = newClaimToken();
    await mutateTipBotState((draft) => {
      ensureUser(draft, { id: from.id, username: from.username, firstName: from.first_name, createdAt });
      // Re-check the index inside the transaction in case they registered since.
      const stored = findUserByUsername(draft, recipient.username);
      if (stored) {
        applyTip(draft, {
          id: newLedgerEntryId(),
          fromUserId: String(from.id),
          toUserId: stored.id,
          amountRaw: amountRaw.toString(),
          chatId,
          createdAt,
        });
        return;
      }
      applyClaimEscrow(draft, {
        id: newLedgerEntryId(),
        token,
        fromUserId: String(from.id),
        toUsername: recipient.username,
        amountRaw: amountRaw.toString(),
        chatId,
        createdAt,
        expiresAt,
      });
    });
    const claimUrl = `https://t.me/${config.botUsername}?start=claim_${token}`;
    const days = Math.round(config.claimTtlHours / 24);
    await reply(
      `🍯 ${mentionHtml({ id: String(from.id), username: from.username, firstName: from.first_name })} tipped ` +
        `@${escapeHtml(recipient.username)} ${fmt(config, amountRaw)}!\n` +
        `@${escapeHtml(recipient.username)}: tap below to claim within ${days} day${days === 1 ? "" : "s"} — otherwise it's refunded.`,
      { inlineKeyboard: [[{ text: `🎁 Claim ${fmt(config, amountRaw)}`, url: claimUrl }]] },
    );
    return;
  }

  const toId = recipient.kind === "user" ? String(recipient.user.id) : recipient.user.id;
  const result = await mutateTipBotState((draft) => {
    ensureUser(draft, { id: from.id, username: from.username, firstName: from.first_name, createdAt });
    if (recipient.kind === "user") {
      ensureUser(draft, {
        id: recipient.user.id,
        username: recipient.user.username,
        firstName: recipient.user.first_name,
        createdAt,
      });
    }
    applyTip(draft, {
      id: newLedgerEntryId(),
      fromUserId: String(from.id),
      toUserId: toId,
      amountRaw: amountRaw.toString(),
      chatId,
      createdAt,
    });
    return { toUser: draft.users[toId] };
  });
  await reply(
    `🍯 ${mentionHtml({ id: String(from.id), username: from.username, firstName: from.first_name })} tipped ` +
      `${mentionHtml(result.toUser)} <b>${fmt(config, amountRaw)}</b>`,
  );
}

async function handleWithdraw(runtime: TipBotRuntime, message: TgMessage, args: string, reply: ReplyFn) {
  const from = message.from as TgUser;
  const config = runtime.config;
  if (message.chat.type !== "private") {
    await reply("DM me to withdraw — keeps the group tidy.");
    return;
  }
  const address = args.match(/0x[a-fA-F0-9]{40}/)?.[0];
  const amountToken = args
    .split(/\s+/)
    .filter(Boolean)
    .find((token) => /^\d/.test(token) && !token.startsWith("0x"));
  if (!amountToken || !address) {
    await promptForReply(reply, {
      chatId: message.chat.id,
      text:
        "📤 Reply to this message with the amount and your Base address, like:\n" +
        `<code>1000 0xYourWallet</code>\nAmounts take 5k / 1.5m shorthand too.`,
      command: "withdraw",
      userId: String(from.id),
    });
    return;
  }
  const amountRaw = parseTokenAmount(amountToken, config.token.decimals);
  if (config.maxWithdrawalRaw !== null && amountRaw > config.maxWithdrawalRaw) {
    throw new Error(`Withdrawals are capped at ${fmt(config, config.maxWithdrawalRaw)} per request.`);
  }
  const needsReview = config.reviewThresholdRaw !== null && amountRaw >= config.reviewThresholdRaw;
  const createdAt = new Date().toISOString();
  const withdrawalId = newWithdrawalId();
  await mutateTipBotState((draft) => {
    if (draft.settings.paused) throw new Error("Withdrawals are paused right now.");
    ensureUser(draft, { id: from.id, username: from.username, firstName: from.first_name, createdAt });
    applyWithdrawalRequest(draft, {
      id: withdrawalId,
      entryId: newLedgerEntryId(),
      userId: String(from.id),
      toAddress: address,
      amountRaw: amountRaw.toString(),
      provider: config.withdrawalProvider,
      needsReview,
      createdAt,
    });
  });
  if (needsReview) {
    await reply(
      `🕐 Withdrawal <code>${withdrawalId}</code> for ${fmt(config, amountRaw)} is queued for admin review. ` +
        "You'll get a message when it's sent (or refunded).",
    );
    await notifyAdmins(
      runtime,
      `🔎 Withdrawal review needed: <code>${withdrawalId}</code> — ${fmt(config, amountRaw)} to <code>${address}</code> ` +
        `from ${mentionHtml({ id: String(from.id), username: from.username, firstName: from.first_name })}.\n` +
        `Reply /approve ${withdrawalId} or /reject ${withdrawalId}.`,
    );
  } else {
    await reply(`📤 Withdrawal <code>${withdrawalId}</code> queued: ${fmt(config, amountRaw)} → <code>${address}</code>. I'll DM the tx link.`);
  }
}

async function handleLeaderboard(runtime: TipBotRuntime, message: TgMessage, args: string, reply: ReplyFn) {
  const config = runtime.config;
  const weekly = /\bweek\b/i.test(args) || /\b7d\b/i.test(args);
  const sinceIso = weekly ? new Date(Date.now() - 7 * 24 * 3_600_000).toISOString() : undefined;
  const chatId = message.chat.type === "private" ? undefined : String(message.chat.id);
  const state = await readTipBotState();
  const board = tipLeaderboard(state, { chatId, sinceIso });
  const renderRows = (rows: typeof board.tippers) =>
    rows.slice(0, 5).map((row, index) => {
      const user = state.users[row.userId];
      const name = user ? escapeHtml(displayName(user)) : `user ${row.userId}`;
      const medal = ["🥇", "🥈", "🥉"][index] ?? "🍯";
      return `${medal} ${name} — ${fmt(config, row.totalRaw)} (${row.count} tip${row.count === 1 ? "" : "s"})`;
    });
  if (!board.tippers.length) {
    await reply(`No tips ${weekly ? "this week " : ""}yet — be the first: reply to someone with /tip 1`);
    return;
  }
  const scope = chatId ? "in this chat" : "across all chats";
  const tableRows = (rows: typeof board.tippers): RichTableCell[][] =>
    rows.slice(0, 10).map((row, index) => {
      const user = state.users[row.userId];
      return [
        index < 3 ? richAccent(String(index + 1)) : richMuted(String(index + 1)),
        user ? displayName(user) : `user ${row.userId}`,
        richAccent(fmtCompactValue(config, row.totalRaw)),
        String(row.count),
      ];
    });
  const fallback = [
      `🏆🍯 <b>Top tippers</b> ${scope}${weekly ? " (7 days)" : ""}`,
      ...renderRows(board.tippers),
      "",
      "💝 <b>Top receivers</b>",
      ...renderRows(board.receivers),
    ].join("\n");
  const richHtml = [
    `<p><b>🍯 Top tippers ${escapeHtml(scope)}${weekly ? " (7 days)" : ""}</b></p>`,
    richTable(["#", "User", "HIVE", "Tips"], tableRows(board.tippers)),
    "<p><b>Top receivers</b></p>",
    richTable(["#", "User", "HIVE", "Tips"], tableRows(board.receivers)),
  ].join("");
  const photoPng = await renderCardOrNull({
    title: "🍯 HIVE Leaderboard",
    subtitle: `${scope}${weekly ? " · 7 days" : ""}`,
    sections: [
      { title: "Top tippers", columns: ["#", "User", "HIVE", "Tips"], rows: leaderboardCardRows(config, state, board.tippers) },
      { title: "Top receivers", columns: ["#", "User", "HIVE", "Tips"], rows: leaderboardCardRows(config, state, board.receivers) },
    ],
  });
  await reply(fallback, { richHtml, photoPng });
}

async function handleBounty(runtime: TipBotRuntime, message: TgMessage, args: string, reply: ReplyFn) {
  if (/^create\b/i.test(args)) return handleBountyCreate(runtime, message, args, reply);
  const id = args.split(/\s+/).filter(Boolean)[0];
  if (!id) throw new Error("Usage: /bounty create <title> | reward <amount> | due <date optional>, or /bounty <id>");
  const state = await readTipBotState();
  const bounty = findBounty(state, id);
  if (!bounty) throw new Error(`Unknown bounty: ${id}`);
  const creator = state.users[bounty.creatorUserId];
  const winner = bounty.winnerUserId ? state.users[bounty.winnerUserId] : undefined;
  const submissions = bounty.submissions.slice(-5).map((submission) => {
    const user = state.users[submission.userId];
    return `• ${user ? escapeHtml(displayName(user)) : `user ${submission.userId}`}: ${escapeHtml(submission.text)}`;
  });
  await reply(
    [
      `🎯 <b>Bounty ${escapeHtml(bounty.id)}</b> — ${escapeHtml(bounty.title)}`,
      `Status: <b>${bounty.status}</b> · Pot: <b>${fmt(runtime.config, bountyTotalRaw(bounty))}</b>`,
      `Creator reward: ${fmt(runtime.config, bounty.rewardRaw)} · Boosted: ${fmt(runtime.config, bountyTotalRaw(bounty) - BigInt(bounty.rewardRaw))}`,
      `Creator: ${creator ? escapeHtml(displayName(creator)) : `user ${bounty.creatorUserId}`}`,
      bounty.dueAt ? `Due: ${shortDate(bounty.dueAt)}` : "Due: open",
      winner ? `Winner: ${escapeHtml(displayName(winner))}` : "",
      submissions.length ? `\n<b>Recent submissions</b>\n${submissions.join("\n")}` : "",
      "",
      `Boost with <code>/boost ${escapeHtml(bounty.id)} 25</code> · submit with <code>/submit ${escapeHtml(bounty.id)} &lt;url or note&gt;</code>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function handleBountyCreate(runtime: TipBotRuntime, message: TgMessage, args: string, reply: ReplyFn) {
  const from = message.from as TgUser;
  const createdAt = new Date().toISOString();
  const chatId = message.chat.type === "private" ? undefined : String(message.chat.id);
  const parsed = parseBountyCreateArgs(args, runtime.config.token.decimals);
  const bounty = await mutateTipBotState((draft) => {
    ensureUser(draft, { id: from.id, username: from.username, firstName: from.first_name, createdAt });
    return {
      ...applyBountyCreate(draft, {
        id: newBountyId(),
        entryId: newLedgerEntryId(),
        creatorUserId: String(from.id),
        title: parsed.title,
        rewardRaw: parsed.rewardRaw,
        chatId,
        dueAt: parsed.dueAt,
        createdAt,
      }),
    };
  });
  await reply(
    `🎯 Created bounty <code>${bounty.id}</code>: <b>${escapeHtml(bounty.title)}</b>\n` +
      `Locked reward: <b>${fmt(runtime.config, bounty.rewardRaw)}</b>${bounty.dueAt ? ` · due ${shortDate(bounty.dueAt)}` : ""}\n` +
      `Boost it with <code>/boost ${bounty.id} 25</code>.`,
  );
}

async function handleBounties(runtime: TipBotRuntime, message: TgMessage, reply: ReplyFn) {
  const chatId = message.chat.type === "private" ? undefined : String(message.chat.id);
  const state = await readTipBotState();
  const rows = bountyBoard(state, { chatId });
  if (!rows.length) {
    await reply("No active bounties yet. Start one with <code>/bounty create &lt;title&gt; | reward &lt;amount&gt;</code>.");
    return;
  }
  const fallback = [
    "🎯 <b>Bounties</b>",
    ...rows.slice(0, 12).map((row, index) => {
      const due = row.dueAt ? ` · due ${shortDate(row.dueAt)}` : "";
      return `${index + 1}. <code>${row.id}</code> [${row.status}] ${escapeHtml(row.title)} — ${fmt(runtime.config, row.totalRaw)} (${row.boosterCount} boosters${due})`;
    }),
  ].join("\n");
  const richHtml = [`<p><b>Active bounties</b></p>`, richTable(["#", "ID", "Status", "Title", "Pot", "Boosters", "Due/Subs"], visibleBountyRows(runtime.config, rows))].join("");
  const photoPng = await renderCardOrNull({
    title: "🎯 HIVE Bounties",
    subtitle: chatId ? "This chat" : "All chats",
    sections: [
      {
        title: "Active bounty board",
        columns: ["#", "ID", "Status", "Title", "Pot", "Boosters", "Due/Subs"],
        rows: bountyCardRows(runtime.config, rows),
      },
    ],
  });
  await reply(fallback, { richHtml, photoPng });
}

async function handleBoost(runtime: TipBotRuntime, message: TgMessage, args: string, reply: ReplyFn) {
  const from = message.from as TgUser;
  const parsed = parseIdAndAmount(args, runtime.config.token.decimals, "Usage: /boost <bounty-id> <amount>");
  const createdAt = new Date().toISOString();
  const bounty = await mutateTipBotState((draft) => {
    ensureUser(draft, { id: from.id, username: from.username, firstName: from.first_name, createdAt });
    return {
      ...applyBountyBoost(draft, {
        id: parsed.id,
        entryId: newLedgerEntryId(),
        boostId: newBountyBoostId(),
        userId: String(from.id),
        amountRaw: parsed.amountRaw,
        createdAt,
      }),
    };
  });
  await reply(`🚀 Boosted <code>${bounty.id}</code> by <b>${fmt(runtime.config, parsed.amountRaw)}</b>. Pot: ${fmt(runtime.config, bountyTotalRaw(bounty))}.`);
}

async function handleSubmit(runtime: TipBotRuntime, message: TgMessage, args: string, reply: ReplyFn) {
  const from = message.from as TgUser;
  const [id, ...rest] = args.split(/\s+/).filter(Boolean);
  const text = rest.join(" ");
  if (!id || !text) throw new Error("Usage: /submit <bounty-id> <url or note>");
  const createdAt = new Date().toISOString();
  const bounty = await mutateTipBotState((draft) => {
    ensureUser(draft, { id: from.id, username: from.username, firstName: from.first_name, createdAt });
    return {
      ...applyBountySubmission(draft, {
        id,
        submissionId: newBountySubmissionId(),
        userId: String(from.id),
        text,
        createdAt,
      }),
    };
  });
  const winnerRef = from.username ? `@${escapeHtml(from.username)}` : String(from.id);
  await reply(`📬 Submitted work for <code>${bounty.id}</code>. Admins can accept with <code>/accept ${bounty.id} ${winnerRef}</code>.`);
  await notifyAdmins(
    runtime,
    `📬 Bounty submission: <code>${bounty.id}</code> by ${mentionHtml({ id: String(from.id), username: from.username, firstName: from.first_name })}\n${escapeHtml(text)}`,
  );
}

async function handleAccept(runtime: TipBotRuntime, message: TgMessage, args: string, reply: ReplyFn) {
  const from = message.from as TgUser;
  if (!isAdmin(runtime.config, from)) return;
  const [id, winnerToken] = args.split(/\s+/).filter(Boolean);
  if (!id || !winnerToken) throw new Error("Usage: /accept <bounty-id> @user");
  const updatedAt = new Date().toISOString();
  const result = await mutateTipBotState((draft) => {
    const winner = /^\d+$/.test(winnerToken) ? draft.users[winnerToken] : findUserByUsername(draft, winnerToken);
    if (!winner) throw new Error(`I do not know ${winnerToken}; they need to interact with the bot first.`);
    const existing = findBounty(draft, id);
    const acceptedSubmissionId = existing?.submissions.find((submission) => submission.userId === winner.id)?.id;
    const bounty = applyBountyPayout(draft, {
      id,
      entryId: newLedgerEntryId(),
      winnerUserId: winner.id,
      acceptedSubmissionId,
      updatedAt,
    });
    return { bounty: { ...bounty }, winner: { ...winner }, amountRaw: bountyTotalRaw(bounty).toString() };
  });
  await reply(
    `✅ Paid bounty <code>${result.bounty.id}</code> to ${mentionHtml(result.winner)}: <b>${fmt(runtime.config, result.amountRaw)}</b>.`,
  );
  await notifyUser(
    runtime,
    result.winner.id,
    `✅ You won bounty <code>${result.bounty.id}</code> and received ${fmt(runtime.config, result.amountRaw)} in your internal balance.`,
  );
}

async function handleRefund(runtime: TipBotRuntime, message: TgMessage, args: string, reply: ReplyFn) {
  const from = message.from as TgUser;
  if (!isAdmin(runtime.config, from)) return;
  const [id, mode] = args.split(/\s+/).filter(Boolean);
  if (!id) throw new Error("Usage: /refund <bounty-id> [dispute]");
  const updatedAt = new Date().toISOString();
  const status = mode === "dispute" ? "disputed" : "cancelled";
  const bounty = await mutateTipBotState((draft) => ({
    ...applyBountyRefund(draft, { id, makeEntryId: newLedgerEntryId, status, updatedAt }),
  }));
  await reply(
    status === "disputed"
      ? `⚖️ Marked bounty <code>${bounty.id}</code> disputed. Escrow stays locked for admin resolution.`
      : `↩️ Refunded bounty <code>${bounty.id}</code> to its creator and boosters.`,
  );
}

async function handleBountyStats(runtime: TipBotRuntime, message: TgMessage, reply: ReplyFn) {
  const state = await readTipBotState();
  const rows = Object.values(state.bounties ?? {});
  const locked = rows
    .filter((bounty) => bounty.status !== "paid" && bounty.status !== "cancelled" && bounty.status !== "expired")
    .reduce((total, bounty) => total + bountyTotalRaw(bounty), 0n);
  const byStatus = new Map<string, number>();
  for (const bounty of rows) byStatus.set(bounty.status, (byStatus.get(bounty.status) ?? 0) + 1);
  const statusRows = [...byStatus.entries()].sort(([left], [right]) => left.localeCompare(right));
  const fallback = [
    "📊 <b>Bounty stats</b>",
    `Bounties: ${rows.length} · Locked escrow: <b>${fmt(runtime.config, locked)}</b>`,
    ...statusRows.map(([status, count]) => `• ${status}: ${count}`),
  ].join("\n");
  const richHtml = [
    "<p><b>Bounty stats</b></p>",
    richTable(["Metric", "Value"], [
      ["Total bounties", String(rows.length)],
      ["Locked escrow", richAccent(fmtCompact(runtime.config, locked))],
      ["Total submissions", String(rows.reduce((total, bounty) => total + bounty.submissions.length, 0))],
    ]),
    richTable(["Status", "Count"], statusRows.map(([status, count]) => [status === "active" || status === "submitted" ? richAccent(status) : richBold(status), String(count)])),
  ].join("");
  const photoPng = await renderCardOrNull({
    title: "📊 Bounty Stats",
    subtitle: `${rows.length} total · ${fmtCompact(runtime.config, locked)} locked`,
    sections: [
      {
        title: "Overview",
        columns: ["Metric", "Value"],
        rows: [
          [{ text: "Total bounties" }, { text: String(rows.length), tone: "accent", align: "right" }],
          [{ text: "Locked escrow" }, { text: fmtCompactValue(runtime.config, locked), tone: "accent", align: "right" }],
          [
            { text: "Total submissions" },
            { text: String(rows.reduce((total, bounty) => total + bounty.submissions.length, 0)), align: "right" },
          ],
        ],
      },
      {
        title: "By status",
        columns: ["Status", "Count"],
        rows: statusRows.map(([status, count]) => [
          { text: status, tone: status === "active" || status === "submitted" ? "accent" : "default" },
          { text: String(count), align: "right" },
        ]),
      },
    ],
  });
  await reply(fallback, { richHtml, photoPng });
}

async function handlePauseResume(runtime: TipBotRuntime, message: TgMessage, command: "pause" | "resume", reply: ReplyFn) {
  const from = message.from as TgUser;
  if (!isAdmin(runtime.config, from)) return;
  await mutateTipBotState((draft) => {
    draft.settings.paused = command === "pause";
  });
  await reply(command === "pause" ? "⏸️ Paused tips and withdrawals." : "▶️ Resumed.");
}

async function handleReviewDecision(
  runtime: TipBotRuntime,
  message: TgMessage,
  command: "approve" | "reject",
  args: string,
  reply: ReplyFn,
) {
  const from = message.from as TgUser;
  if (!isAdmin(runtime.config, from)) return;
  const id = args.split(/\s+/)[0];
  if (!id) throw new Error(`Usage: /${command} <withdrawal-id>`);
  const now = new Date().toISOString();
  const withdrawal = await mutateTipBotState((draft) => {
    if (command === "approve") return { ...approveWithdrawal(draft, id, now) };
    const existing = findWithdrawal(draft, id);
    if (!existing) throw new Error(`Unknown withdrawal: ${id}`);
    if (existing.status !== "needs-review" && existing.status !== "pending") {
      throw new Error(`Withdrawal ${id} is ${existing.status} and can no longer be rejected.`);
    }
    return {
      ...resolveWithdrawal(draft, {
        id,
        status: "rejected",
        error: "Rejected by admin.",
        refundEntryId: newLedgerEntryId(),
        updatedAt: now,
      }),
    };
  });
  if (command === "approve") {
    await reply(`✅ Approved <code>${id}</code> — it will send shortly.`);
  } else {
    await reply(`🚫 Rejected <code>${id}</code> — funds returned to the user.`);
    await notifyUser(
      runtime,
      withdrawal.userId,
      `Your withdrawal <code>${id}</code> of ${fmt(runtime.config, withdrawal.amountRaw)} was declined and refunded to your balance.`,
    );
  }
}

async function handleBotStats(runtime: TipBotRuntime, message: TgMessage, reply: ReplyFn) {
  const from = message.from as TgUser;
  if (!isAdmin(runtime.config, from)) return;
  const config = runtime.config;
  const state = await readTipBotState();
  const liabilities = totalLiabilitiesRaw(state);
  const pending = state.withdrawals.filter((w) => w.status === "pending" || w.status === "processing").length;
  const review = state.withdrawals.filter((w) => w.status === "needs-review");
  const openClaims = Object.values(state.claims).filter((claim) => claim.status === "open").length;
  const lines = [
    "📊 <b>Tip bot stats</b>",
    `Users: ${Object.keys(state.users).length} · Tips: ${state.ledger.filter((entry) => entry.kind === "tip").length}`,
    `Owed to users (balances + escrow + queued): <b>${fmt(config, liabilities)}</b>`,
    `Withdrawals: ${pending} queued · ${review.length} awaiting review · Open claims: ${openClaims}`,
    `Mode: ${config.withdrawalProvider === "bankr" ? "Bankr gasless" : "local treasury"} · Paused: ${state.settings.paused ? "yes" : "no"}`,
  ];
  try {
    const treasury = await getTreasuryOverview(config.treasuryAddress);
    const surplus = BigInt(treasury.hiveBalanceRaw) - liabilities;
    lines.push(
      `Treasury <code>${treasury.address}</code>:`,
      `• ${fmt(config, treasury.hiveBalanceRaw)} · ${Number(treasury.ethBalance).toFixed(5)} ETH for gas`,
      surplus >= 0n ? `• Solvent ✅ (+${fmt(config, surplus)})` : `• ⚠️ SHORT ${fmt(config, -surplus)} vs liabilities`,
    );
  } catch (error) {
    lines.push(`Treasury check failed: ${escapeHtml(error instanceof Error ? error.message : String(error))}`);
  }
  for (const item of review.slice(0, 5)) {
    lines.push(`· review <code>${item.id}</code>: ${fmt(config, item.amountRaw)} → <code>${item.toAddress}</code>`);
  }
  await reply(lines.join("\n"));
}

export function withdrawalSentMessage(config: TipBotConfig, amountRaw: string, txHash: string): string {
  return `✅ Withdrawal sent: ${fmt(config, amountRaw)}\n<a href="${explorerTxUrl(txHash)}">View on BaseScan</a>`;
}

export function depositCreditedMessage(config: TipBotConfig, amountRaw: string, txHash: string): string {
  return `💰 Deposit credited: ${fmt(config, amountRaw)}\n<a href="${explorerTxUrl(txHash)}">View on BaseScan</a>`;
}
