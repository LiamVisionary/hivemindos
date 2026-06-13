import "server-only";

import { formatTokenAmount, parseTokenAmount } from "./amounts";
import { explorerTxUrl, getTreasuryOverview } from "./hive-chain";
import {
  applyClaimCredit,
  applyClaimEscrow,
  applyTip,
  applyWithdrawalRequest,
  approveWithdrawal,
  balanceOf,
  ensureUser,
  findUserByUsername,
  findWithdrawal,
  resolveWithdrawal,
  tipLeaderboard,
  totalLiabilitiesRaw,
  type TipBotState,
  type TipBotUser,
} from "./ledger";
import { parseCommand, resolveTipRecipient, type ParsedCommand } from "./parse";
import { mutateTipBotState, newClaimToken, newLedgerEntryId, newWithdrawalId, readTipBotState } from "./store";
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
};

export type TipBotRuntime = {
  api: TelegramBotApi;
  config: TipBotConfig;
};

const MAX_LINKED_WALLETS = 5;

function fmt(config: TipBotConfig, amountRaw: bigint | string): string {
  return `${formatTokenAmount(amountRaw, config.token.decimals)} ${config.token.symbol}`;
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
  const stale = seen.some((user) => {
    const existing = state.users[String(user.id)];
    return (
      !existing ||
      (user.username && existing.username?.toLowerCase() !== user.username.toLowerCase()) ||
      (user.first_name && existing.firstName !== user.first_name)
    );
  });
  if (!stale) return;
  const createdAt = new Date().toISOString();
  await mutateTipBotState((draft) => {
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

export async function handleTipBotUpdate(runtime: TipBotRuntime, update: TgUpdate) {
  const message = update.message;
  if (!message?.from || message.from.is_bot || !message.text) return;

  const state = await readTipBotState();
  await registerSeenUsers(state, message);

  const parsed = parseCommand(message.text, runtime.config.botUsername) ?? consumePromptReply(message);
  if (!parsed) return;

  const reply: ReplyFn = (text, extra) =>
    runtime.api.sendMessage({
      chatId: message.chat.id,
      text,
      replyToMessageId: message.message_id,
      inlineKeyboard: extra?.inlineKeyboard,
      forceReply: extra?.forceReply,
    });

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

type ReplyExtra = { inlineKeyboard?: Array<Array<{ text: string; url: string }>>; forceReply?: boolean };
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
  await reply(
    [
      `🏆 <b>Top tippers</b> ${scope}${weekly ? " (7 days)" : ""}`,
      ...renderRows(board.tippers),
      "",
      "💝 <b>Top receivers</b>",
      ...renderRows(board.receivers),
    ].join("\n"),
  );
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
