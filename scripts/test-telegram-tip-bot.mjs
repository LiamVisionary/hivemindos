// Unit tests for the Telegram $HIVE tip bot ledger math: tips, claim links,
// deposit idempotency, withdrawal refunds, and leaderboards.
// Run: node --test scripts/test-telegram-tip-bot.mjs (Node >= 23 strips the
// TypeScript types from the imported modules natively).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { formatCompactTokenAmount, formatTokenAmount, parseTokenAmount } from "../src/lib/services/telegram-tip-bot/amounts.ts";
import { parseCommand, resolveTipRecipient } from "../src/lib/services/telegram-tip-bot/parse.ts";
import {
  isHoneyMissionId,
  isHoneySubmissionId,
  parseCommunityMissionCreateArgs,
  telegramPublicLabel,
} from "../src/lib/services/telegram-tip-bot/community-honey-logic.ts";
import {
  HONEY_RECOGNITION_REACTION_EMOJI,
  HoneyReactionMessageIndex,
  HONEY_PEER_DAILY_GIVER_LIMIT,
  HONEY_PEER_DAILY_RECIPIENT_LIMIT,
  HONEY_PEER_TIP_AMOUNT,
  honeyRecognitionReactionWasAdded,
  legacyHoneyMicroFromHiveRaw,
  parseHoneyCommandArgs,
} from "../src/lib/services/telegram-tip-bot/honey-recognition.ts";
import {
  appendHoneyRecognitionAudit,
  completeHoneyRecognitionAudit,
  emptyHoneyAuditState,
  honeyAuditDetail,
  honeyRecognitionAuditId,
  listHoneyRecognitionAudit,
} from "../src/lib/services/telegram-tip-bot/honey-audit-state.ts";
import { CLAW_LIGHT_RICH_THEME, richAccent, richCode, richMuted, richTable } from "../src/lib/services/telegram-tip-bot/rich-formatting.ts";
import {
  bountyPayoutLeaderboard,
  knownMemberTagChatIds,
  memberTagSinceIso,
  planMemberTagSync,
  recordMemberTagSync,
  resolveMemberTag,
} from "../src/lib/services/telegram-tip-bot/member-tags.ts";
import {
  classifyModerationMessage,
  extractModerationDomains,
  moderationActionFor,
  normalizeModerationText,
  parseModerationCommand,
} from "../src/lib/services/telegram-tip-bot/moderation-rules.ts";
import { ModerationActivityTracker } from "../src/lib/services/telegram-tip-bot/moderation-activity.ts";
import {
  addModerationStrike,
  appendModerationAudit,
  emptyModerationState,
  isModerationTrusted,
  moderationStats,
  recordModerationJoin,
  recordModerationMemberMessage,
  resolveModerationMode,
  setModerationMode,
  setModerationTrust,
} from "../src/lib/services/telegram-tip-bot/moderation-state.ts";
import {
  applyBountyBoost,
  applyBountyCreate,
  applyBountyPayout,
  applyBountyRefund,
  applyBountySubmission,
  applyClaimCredit,
  applyClaimEscrow,
  applyDepositCredit,
  applyTip,
  applyWithdrawalRequest,
  approveWithdrawal,
  balanceOf,
  bountyBoard,
  claimNextWithdrawal,
  emptyTipBotState,
  ensureUser,
  expireBounties,
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
  assert.deepEqual(parseCommand("  /honey @bob Documented the full setup path  ", "thebot"), {
    command: "honey",
    args: "@bob Documented the full setup path",
  });
  assert.deepEqual(parseCommand("thanks a lot, /tip 5m", "thebot"), { command: "tip", args: "5m" });
  // The reported bug: mention before /tip — parseCommand keeps only post-/tip args.
  assert.deepEqual(parseCommand("reported a bug so @bob /tip 5m", "thebot"), { command: "tip", args: "5m" });
  assert.equal(parseCommand("please check my /balance now", "thebot"), null); // only /tip is lenient
  assert.equal(parseCommand("/tip@otherbot 5", "thebot"), null); // addressed to a different bot
});

test("community HONEY mission syntax is strict and routes IDs without colliding with HIVE bounties", () => {
  assert.deepEqual(
    parseCommunityMissionCreateArgs("create Improve onboarding | reward 12.5 | category docs | evidence github_pr | repo LiamVisionary/hivemindos | due 2026-08-01 | approvals 2 | description Document the full path"),
    {
      title: "Improve onboarding",
      description: "Document the full path",
      rewardHoney: 12.5,
      category: "docs",
      evidenceType: "github_pr",
      githubRepo: "liamvisionary/hivemindos",
      dueAt: "2026-08-01",
      requiredApprovals: 2,
    },
  );
  assert.equal(isHoneyMissionId("hm_a1b2c3d4"), true);
  assert.equal(isHoneyMissionId("b_a1b2c3d4"), false);
  assert.equal(isHoneySubmissionId("hs_a1b2c3d4e5"), true);
  assert.equal(isHoneySubmissionId("wd_a1b2c3d4e5"), false);
  assert.throws(() => parseCommunityMissionCreateArgs("create Chat more | reward 5 | category chat-volume | evidence note"), /Unsupported/);
});

test("community HONEY public labels prefer Telegram usernames and sanitize names", () => {
  assert.equal(telegramPublicLabel({ id: 1, username: "builder" }), "@builder");
  assert.equal(telegramPublicLabel({ id: 2, first_name: "<Bee>\nTwo" }), "Bee Two");
});

test("one HONEY uses fixed awards, three recognitions per giver, and reason-first syntax", () => {
  assert.equal(HONEY_PEER_TIP_AMOUNT, 1);
  assert.equal(HONEY_PEER_DAILY_GIVER_LIMIT, 3);
  assert.equal(HONEY_PEER_DAILY_RECIPIENT_LIMIT, 5);
  assert.deepEqual(parseHoneyCommandArgs(""), { kind: "profile" });
  assert.deepEqual(parseHoneyCommandArgs("balance"), { kind: "profile" });
  assert.deepEqual(parseHoneyCommandArgs("@builder Documented the complete setup path"), {
    kind: "give",
    reason: "Documented the complete setup path",
  });
  assert.deepEqual(parseHoneyCommandArgs("Reviewed the release checklist"), {
    kind: "give",
    reason: "Reviewed the release checklist",
  });
  assert.throws(() => parseHoneyCommandArgs("5 @builder great work"), /fixed at 1 HONEY/i);
  assert.throws(() => parseHoneyCommandArgs("@builder thanks"), /at least 8 characters/i);
});

test("the built-in trophy reaction is an explicit recognition action", () => {
  assert.equal(HONEY_RECOGNITION_REACTION_EMOJI, "🏆");
  assert.equal(honeyRecognitionReactionWasAdded({
    old_reaction: [],
    new_reaction: [{ type: "emoji", emoji: "🏆" }],
  }), true);
  assert.equal(honeyRecognitionReactionWasAdded({
    old_reaction: [{ type: "emoji", emoji: "🏆" }],
    new_reaction: [{ type: "emoji", emoji: "🏆" }, { type: "emoji", emoji: "👏" }],
  }), false);
  assert.equal(honeyRecognitionReactionWasAdded({
    old_reaction: [{ type: "emoji", emoji: "🏆" }],
    new_reaction: [],
  }), false);
  assert.equal(honeyRecognitionReactionWasAdded({
    old_reaction: [],
    new_reaction: [{ type: "emoji", emoji: "👏" }],
  }), false);
});

test("HONEY recognition audit tracks terminal outcomes without retaining message text", () => {
  const state = emptyHoneyAuditState();
  const id = honeyRecognitionAuditId("command", 1234);
  appendHoneyRecognitionAudit(state, {
    id,
    source: "command",
    updateId: 1234,
    chatId: "group",
    messageId: 99,
    giverUserId: "giver",
    recipientUserId: "recipient",
    outcome: "received",
    createdAt: T0,
    updatedAt: T0,
  });
  completeHoneyRecognitionAudit(state, id, {
    outcome: "recorded",
    recognitionsRemainingToday: 2,
    dailyRecognitionLimit: 3,
    detail: "The hosted ledger recorded the recognition.",
  });
  assert.deepEqual(listHoneyRecognitionAudit(state, { chatId: "group", userId: "giver" }).map((entry) => entry.outcome), ["recorded"]);
  assert.equal(listHoneyRecognitionAudit(state, { chatId: "other" }).length, 0);
  assert.equal("text" in state.entries[0], false);
  assert.equal("reason" in state.entries[0], false);
  assert.equal(honeyAuditDetail(new Error(`failed\n${"x".repeat(300)}`)).length, 240);

  for (let updateId = 2_000; updateId <= 4_005; updateId += 1) {
    appendHoneyRecognitionAudit(state, {
      ...state.entries[0],
      id: honeyRecognitionAuditId("reaction", updateId),
      source: "reaction",
      updateId,
    });
  }
  assert.equal(state.entries.length, 2_000);
  assert.equal(state.entries.at(-1)?.updateId, 4_005);
});

test("reaction targets are bounded to recent human-authored group messages", () => {
  const index = new HoneyReactionMessageIndex({ ttlMs: 1_000, maxEntries: 2 });
  const alice = { id: 101, username: "alice" };
  const bob = { id: 102, username: "bob" };
  const group = { id: -1001, type: "supergroup" };

  index.remember({ message_id: 1, chat: group, from: alice }, 1_000);
  assert.equal(index.resolve(group.id, 1, 1_999)?.id, alice.id);
  assert.equal(index.resolve(group.id, 1, 2_001), null);

  index.remember({ message_id: 2, chat: group, from: alice }, 3_000);
  index.remember({ message_id: 3, chat: group, from: bob }, 3_001);
  index.remember({ message_id: 4, chat: group, from: alice }, 3_002);
  assert.equal(index.resolve(group.id, 2, 3_002), null);
  assert.equal(index.resolve(group.id, 3, 3_002)?.id, bob.id);
  assert.equal(index.resolve(group.id, 4, 3_002)?.id, alice.id);

  index.remember({ message_id: 5, chat: { id: 5, type: "private" }, from: bob }, 3_003);
  index.remember({ message_id: 6, chat: group, from: { id: 999, is_bot: true } }, 3_004);
  assert.equal(index.resolve(5, 5, 3_004), null);
  assert.equal(index.resolve(group.id, 6, 3_004), null);
});

test("Telegram polling and bot handling wire message reactions into the existing HONEY endpoint", () => {
  const api = readFileSync(new URL("../src/lib/services/telegram-tip-bot/telegram-api.ts", import.meta.url), "utf8");
  const commands = readFileSync(new URL("../src/lib/services/telegram-tip-bot/commands.ts", import.meta.url), "utf8");
  const reactionHandler = readFileSync(new URL("../src/lib/services/telegram-tip-bot/honey-reaction-handler.ts", import.meta.url), "utf8");
  assert.match(api, /allowed_updates[^\n]+message_reaction/);
  assert.match(commands, /handleHoneyReaction/);
  assert.match(reactionHandler, /givePeerHoney/);
  assert.match(reactionHandler, /HONEY_REACTION_REASON/);
  // The bot must never place reactions itself: Telegram animates every
  // reaction placement, so a bot-seeded 🏆 plays the award animation on every
  // comment. The trophy may only ever come from a member's own reaction.
  assert.doesNotMatch(api, /setMessageReaction/);
  assert.doesNotMatch(commands, /seedHoneyRecognitionReaction/);
  assert.doesNotMatch(commands, /clearHoneyRecognitionReactionSeed/);
});

test("HONEY attempts have durable admin receipts and explicit per-giver quota copy", () => {
  const commands = readFileSync(new URL("../src/lib/services/telegram-tip-bot/commands.ts", import.meta.url), "utf8");
  const reactionHandler = readFileSync(new URL("../src/lib/services/telegram-tip-bot/honey-reaction-handler.ts", import.meta.url), "utf8");
  const auditStore = readFileSync(new URL("../src/lib/services/telegram-tip-bot/honey-audit-store.ts", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../src/lib/services/telegram-tip-bot/runner.ts", import.meta.url), "utf8");
  assert.match(commands, /case "honeyaudit"/);
  assert.match(commands, /HONEY recognition audit/);
  assert.match(commands, /rejected-reply-failed/);
  assert.match(commands, /Telegram command failed and its error reply was not delivered/);
  assert.match(reactionHandler, /Quota for .*recognitions left this UTC day/);
  assert.match(reactionHandler, /recorded-reply-failed/);
  assert.match(auditStore, /telegram-tip-bot-honey-audit\.json/);
  assert.match(runner, /command: "honeyaudit"/);
});

test("legacy HIVE receiver values convert to micro-HONEY at 1 HONEY per 1,000,000 HIVE", () => {
  const hiveRaw = 1_500_000n * 10n ** 18n;
  assert.equal(legacyHoneyMicroFromHiveRaw(hiveRaw.toString(), 18), 1_500_000n);
  assert.equal(Number(legacyHoneyMicroFromHiveRaw(hiveRaw.toString(), 18)) / 1_000_000, 1.5);
});

test("community HONEY wiring keeps identity linking server-side and uses the canonical API envelope", () => {
  const commands = readFileSync(new URL("../src/lib/services/telegram-tip-bot/commands.ts", import.meta.url), "utf8");
  const botReadme = readFileSync(new URL("../src/lib/services/telegram-tip-bot/README.md", import.meta.url), "utf8");
  const userDocs = readFileSync(new URL("../docs/for-users/features/wallets-honey-and-x402.md", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/honey-community/route.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/lib/services/wallet/honey-community.ts", import.meta.url), "utf8");
  const botClient = readFileSync(new URL("../src/lib/services/telegram-tip-bot/community-honey.ts", import.meta.url), "utf8");
  assert.match(commands, /An independent admin review is required/);
  assert.match(commands, /ordinary reactions, and spam do not earn HONEY/);
  assert.match(botReadme, /bot must never place the 🏆 reaction itself/i);
  assert.match(userDocs, /bot never places the trophy itself/i);
  assert.match(userDocs, /bot must be a group administrator/i);
  // Link-free recognition: HONEY banks to the Telegram identity and transfers
  // to the workspace on /linkhoney — no link requirement may come back.
  assert.match(botReadme, /No HivemindOS link is required on either side/i);
  assert.match(userDocs, /No HivemindOS connection is needed to give or receive/i);
  assert.match(commands, /recipientLinked === false/);
  assert.match(commands, /Banked to their Telegram account/);
  // Tap-to-link: /start link_<intent> must redeem through the gateway.
  assert.match(commands, /args\.startsWith\("link_"\)/);
  assert.match(commands, /redeemLinkIntent/);
  assert.doesNotMatch(commands, /must run \/linkhoney before/i);
  assert.doesNotMatch(botReadme, /wait seven days/i);
  assert.doesNotMatch(userDocs, /wait seven days/i);
  assert.match(commands, /givePeerHoney/);
  assert.match(commands, /recognitions left today/i);
  assert.match(botClient, /recognitionAllowance/);
  assert.doesNotMatch(commands, /recognition actions/i);
  assert.match(commands, /Every HONEY counts toward the same lifetime total and benefit tier/i);
  assert.doesNotMatch(commands, /peer HONEY left today/i);
  assert.match(botClient, /allHoneyCountsTowardBenefits: true/);
  assert.match(route, /okJson\(/);
  assert.match(route, /errorJson\(/);
  assert.match(service, /getHoneyWorkspaceId\(\)/);
  assert.match(service, /\/community\/link/);
  assert.doesNotMatch(service, /HONEY_COMMUNITY_BOT_TOKEN/);
});

test("legacy HIVE-tip seed tooling is dry-run by default and reuses the canonical leaderboard reducer", () => {
  const script = readFileSync(new URL("./seed-honey-leaderboard-from-hive-tips.mjs", import.meta.url), "utf8");
  assert.match(script, /tipLeaderboard\(/);
  assert.match(script, /HONEY_LEGACY_TIP_SEED_VERSION/);
  assert.match(script, /process\.argv\.includes\("--apply"\)/);
  assert.match(script, /TELEGRAM_TIP_BOT_CLOUDFLARE_API_TOKEN/);
  assert.match(script, /HONEY_COMMUNITY_MIGRATION_TOKEN/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(telegramUserId|username)/);
});

test("moderation detects the observed Binance article solicitation", () => {
  const decision = classifyModerationMessage({
    text: "@PB899 Waiting for your response regarding the Binance article. We’re interested in covering your project by sharing its details on Binance through a published article.",
    memberMessageCount: 1,
    newMemberMessageLimit: 3,
  });
  assert.deepEqual(decision, {
    reason: "sales-solicitation",
    severity: "low",
    explanation: "unsolicited project coverage, listing, or promotional outreach",
    routeToSales: true,
  });
  assert.equal(moderationActionFor(decision, 0, 3), "redirect-delete");
  assert.equal(
    classifyModerationMessage({
      text: "Did anyone read the Binance article about HIVE today?",
      memberMessageCount: 20,
      newMemberMessageLimit: 3,
    }),
    null,
  );
});

test("moderation detects credential scams before generic links", () => {
  const decision = classifyModerationMessage({
    text: "Connect your wallet to claim the migration airdrop: https://wallet-drain.example",
    memberMessageCount: 1,
    newMemberMessageLimit: 3,
  });
  assert.equal(decision?.reason, "credential-scam");
  assert.equal(moderationActionFor(decision, 0, 3), "ban-delete");
});

test("new-member link protection honors allowed domains and blocked subdomains", () => {
  assert.deepEqual(extractModerationDomains("See https://docs.example.com/a and www.evil.example/x"), [
    "docs.example.com",
    "evil.example",
  ]);
  assert.equal(
    classifyModerationMessage({
      text: "Here are the docs https://docs.example.com/start",
      memberMessageCount: 1,
      newMemberMessageLimit: 3,
      allowedDomains: ["example.com"],
    }),
    null,
  );
  assert.equal(
    classifyModerationMessage({
      text: "Visit https://claim.evil.example",
      memberMessageCount: 20,
      newMemberMessageLimit: 3,
      blockedDomains: ["evil.example"],
    })?.reason,
    "blocked-domain",
  );
});

test("flood and duplicate decisions escalate predictably", () => {
  const duplicate = classifyModerationMessage({
    text: "same repeated message",
    memberMessageCount: 10,
    newMemberMessageLimit: 3,
    duplicate: true,
  });
  assert.equal(duplicate?.reason, "duplicate");
  assert.equal(moderationActionFor(duplicate, 0, 3), "warn-delete");
  assert.equal(moderationActionFor(duplicate, 1, 3), "mute-delete");
  assert.equal(moderationActionFor(duplicate, 2, 3), "ban-delete");

  const flood = classifyModerationMessage({
    text: "too many messages",
    memberMessageCount: 10,
    newMemberMessageLimit: 3,
    flood: true,
  });
  assert.equal(moderationActionFor(flood, 0, 3), "mute-delete");
});

test("duplicate tracking requires three substantial, distinct Telegram messages", () => {
  const tracker = new ModerationActivityTracker();
  const policy = {
    duplicateMinCharacters: 32,
    duplicateMinOccurrences: 3,
    duplicateWindowMs: 10 * 60_000,
    floodMaxMessages: 5,
    floodWindowMs: 10_000,
  };
  const base = {
    chatId: "chat",
    userId: "member",
    text: "This is a substantial repeated promotion message for the community",
  };

  assert.equal(tracker.record({ ...base, messageId: 10, now: 1_000 }, policy).duplicate, false);
  assert.equal(tracker.record({ ...base, messageId: 11, now: 2_000 }, policy).duplicate, false);
  const third = tracker.record({ ...base, messageId: 12, now: 3_000 }, policy);
  assert.equal(third.duplicate, true);
  assert.equal(third.duplicateOccurrences, 3);
  assert.deepEqual(third.matchedMessageIds, [10, 11]);

  const replay = tracker.record({ ...base, messageId: 12, now: 3_500 }, policy);
  assert.equal(replay.replayedMessage, true);
  assert.equal(replay.duplicate, false);
  assert.equal(replay.floodMessageCount, 3);

  const shortTracker = new ModerationActivityTracker();
  for (let messageId = 1; messageId <= 4; messageId += 1) {
    assert.equal(
      shortTracker.record({ chatId: "chat", userId: "member", messageId, now: messageId * 1_000, text: "thanks" }, policy)
        .duplicate,
      false,
    );
  }
});

test("moderation excludes edits from duplicate and flood activity while retaining content checks", () => {
  const moderation = readFileSync(new URL("../src/lib/services/telegram-tip-bot/moderation.ts", import.meta.url), "utf8");
  assert.match(moderation, /updateKind === "message"\s*\? activityTracker\.record/);
  assert.match(moderation, /classifyModerationMessage\(\{/);
  assert.match(moderation, /updateKind: ModerationUpdateKind = update\.edited_message \? "edited_message" : "message"/);
  assert.doesNotMatch(moderation, /existingMember && existingMember\.messagesSeen > runtime\.config\.newMemberMessageLimit/);
  assert.match(moderation, /handleModerationAuditCommand/);
  assert.match(moderation, /matched messages \$\{evidence\.matchedMessageIds\.join/);
});

test("moderation text and admin command parsing are stable", () => {
  assert.equal(normalizeModerationText("HEY @Alice — read https://example.com now!"), "hey <mention> read <url> now");
  assert.deepEqual(parseModerationCommand("/mute@HiveTipBot 30 repeated spam", "HiveTipBot"), {
    command: "mute",
    args: "30 repeated spam",
  });
  assert.equal(parseModerationCommand("/ban@OtherBot", "HiveTipBot"), null);
  assert.deepEqual(parseModerationCommand("/modaudit @Cryptocurry02", "HiveTipBot"), {
    command: "modaudit",
    args: "@Cryptocurry02",
  });
});

test("moderation state keeps trust, per-chat mode, strikes, and privacy-safe stats", () => {
  const state = emptyModerationState();
  recordModerationJoin(state, { chatId: "chat", userId: "9", at: T0 });
  const member = recordModerationMemberMessage(state, { chatId: "chat", userId: "9", at: T1 });
  assert.equal(member.messagesSeen, 1);
  setModerationTrust(state, "chat", "9", true);
  assert.equal(isModerationTrusted(state, "chat", "9"), true);
  setModerationTrust(state, "chat", "9", false);
  setModerationMode(state, "chat", "enforce");
  assert.equal(resolveModerationMode(state, "chat", "audit"), "enforce");
  addModerationStrike(state, { chatId: "chat", userId: "9", at: T1, warning: true });
  appendModerationAudit(state, {
    id: "audit-1",
    chatId: "chat",
    userId: "9",
    reason: "duplicate",
    action: "warn-delete",
    mode: "enforce",
    createdAt: T1,
  });
  assert.deepEqual(moderationStats(state, "chat"), {
    membersSeen: 1,
    trustedUsers: 0,
    strikes: 1,
    warnings: 1,
    actions: 1,
    salesRedirects: 0,
  });
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

test("formatCompactTokenAmount uses k, m, and b for table-sized balances", () => {
  assert.equal(formatCompactTokenAmount(parseTokenAmount("999", 18), 18), "999");
  assert.equal(formatCompactTokenAmount(parseTokenAmount("10,000", 18), 18), "10k");
  assert.equal(formatCompactTokenAmount(parseTokenAmount("300,000", 18), 18), "300k");
  assert.equal(formatCompactTokenAmount(parseTokenAmount("5,000,000", 18), 18), "5m");
  assert.equal(formatCompactTokenAmount(parseTokenAmount("500,000,000", 18), 18), "500m");
  assert.equal(formatCompactTokenAmount(parseTokenAmount("1,000,000,000", 18), 18), "1b");
  assert.equal(formatCompactTokenAmount(parseTokenAmount("1,500,000", 18), 18), "1.5m");
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

test("bounty create, boost, submit, and payout locks then credits internal balances", () => {
  const state = seededState();
  ensureUser(state, { id: 3, username: "carol", firstName: "Carol", createdAt: T0 });
  state.balances["2"] = parseTokenAmount("25", 18).toString();
  applyBountyCreate(state, {
    id: "b1",
    entryId: id(),
    creatorUserId: "1",
    title: "Build <dashboard>",
    rewardRaw: parseTokenAmount("20", 18).toString(),
    chatId: "-100",
    dueAt: "2099-01-01T00:00:00.000Z",
    createdAt: T0,
  });
  applyBountyBoost(state, {
    id: "b1",
    entryId: id(),
    boostId: "bb1",
    userId: "2",
    amountRaw: parseTokenAmount("5", 18).toString(),
    createdAt: T0,
  });
  applyBountySubmission(state, { id: "b1", submissionId: "s1", userId: "3", text: "https://example.com/pr", createdAt: T1 });
  assert.equal(formatTokenAmount(balanceOf(state, "1"), 18), "80");
  assert.equal(formatTokenAmount(balanceOf(state, "2"), 18), "20");
  assert.equal(formatTokenAmount(totalLiabilitiesRaw(state), 18), "125");
  const paid = applyBountyPayout(state, { id: "b1", entryId: id(), winnerUserId: "3", acceptedSubmissionId: "s1", updatedAt: T1 });
  assert.equal(paid.status, "paid");
  assert.equal(formatTokenAmount(balanceOf(state, "3"), 18), "25");
  assert.equal(formatTokenAmount(totalLiabilitiesRaw(state), 18), "125");
  assert.deepEqual(state.ledger.map((entry) => entry.kind), ["bounty-create", "bounty-boost", "bounty-payout"]);
});

test("insufficient bounty boost throws before mutation", () => {
  const state = seededState();
  applyBountyCreate(state, {
    id: "b2",
    entryId: id(),
    creatorUserId: "1",
    title: "Small task",
    rewardRaw: parseTokenAmount("10", 18).toString(),
    createdAt: T0,
  });
  assert.throws(
    () => applyBountyBoost(state, { id: "b2", entryId: id(), boostId: "bb2", userId: "2", amountRaw: "1", createdAt: T0 }),
    /Insufficient balance/,
  );
  assert.equal(state.bounties.b2.boosts.length, 0);
  assert.equal(balanceOf(state, "2"), 0n);
});

test("bounty refund returns creator reward and each active boost exactly", () => {
  const state = seededState();
  state.balances["2"] = parseTokenAmount("40", 18).toString();
  applyBountyCreate(state, { id: "b3", entryId: id(), creatorUserId: "1", title: "Refund me", rewardRaw: parseTokenAmount("30", 18).toString(), createdAt: T0 });
  applyBountyBoost(state, { id: "b3", entryId: id(), boostId: "bb3", userId: "2", amountRaw: parseTokenAmount("15", 18).toString(), createdAt: T0 });
  const refunded = applyBountyRefund(state, { id: "b3", makeEntryId: id, status: "cancelled", updatedAt: T1 });
  assert.equal(refunded.status, "cancelled");
  assert.equal(formatTokenAmount(balanceOf(state, "1"), 18), "100");
  assert.equal(formatTokenAmount(balanceOf(state, "2"), 18), "40");
  assert.equal(state.ledger.filter((entry) => entry.kind === "bounty-refund").length, 2);
});

test("expired bounties refund, while submitted bounties wait for admin", () => {
  const state = seededState();
  state.balances["2"] = parseTokenAmount("20", 18).toString();
  applyBountyCreate(state, { id: "b4", entryId: id(), creatorUserId: "1", title: "Expire", rewardRaw: parseTokenAmount("10", 18).toString(), dueAt: T0, createdAt: T0 });
  applyBountyCreate(state, { id: "b5", entryId: id(), creatorUserId: "1", title: "Submitted", rewardRaw: parseTokenAmount("10", 18).toString(), dueAt: T0, createdAt: T0 });
  applyBountySubmission(state, { id: "b5", submissionId: "s5", userId: "2", text: "done", createdAt: T0 });
  const expired = expireBounties(state, { now: T1, makeEntryId: id });
  assert.deepEqual(expired.map((bounty) => bounty.id), ["b4"]);
  assert.equal(state.bounties.b4.status, "expired");
  assert.equal(state.bounties.b5.status, "submitted");
});

test("disputed bounty state locks escrow for admin resolution", () => {
  const state = seededState();
  applyBountyCreate(state, { id: "b6", entryId: id(), creatorUserId: "1", title: "Review", rewardRaw: parseTokenAmount("10", 18).toString(), createdAt: T0 });
  const disputed = applyBountyRefund(state, { id: "b6", makeEntryId: id, status: "disputed", updatedAt: T1 });
  assert.equal(disputed.status, "disputed");
  assert.equal(formatTokenAmount(balanceOf(state, "1"), 18), "90");
  assert.equal(formatTokenAmount(totalLiabilitiesRaw(state), 18), "100");
});

test("bounty board sorts by pot and rich table escapes user-controlled cells", () => {
  const state = seededState();
  applyBountyCreate(state, { id: "b7", entryId: id(), creatorUserId: "1", title: "<script>alpha</script>", rewardRaw: parseTokenAmount("10", 18).toString(), createdAt: T0 });
  applyBountyCreate(state, { id: "b8", entryId: id(), creatorUserId: "1", title: "beta", rewardRaw: parseTokenAmount("20", 18).toString(), createdAt: T0 });
  assert.deepEqual(bountyBoard(state).map((row) => row.id), ["b8", "b7"]);
  const html = richTable(["ID", "Title", "Pot"], bountyBoard(state).map((row) => [richCode(row.id), row.title, richAccent("20 HIVE")]));
  assert.match(html, /<table bordered striped>/);
  assert.match(html, /<code>b8<\/code>/);
  assert.match(html, /<b>20 HIVE<\/b>/);
  assert.match(html, /&lt;script&gt;alpha&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("bounty payout leaderboard aggregates bounty winners per chat", () => {
  const state = seededState();
  ensureUser(state, { id: 3, username: "carol", firstName: "Carol", createdAt: T0 });
  applyBountyCreate(state, { id: "b10", entryId: id(), creatorUserId: "1", title: "Alpha", rewardRaw: parseTokenAmount("10", 18).toString(), chatId: "-100", createdAt: T0 });
  applyBountySubmission(state, { id: "b10", submissionId: "s10", userId: "3", text: "done", createdAt: T0 });
  applyBountyPayout(state, { id: "b10", entryId: id(), winnerUserId: "3", acceptedSubmissionId: "s10", updatedAt: T1 });
  applyBountyCreate(state, { id: "b11", entryId: id(), creatorUserId: "1", title: "Beta", rewardRaw: parseTokenAmount("5", 18).toString(), chatId: "-200", createdAt: T0 });
  applyBountySubmission(state, { id: "b11", submissionId: "s11", userId: "2", text: "done", createdAt: T0 });
  applyBountyPayout(state, { id: "b11", entryId: id(), winnerUserId: "2", acceptedSubmissionId: "s11", updatedAt: T1 });

  assert.deepEqual(bountyPayoutLeaderboard(state, { chatId: "-100" }).map((row) => [row.userId, formatTokenAmount(row.totalRaw, 18)]), [["3", "10"]]);
});

test("member tag resolver prefers compact rank overlays over stable staking titles", () => {
  assert.deepEqual(resolveMemberTag({ tier: { id: "builder", label: "Builder" }, honeyRank: 1 }), {
    tag: "Builder H#1",
    reason: "honey-rank+staking-tier",
  });
  assert.deepEqual(resolveMemberTag({ tier: { id: "curator", label: "Curator" }, honeyRank: 1, bountyRank: 1 }), {
    tag: "Curator B#1",
    reason: "bounty-rank+staking-tier",
  });
  assert.deepEqual(resolveMemberTag({ bountyRank: 5 }), { tag: "Bounty #5", reason: "bounty-rank" });
  assert.deepEqual(resolveMemberTag({ tier: { id: "visionary", label: "Visionary" } }), {
    tag: "Hive Visionary",
    reason: "staking-tier",
  });
});

test("member tag sync plans rank, tier, and clear-stale updates", () => {
  const state = seededState();
  ensureUser(state, { id: 3, username: "carol", firstName: "Carol", createdAt: T0 });
  state.balances["2"] = parseTokenAmount("20", 18).toString();
  state.memberTags.chatIds.push("-100");
  state.memberTags.lastSynced["-100"] = { "4": "Honey #1" };

  applyTip(state, { id: id(), fromUserId: "1", toUserId: "2", amountRaw: "3", chatId: "-100", createdAt: T1 });
  applyBountyCreate(state, { id: "b12", entryId: id(), creatorUserId: "1", title: "Gamma", rewardRaw: parseTokenAmount("10", 18).toString(), chatId: "-100", createdAt: T0 });
  applyBountySubmission(state, { id: "b12", submissionId: "s12", userId: "3", text: "done", createdAt: T0 });
  applyBountyPayout(state, { id: "b12", entryId: id(), winnerUserId: "3", acceptedSubmissionId: "s12", updatedAt: T1 });

  const tiers = new Map([["1", { id: "supporter", label: "Supporter" }]]);
  const actions = planMemberTagSync(state, { chatIds: knownMemberTagChatIds(state), topLimit: 5, sinceIso: memberTagSinceIso(7, Date.parse(T1) + 1), tiersByUserId: tiers });
  assert.deepEqual(
    actions.map((action) => [action.userId, action.tag, action.reason]).sort(),
    [
      ["1", "Hive Supporter", "staking-tier"],
      ["2", "Honey #1", "honey-rank"],
      ["3", "Bounty #1", "bounty-rank"],
      ["4", "", "clear-stale-tag"],
    ],
  );

  recordMemberTagSync(state, actions.map(({ chatId, userId, tag }) => ({ chatId, userId, tag })), T1);
  assert.equal(state.memberTags.lastSynced["-100"]["1"], "Hive Supporter");
  assert.equal(state.memberTags.lastSynced["-100"]["4"], undefined);
});

test("rich table theme maps Claw light palette to supported Telegram tags", () => {
  assert.equal(CLAW_LIGHT_RICH_THEME.bg, "#F5EFE6");
  assert.equal(CLAW_LIGHT_RICH_THEME.accent, "#8A5A2A");
  const html = richTable(["Kind", "Value"], [[richMuted("muted"), richAccent("5m HIVE")]]);
  assert.match(html, /<i>muted<\/i>/);
  assert.match(html, /<b>5m HIVE<\/b>/);
  assert.doesNotMatch(html, /style=/);
  assert.doesNotMatch(html, /#[A-Fa-f0-9]{6}/);
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
  applyBountyCreate(state, { id: "b9", entryId: id(), creatorUserId: "1", title: "Escrow", rewardRaw: "30", createdAt: T0 });
  // Every escrow debit stays in liabilities until it is claimed, sent, paid, or refunded.
  assert.equal(totalLiabilitiesRaw(state), parseTokenAmount("100", 18));
  resolveWithdrawal(state, { id: "w4", status: "sent", txHash: "0x1", updatedAt: T1 });
  assert.equal(totalLiabilitiesRaw(state), parseTokenAmount("100", 18) - 20n);
});
