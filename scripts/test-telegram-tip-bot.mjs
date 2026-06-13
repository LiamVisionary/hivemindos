// Unit tests for the Telegram $HIVE tip bot ledger math: tips, claim links,
// deposit idempotency, withdrawal refunds, and leaderboards.
// Run: node --test scripts/test-telegram-tip-bot.mjs (Node >= 23 strips the
// TypeScript types from the imported modules natively).
import assert from "node:assert/strict";
import test from "node:test";

import { formatTokenAmount, parseTokenAmount } from "../src/lib/services/telegram-tip-bot/amounts.ts";
import { parseCommand, resolveTipRecipient } from "../src/lib/services/telegram-tip-bot/parse.ts";
import {
  applyClaimCredit,
  applyClaimEscrow,
  applyDepositCredit,
  applyTip,
  applyWithdrawalRequest,
  approveWithdrawal,
  balanceOf,
  claimNextWithdrawal,
  emptyTipBotState,
  ensureUser,
  expireClaims,
  findUserByUsername,
  resolveWithdrawal,
  tipLeaderboard,
  totalLiabilitiesRaw,
} from "../src/lib/services/telegram-tip-bot/ledger.ts";

const T0 = "2026-06-12T00:00:00.000Z";
const T1 = "2026-06-12T01:00:00.000Z";
let nextId = 0;
const id = () => `entry-${nextId++}`;

function seededState() {
  const state = emptyTipBotState();
  ensureUser(state, { id: 1, username: "alice", firstName: "Alice", createdAt: T0 });
  ensureUser(state, { id: 2, username: "bob", firstName: "Bob", createdAt: T0 });
  state.balances["1"] = parseTokenAmount("100", 18).toString();
  return state;
}

function groupMessage(text, extra = {}) {
  return { message_id: 1, chat: { id: -100, type: "supergroup" }, from: { id: 9, username: "tipper" }, text, ...extra };
}

test("parseCommand finds /tip mid-message but anchors other commands", () => {
  assert.deepEqual(parseCommand("/tip 100 @bob", "thebot"), { command: "tip", args: "100 @bob" });
  assert.deepEqual(parseCommand("thanks a lot, /tip 5m", "thebot"), { command: "tip", args: "5m" });
  // The reported bug: mention before /tip — parseCommand keeps only post-/tip args.
  assert.deepEqual(parseCommand("reported a bug so @bob /tip 5m", "thebot"), { command: "tip", args: "5m" });
  assert.equal(parseCommand("please check my /balance now", "thebot"), null); // only /tip is lenient
  assert.equal(parseCommand("/tip@otherbot 5", "thebot"), null); // addressed to a different bot
});

test("resolveTipRecipient: mention anywhere in the sentence, not just after /tip", () => {
  const state = seededState();
  // The exact failing message — @bob sits BEFORE /tip.
  const recipient = resolveTipRecipient(state, groupMessage("reported a bug so @bob /tip 5m"), "thebot");
  assert.deepEqual(recipient, { kind: "stored", user: state.users["2"] });
});

test("resolveTipRecipient: unknown @username becomes a claim, trailing punctuation stripped", () => {
  const state = seededState();
  assert.deepEqual(resolveTipRecipient(state, groupMessage("/tip 5 @carol!"), "thebot"), { kind: "claim", username: "carol" });
});

test("resolveTipRecipient: text_mention entity (no public username) resolves to the user", () => {
  const state = seededState();
  const msg = groupMessage("/tip 5 Carol", {
    entities: [{ type: "text_mention", offset: 8, length: 5, user: { id: 3, first_name: "Carol" } }],
  });
  assert.deepEqual(resolveTipRecipient(state, msg, "thebot"), { kind: "user", user: { id: 3, first_name: "Carol" } });
});

test("resolveTipRecipient: ignores a mention of the bot itself, falls back to reply target", () => {
  const state = seededState();
  const msg = groupMessage("/tip@thebot 5", { reply_to_message: { message_id: 7, from: { id: 2, username: "bob" } } });
  assert.deepEqual(resolveTipRecipient(state, msg, "thebot"), { kind: "user", user: { id: 2, username: "bob" } });
});

test("resolveTipRecipient: no target at all returns null", () => {
  assert.equal(resolveTipRecipient(seededState(), groupMessage("/tip 5"), "thebot"), null);
});

test("parseTokenAmount handles decimals and rejects junk", () => {
  assert.equal(parseTokenAmount("10", 18), 10n * 10n ** 18n);
  assert.equal(parseTokenAmount("2.5", 18), 25n * 10n ** 17n);
  assert.equal(parseTokenAmount("1", 0), 1n);
  assert.equal(parseTokenAmount("1,000", 18), 1000n * 10n ** 18n);
  assert.equal(parseTokenAmount("12,345.67", 18), parseTokenAmount("12345.67", 18));
  assert.throws(() => parseTokenAmount("1,5", 18), /ambiguous/);
  assert.throws(() => parseTokenAmount("1,00", 18), /ambiguous/);
  assert.throws(() => parseTokenAmount("12,34,567", 18), /ambiguous/);
  assert.equal(parseTokenAmount("5k", 18), 5000n * 10n ** 18n);
  assert.equal(parseTokenAmount("1.5K", 18), 1500n * 10n ** 18n);
  assert.equal(parseTokenAmount("2.5m", 18), 2_500_000n * 10n ** 18n);
  assert.equal(parseTokenAmount("0.5k", 18), 500n * 10n ** 18n);
  assert.equal(parseTokenAmount("100k", 18), parseTokenAmount("100,000", 18));
  assert.equal(parseTokenAmount("0.0005m", 18), 500n * 10n ** 18n);
  assert.equal(parseTokenAmount("1.2345k", 18), 12345n * 10n ** 17n);
  assert.throws(() => parseTokenAmount("k", 18), /not a valid amount/);
  assert.throws(() => parseTokenAmount("5kk", 18), /not a valid amount/);
  assert.throws(() => parseTokenAmount("1,5k", 18), /ambiguous/);
  assert.throws(() => parseTokenAmount("0.0001k", 0), /decimal places/);
  assert.throws(() => parseTokenAmount("0", 18), /greater than zero/);
  assert.throws(() => parseTokenAmount("-5", 18), /not a valid amount/);
  assert.throws(() => parseTokenAmount("1.5", 0), /decimal places/);
  assert.throws(() => parseTokenAmount("1e18", 18), /not a valid amount/);
  assert.throws(() => parseTokenAmount("ten", 18), /not a valid amount/);
});

test("formatTokenAmount round-trips and trims zeros", () => {
  assert.equal(formatTokenAmount(parseTokenAmount("2.5", 18), 18), "2.5");
  assert.equal(formatTokenAmount("1000000000000000000", 18), "1");
  assert.equal(formatTokenAmount("1", 18), "0.000000000000000001");
  assert.equal(formatTokenAmount("0", 18), "0");
});

test("tip moves balance atomically and records ledger entry", () => {
  const state = seededState();
  applyTip(state, { id: id(), fromUserId: "1", toUserId: "2", amountRaw: parseTokenAmount("40", 18).toString(), chatId: "-100", createdAt: T0 });
  assert.equal(formatTokenAmount(balanceOf(state, "1"), 18), "60");
  assert.equal(formatTokenAmount(balanceOf(state, "2"), 18), "40");
  assert.equal(state.ledger.length, 1);
  assert.equal(state.ledger[0].kind, "tip");
});

test("insufficient tip throws and leaves state untouched", () => {
  const state = seededState();
  assert.throws(
    () => applyTip(state, { id: id(), fromUserId: "2", toUserId: "1", amountRaw: "1", createdAt: T0 }),
    /Insufficient balance/,
  );
  assert.equal(balanceOf(state, "2"), 0n);
  assert.equal(formatTokenAmount(balanceOf(state, "1"), 18), "100");
  assert.equal(state.ledger.length, 0);
});

test("self-tips are rejected", () => {
  const state = seededState();
  assert.throws(() => applyTip(state, { id: id(), fromUserId: "1", toUserId: "1", amountRaw: "1", createdAt: T0 }), /yourself/);
});

test("claim escrow → credit pays the claimer and marks claim", () => {
  const state = seededState();
  const amount = parseTokenAmount("10", 18).toString();
  applyClaimEscrow(state, { id: id(), token: "tok1", fromUserId: "1", toUsername: "carol", amountRaw: amount, createdAt: T0, expiresAt: "2099-01-01T00:00:00.000Z" });
  assert.equal(formatTokenAmount(balanceOf(state, "1"), 18), "90");
  ensureUser(state, { id: 3, username: "carol", createdAt: T1 });
  applyClaimCredit(state, { id: id(), token: "tok1", userId: "3", createdAt: T1 });
  assert.equal(formatTokenAmount(balanceOf(state, "3"), 18), "10");
  assert.equal(state.claims.tok1.status, "claimed");
  assert.throws(() => applyClaimCredit(state, { id: id(), token: "tok1", userId: "3", createdAt: T1 }), /no longer valid/);
});

test("sender cannot claim their own escrow; expiry refunds sender", () => {
  const state = seededState();
  applyClaimEscrow(state, { id: id(), token: "tok2", fromUserId: "1", toUsername: "carol", amountRaw: parseTokenAmount("10", 18).toString(), createdAt: T0, expiresAt: T1 });
  assert.throws(() => applyClaimCredit(state, { id: id(), token: "tok2", userId: "1", createdAt: T0 }), /your own tip/);
  const refunded = expireClaims(state, { now: T1, makeEntryId: id });
  assert.equal(refunded.length, 1);
  assert.equal(state.claims.tok2.status, "refunded");
  assert.equal(formatTokenAmount(balanceOf(state, "1"), 18), "100");
});

test("expired claims reject credit attempts", () => {
  const state = seededState();
  applyClaimEscrow(state, { id: id(), token: "tok3", fromUserId: "1", toUsername: "dave", amountRaw: "5", createdAt: T0, expiresAt: T0 });
  ensureUser(state, { id: 4, username: "dave", createdAt: T1 });
  assert.throws(() => applyClaimCredit(state, { id: id(), token: "tok3", userId: "4", createdAt: T1 }), /expired/);
});

test("deposit credit is idempotent on txHash:logIndex", () => {
  const state = seededState();
  const deposit = { id: id(), txHash: "0xABC", logIndex: 3, fromAddress: "0xWallet", userId: "2", amountRaw: "777", blockNumber: "100", createdAt: T0 };
  assert.ok(applyDepositCredit(state, deposit));
  assert.equal(applyDepositCredit(state, { ...deposit, id: id() }), null);
  assert.equal(balanceOf(state, "2"), 777n);
  assert.equal(state.ledger.filter((entry) => entry.kind === "deposit").length, 1);
});

test("withdrawal lifecycle: request debits, failure refunds", () => {
  const state = seededState();
  const amount = parseTokenAmount("30", 18).toString();
  applyWithdrawalRequest(state, { id: "w1", entryId: id(), userId: "1", toAddress: "0x" + "1".repeat(40), amountRaw: amount, provider: "treasury", needsReview: false, createdAt: T0 });
  assert.equal(formatTokenAmount(balanceOf(state, "1"), 18), "70");
  const job = claimNextWithdrawal(state, T0);
  assert.equal(job.id, "w1");
  assert.equal(job.attempts, 1);
  assert.equal(claimNextWithdrawal(state, T0), null);
  resolveWithdrawal(state, { id: "w1", status: "failed", error: "boom", refundEntryId: id(), updatedAt: T1 });
  assert.equal(formatTokenAmount(balanceOf(state, "1"), 18), "100");
  assert.equal(state.withdrawals[0].status, "failed");
});

test("needs-review withdrawals wait for approval before processing", () => {
  const state = seededState();
  applyWithdrawalRequest(state, { id: "w2", entryId: id(), userId: "1", toAddress: "0x" + "2".repeat(40), amountRaw: "5", provider: "bankr", needsReview: true, createdAt: T0 });
  assert.equal(claimNextWithdrawal(state, T0), null);
  approveWithdrawal(state, "w2", T1);
  assert.equal(claimNextWithdrawal(state, T1).id, "w2");
});

test("rejected withdrawal refunds the user", () => {
  const state = seededState();
  applyWithdrawalRequest(state, { id: "w3", entryId: id(), userId: "1", toAddress: "0x" + "3".repeat(40), amountRaw: parseTokenAmount("100", 18).toString(), provider: "treasury", needsReview: true, createdAt: T0 });
  assert.equal(balanceOf(state, "1"), 0n);
  resolveWithdrawal(state, { id: "w3", status: "rejected", refundEntryId: id(), updatedAt: T1 });
  assert.equal(formatTokenAmount(balanceOf(state, "1"), 18), "100");
});

test("leaderboard aggregates per chat and time window", () => {
  const state = seededState();
  state.balances["2"] = parseTokenAmount("50", 18).toString();
  applyTip(state, { id: id(), fromUserId: "1", toUserId: "2", amountRaw: "3", chatId: "-100", createdAt: T0 });
  applyTip(state, { id: id(), fromUserId: "1", toUserId: "2", amountRaw: "4", chatId: "-100", createdAt: T1 });
  applyTip(state, { id: id(), fromUserId: "2", toUserId: "1", amountRaw: "10", chatId: "-200", createdAt: T1 });
  const chatBoard = tipLeaderboard(state, { chatId: "-100" });
  assert.deepEqual(chatBoard.tippers.map((row) => [row.userId, row.totalRaw, row.count]), [["1", "7", 2]]);
  const windowed = tipLeaderboard(state, { chatId: "-100", sinceIso: T1 });
  assert.deepEqual(windowed.tippers.map((row) => row.totalRaw), ["4"]);
  const global = tipLeaderboard(state);
  assert.equal(global.tippers[0].userId, "2"); // 10 > 7
});

test("unclaimed escrow counts toward tipper leaderboard but not receiver", () => {
  const state = seededState();
  applyClaimEscrow(state, { id: id(), token: "tok4", fromUserId: "1", toUsername: "eve", amountRaw: "9", chatId: "-100", createdAt: T0, expiresAt: "2099-01-01T00:00:00.000Z" });
  const board = tipLeaderboard(state, { chatId: "-100" });
  assert.equal(board.tippers[0].totalRaw, "9");
  assert.equal(board.receivers.length, 0);
});

test("username index follows renames", () => {
  const state = seededState();
  ensureUser(state, { id: 1, username: "alice_renamed", createdAt: T1 });
  assert.equal(findUserByUsername(state, "@alice"), null);
  assert.equal(findUserByUsername(state, "ALICE_RENAMED").id, "1");
});

test("liabilities include balances, open claims, and queued withdrawals", () => {
  const state = seededState();
  applyClaimEscrow(state, { id: id(), token: "tok5", fromUserId: "1", toUsername: "f", amountRaw: "10", createdAt: T0, expiresAt: "2099-01-01T00:00:00.000Z" });
  applyWithdrawalRequest(state, { id: "w4", entryId: id(), userId: "1", toAddress: "0x" + "4".repeat(40), amountRaw: "20", provider: "treasury", needsReview: false, createdAt: T0 });
  // 100 HIVE seeded: balance (100e18 - 30) + claim 10 + withdrawal 20 = 100e18
  assert.equal(totalLiabilitiesRaw(state), parseTokenAmount("100", 18));
  resolveWithdrawal(state, { id: "w4", status: "sent", txHash: "0x1", updatedAt: T1 });
  assert.equal(totalLiabilitiesRaw(state), parseTokenAmount("100", 18) - 20n);
});
