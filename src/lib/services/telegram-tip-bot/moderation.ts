import "server-only";

import { randomUUID } from "crypto";

import {
  classifyModerationMessage,
  moderationActionFor,
  parseModerationCommand,
  type ModerationAction,
  type ModerationDecision,
} from "./moderation-rules";
import {
  addModerationStrike,
  appendModerationAudit,
  isModerationTrusted,
  moderationStats,
  recordModerationJoin,
  recordModerationMemberMessage,
  resolveModerationMode,
  setModerationMode,
  setModerationTrust,
  type ModerationMode,
} from "./moderation-state";
import { mutateTipBotModerationState, readTipBotModerationState } from "./moderation-store";
import {
  escapeHtml,
  mentionHtml,
  type TelegramBotApi,
  type TgChatPermissions,
  type TgMessage,
  type TgUpdate,
  type TgUser,
} from "./telegram-api";

export type TipBotModerationConfig = {
  enabled: boolean;
  auditOnly: boolean;
  chatIds: Set<string>;
  salesInboxChatIds: string[];
  trustedUserIds: Set<string>;
  allowedDomains: string[];
  blockedDomains: string[];
  newMemberMessageLimit: number;
  floodMaxMessages: number;
  floodWindowMs: number;
  duplicateWindowMs: number;
  muteMinutes: number;
  banAfterStrikes: number;
};

export type TipBotModerationRuntime = {
  api: TelegramBotApi;
  botUsername: string;
  botUserId: string;
  adminIds: Set<string>;
  config: TipBotModerationConfig;
};

type RecentActivity = {
  lastSeenAt: number;
  timestamps: number[];
  fingerprints: Map<string, number>;
};

const recentActivity = new Map<string, RecentActivity>();
const MAX_ACTIVITY_KEYS = 10_000;

const MUTED_PERMISSIONS: TgChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
};

function isGroupMessage(message: TgMessage): boolean {
  return message.chat.type === "group" || message.chat.type === "supergroup";
}

function isManagedChat(config: TipBotModerationConfig, chatId: number): boolean {
  return config.enabled && config.chatIds.has(String(chatId));
}

function messageText(message: TgMessage): string {
  return (message.text ?? message.caption ?? "").trim();
}

function duplicateFingerprint(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 2_000);
}

function recordRecentActivity(
  chatId: string,
  userId: string,
  text: string,
  config: TipBotModerationConfig,
  now = Date.now(),
): { duplicate: boolean; flood: boolean } {
  const key = `${chatId}:${userId}`;
  const activity = recentActivity.get(key) ?? { lastSeenAt: now, timestamps: [], fingerprints: new Map() };
  activity.lastSeenAt = now;
  activity.timestamps = activity.timestamps.filter((timestamp) => now - timestamp <= config.floodWindowMs);
  activity.timestamps.push(now);

  for (const [fingerprint, timestamp] of activity.fingerprints) {
    if (now - timestamp > config.duplicateWindowMs) activity.fingerprints.delete(fingerprint);
  }
  const fingerprint = duplicateFingerprint(text);
  const duplicate = Boolean(fingerprint && activity.fingerprints.has(fingerprint));
  if (fingerprint) activity.fingerprints.set(fingerprint, now);
  recentActivity.set(key, activity);

  if (recentActivity.size > MAX_ACTIVITY_KEYS) {
    const oldest = [...recentActivity.entries()]
      .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
      .slice(0, Math.ceil(MAX_ACTIVITY_KEYS / 10));
    for (const [oldestKey] of oldest) recentActivity.delete(oldestKey);
  }

  return { duplicate, flood: activity.timestamps.length > config.floodMaxMessages };
}

async function notifyAdmins(runtime: TipBotModerationRuntime, text: string) {
  await Promise.all([...runtime.adminIds].map((adminId) => runtime.api.sendMessage({ chatId: adminId, text }).catch(() => null)));
}

async function notifyUser(runtime: TipBotModerationRuntime, userId: string, text: string) {
  await runtime.api.sendMessage({ chatId: userId, text }).catch(() => null);
}

function userLabel(user: TgUser): string {
  return mentionHtml({ id: String(user.id), username: user.username, firstName: user.first_name });
}

function boundedInquiryText(text: string): string {
  const limit = 3_000;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[Truncated from ${text.length} characters.]`;
}

async function routeSalesInquiry(runtime: TipBotModerationRuntime, message: TgMessage, mode: ModerationMode): Promise<boolean> {
  const destinations = runtime.config.salesInboxChatIds.length > 0 ? runtime.config.salesInboxChatIds : [...runtime.adminIds];
  const text = boundedInquiryText(messageText(message));
  const payload = [
    `📨 <b>Sales inquiry routed${mode === "audit" ? " (audit mode)" : ""}</b>`,
    `From: ${userLabel(message.from as TgUser)}`,
    `Source: ${escapeHtml(message.chat.title ?? "Telegram group")}`,
    "",
    escapeHtml(text),
  ].join("\n");
  const results = await Promise.all(
    destinations.map(async (chatId) => {
      try {
        await runtime.api.sendMessage({ chatId, text: payload });
        if (!message.text && message.caption) {
          await runtime.api.copyMessage({ chatId, fromChatId: message.chat.id, messageId: message.message_id });
        }
        return true;
      } catch {
        return false;
      }
    }),
  );
  return results.some(Boolean);
}

async function targetCanBeModerated(runtime: TipBotModerationRuntime, chatId: string, userId: string): Promise<boolean> {
  if (userId === runtime.botUserId || runtime.adminIds.has(userId) || runtime.config.trustedUserIds.has(userId)) return false;
  const state = await readTipBotModerationState();
  if (isModerationTrusted(state, chatId, userId)) return false;
  const member = await runtime.api.getChatMember({ chatId, userId }).catch(() => null);
  return Boolean(member && member.status !== "creator" && member.status !== "administrator");
}

async function deleteSourceMessage(runtime: TipBotModerationRuntime, message: TgMessage): Promise<boolean> {
  return runtime.api
    .deleteMessage({ chatId: message.chat.id, messageId: message.message_id })
    .then(() => true)
    .catch(() => false);
}

function plannedActionLabel(mode: ModerationMode, action: ModerationAction): string {
  return mode === "audit" ? `audit:${action}` : action;
}

async function recordDecision(
  message: TgMessage,
  decision: ModerationDecision,
  action: string,
  mode: ModerationMode,
) {
  await mutateTipBotModerationState((state) => {
    appendModerationAudit(state, {
      id: randomUUID(),
      chatId: String(message.chat.id),
      userId: String((message.from as TgUser).id),
      messageId: message.message_id,
      reason: decision.reason,
      action,
      mode,
      createdAt: new Date().toISOString(),
    });
  });
}

async function executeAutomaticDecision(
  runtime: TipBotModerationRuntime,
  message: TgMessage,
  decision: ModerationDecision,
  mode: ModerationMode,
  priorStrikes: number,
): Promise<boolean> {
  const user = message.from as TgUser;
  const chatId = String(message.chat.id);
  const userId = String(user.id);
  const action = moderationActionFor(decision, priorStrikes, runtime.config.banAfterStrikes);

  if (decision.routeToSales) {
    const delivered = await routeSalesInquiry(runtime, message, mode);
    if (!delivered) {
      await recordDecision(message, decision, `${plannedActionLabel(mode, action)}:delivery-failed`, mode);
      await notifyAdmins(
        runtime,
        `⚠️ Could not route a detected sales inquiry from ${userLabel(user)} in ${escapeHtml(message.chat.title ?? "a group")}; the original was left in place.`,
      );
      return false;
    }
    if (mode === "audit") {
      await recordDecision(message, decision, plannedActionLabel(mode, action), mode);
      return false;
    }
    const deleted = await deleteSourceMessage(runtime, message);
    await recordDecision(message, decision, deleted ? action : `${action}:delete-failed`, mode);
    if (!deleted) {
      await notifyAdmins(runtime, `⚠️ Sales inquiry was routed but could not be deleted from ${escapeHtml(message.chat.title ?? "the group")}.`);
    }
    return deleted;
  }

  if (mode === "audit") {
    await recordDecision(message, decision, plannedActionLabel(mode, action), mode);
    await notifyAdmins(
      runtime,
      `🛡️ <b>Moderation audit</b>\n${userLabel(user)} in ${escapeHtml(message.chat.title ?? "a group")}\nReason: ${escapeHtml(decision.explanation)}\nPlanned action: <code>${action}</code>`,
    );
    return false;
  }

  if (!(await targetCanBeModerated(runtime, chatId, userId))) {
    await recordDecision(message, decision, `${action}:protected-user`, mode);
    await notifyAdmins(runtime, `⚠️ Skipped moderation of protected/admin user ${userLabel(user)}.`);
    return false;
  }

  const deleted = await deleteSourceMessage(runtime, message);
  const now = new Date();
  const mutedUntil = new Date(now.getTime() + runtime.config.muteMinutes * 60_000);
  let enforcementSucceeded = action === "warn-delete";
  if (action === "mute-delete") {
    enforcementSucceeded = await runtime.api
      .restrictChatMember({
        chatId,
        userId,
        permissions: MUTED_PERMISSIONS,
        untilDate: Math.floor(mutedUntil.getTime() / 1_000),
      })
      .then(() => true)
      .catch(() => false);
  } else if (action === "ban-delete") {
    enforcementSucceeded = await runtime.api
      .banChatMember({ chatId, userId, revokeMessages: true })
      .then(() => true)
      .catch(() => false);
  }

  await mutateTipBotModerationState((state) => {
    addModerationStrike(state, {
      chatId,
      userId,
      at: now.toISOString(),
      warning: action === "warn-delete",
      mutedUntil: action === "mute-delete" && enforcementSucceeded ? mutedUntil.toISOString() : undefined,
      banned: action === "ban-delete" && enforcementSucceeded,
    });
    appendModerationAudit(state, {
      id: randomUUID(),
      chatId,
      userId,
      messageId: message.message_id,
      reason: decision.reason,
      action: `${action}${deleted ? "" : ":delete-failed"}${enforcementSucceeded ? "" : ":enforcement-failed"}`,
      mode,
      createdAt: now.toISOString(),
    });
  });

  const userNotice =
    action === "warn-delete"
      ? `Your message in ${escapeHtml(message.chat.title ?? "the HIVE group")} was removed: ${escapeHtml(decision.explanation)}. Further violations may mute or ban you.`
      : action === "mute-delete"
        ? `You were muted for ${runtime.config.muteMinutes} minutes in ${escapeHtml(message.chat.title ?? "the HIVE group")}: ${escapeHtml(decision.explanation)}.`
        : `You were removed from ${escapeHtml(message.chat.title ?? "the HIVE group")}: ${escapeHtml(decision.explanation)}.`;
  await notifyUser(runtime, userId, `🛡️ ${userNotice}`);
  if (!deleted || !enforcementSucceeded) {
    await notifyAdmins(
      runtime,
      `⚠️ Moderation action <code>${action}</code> was incomplete for ${userLabel(user)} in ${escapeHtml(message.chat.title ?? "a group")}. Check the bot's delete/restrict permissions.`,
    );
  }
  return deleted;
}

function commandTarget(message: TgMessage, numericUserId = ""): TgUser | null {
  const user = message.reply_to_message?.from;
  if (user && !user.is_bot) return user;
  if (/^\d{1,16}$/.test(numericUserId)) {
    const id = Number(numericUserId);
    if (Number.isSafeInteger(id)) return { id, first_name: "Telegram user" };
  }
  return null;
}

function parseMuteMinutes(args: string, fallback: number): number {
  const token = args.split(/\s+/)[0];
  const parsed = Number(token);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 10_080) : fallback;
}

async function replyToCommand(runtime: TipBotModerationRuntime, message: TgMessage, text: string) {
  await runtime.api.sendMessage({ chatId: message.chat.id, text, replyToMessageId: message.message_id });
}

async function handleModerationCommand(runtime: TipBotModerationRuntime, message: TgMessage): Promise<boolean> {
  const parsed = parseModerationCommand(message.text ?? "", runtime.botUsername);
  if (!parsed) return false;
  const from = message.from as TgUser;
  if (!runtime.adminIds.has(String(from.id))) {
    await replyToCommand(runtime, message, "⚠️ Moderation commands are restricted to configured bot admins.");
    return true;
  }

  const chatId = String(message.chat.id);
  if (parsed.command === "modhelp") {
    await replyToCommand(
      runtime,
      message,
      [
        "🛡️ <b>Moderator commands</b>",
        "Reply with /warn [reason], /mute [minutes], /ban [reason], or /unban.",
        "Reply with /trust or /untrust to manage the per-group allowlist.",
        "Use /modmode audit|enforce|off and /modstats.",
      ].join("\n"),
    );
    return true;
  }

  if (parsed.command === "modmode") {
    const mode = parsed.args.toLowerCase();
    if (mode !== "audit" && mode !== "enforce" && mode !== "off") {
      await replyToCommand(runtime, message, "Usage: /modmode audit|enforce|off");
      return true;
    }
    await mutateTipBotModerationState((state) => setModerationMode(state, chatId, mode));
    await replyToCommand(runtime, message, `🛡️ Moderation mode for this group is now <b>${mode}</b>.`);
    return true;
  }

  if (parsed.command === "modstats") {
    const state = await readTipBotModerationState();
    const stats = moderationStats(state, chatId);
    const mode = resolveModerationMode(state, chatId, runtime.config.auditOnly ? "audit" : "enforce");
    await replyToCommand(
      runtime,
      message,
      [
        `🛡️ <b>Moderation — ${escapeHtml(message.chat.title ?? "group")}</b>`,
        `Mode: <b>${mode}</b>`,
        `Members observed: ${stats.membersSeen}`,
        `Trusted users: ${stats.trustedUsers}`,
        `Actions: ${stats.actions}`,
        `Sales inquiries routed: ${stats.salesRedirects}`,
        `Warnings / strikes: ${stats.warnings} / ${stats.strikes}`,
      ].join("\n"),
    );
    return true;
  }

  const target = commandTarget(message, parsed.command === "unban" ? parsed.args : "");
  if (!target) {
    const suffix = parsed.command === "unban" ? ", or use /unban &lt;numeric-user-id&gt;" : ".";
    await replyToCommand(runtime, message, `Reply to a member's message with /${parsed.command}${suffix}`);
    return true;
  }
  const targetId = String(target.id);

  if (parsed.command === "trust" || parsed.command === "untrust") {
    const trusted = parsed.command === "trust";
    await mutateTipBotModerationState((state) => setModerationTrust(state, chatId, targetId, trusted));
    await replyToCommand(runtime, message, `${userLabel(target)} is ${trusted ? "now trusted" : "no longer trusted"} in this group.`);
    return true;
  }

  if (!(await targetCanBeModerated(runtime, chatId, targetId))) {
    await replyToCommand(runtime, message, "⚠️ That member is an admin or is protected by the moderation allowlist.");
    return true;
  }

  const now = new Date();
  if (parsed.command === "warn") {
    await mutateTipBotModerationState((state) => {
      addModerationStrike(state, { chatId, userId: targetId, at: now.toISOString(), warning: true });
      appendModerationAudit(state, {
        id: randomUUID(),
        chatId,
        userId: targetId,
        messageId: message.reply_to_message?.message_id,
        reason: parsed.args || "manual admin warning",
        action: "manual-warn",
        mode: "enforce",
        createdAt: now.toISOString(),
      });
    });
    await notifyUser(runtime, targetId, `🛡️ An admin warned you in ${escapeHtml(message.chat.title ?? "the HIVE group")}: ${escapeHtml(parsed.args || "community rules")}`);
    await replyToCommand(runtime, message, `Warned ${userLabel(target)}.`);
    return true;
  }

  if (parsed.command === "mute") {
    const minutes = parseMuteMinutes(parsed.args, runtime.config.muteMinutes);
    const mutedUntil = new Date(now.getTime() + minutes * 60_000);
    await runtime.api.restrictChatMember({
      chatId,
      userId: targetId,
      permissions: MUTED_PERMISSIONS,
      untilDate: Math.floor(mutedUntil.getTime() / 1_000),
    });
    await mutateTipBotModerationState((state) => {
      addModerationStrike(state, { chatId, userId: targetId, at: now.toISOString(), mutedUntil: mutedUntil.toISOString() });
      appendModerationAudit(state, {
        id: randomUUID(),
        chatId,
        userId: targetId,
        messageId: message.reply_to_message?.message_id,
        reason: "manual admin mute",
        action: `manual-mute:${minutes}m`,
        mode: "enforce",
        createdAt: now.toISOString(),
      });
    });
    await replyToCommand(runtime, message, `Muted ${userLabel(target)} for ${minutes} minutes.`);
    return true;
  }

  if (parsed.command === "ban") {
    await runtime.api.banChatMember({ chatId, userId: targetId, revokeMessages: true });
    await mutateTipBotModerationState((state) => {
      addModerationStrike(state, { chatId, userId: targetId, at: now.toISOString(), banned: true });
      appendModerationAudit(state, {
        id: randomUUID(),
        chatId,
        userId: targetId,
        messageId: message.reply_to_message?.message_id,
        reason: parsed.args || "manual admin ban",
        action: "manual-ban",
        mode: "enforce",
        createdAt: now.toISOString(),
      });
    });
    await replyToCommand(runtime, message, `Banned ${userLabel(target)}.`);
    return true;
  }

  await runtime.api.unbanChatMember({ chatId, userId: targetId, onlyIfBanned: true });
  await mutateTipBotModerationState((state) => {
    appendModerationAudit(state, {
      id: randomUUID(),
      chatId,
      userId: targetId,
      messageId: message.reply_to_message?.message_id,
      reason: "manual admin unban",
      action: "manual-unban",
      mode: "enforce",
      createdAt: now.toISOString(),
    });
  });
  await replyToCommand(runtime, message, `Unbanned ${userLabel(target)}. They may rejoin using an invite link.`);
  return true;
}

async function handleMemberUpdate(runtime: TipBotModerationRuntime, update: TgUpdate) {
  const memberUpdate = update.chat_member;
  if (!memberUpdate || !isManagedChat(runtime.config, memberUpdate.chat.id)) return;
  const previous = memberUpdate.old_chat_member.status;
  const current = memberUpdate.new_chat_member.status;
  const joined = (previous === "left" || previous === "kicked") && (current === "member" || current === "restricted");
  if (!joined || memberUpdate.new_chat_member.user.is_bot) return;
  await mutateTipBotModerationState((state) => {
    recordModerationJoin(state, {
      chatId: String(memberUpdate.chat.id),
      userId: String(memberUpdate.new_chat_member.user.id),
      at: new Date(memberUpdate.date * 1_000).toISOString(),
    });
  });
}

export async function handleTipBotModerationUpdate(runtime: TipBotModerationRuntime, update: TgUpdate): Promise<boolean> {
  if (!runtime.config.enabled) return false;
  if (update.chat_member) {
    await handleMemberUpdate(runtime, update);
    return false;
  }

  const message = update.edited_message ?? update.message;
  if (!message?.from || message.from.is_bot || !isGroupMessage(message) || !isManagedChat(runtime.config, message.chat.id)) {
    return false;
  }

  if (message.text && (await handleModerationCommand(runtime, message))) return true;

  const chatId = String(message.chat.id);
  const userId = String(message.from.id);
  const stateBefore = await readTipBotModerationState();
  const mode = resolveModerationMode(stateBefore, chatId, runtime.config.auditOnly ? "audit" : "enforce");
  if (mode === "off") return false;
  if (
    runtime.adminIds.has(userId) ||
    runtime.config.trustedUserIds.has(userId) ||
    isModerationTrusted(stateBefore, chatId, userId)
  ) {
    return false;
  }

  const now = new Date().toISOString();
  const existingMember = stateBefore.chats[chatId]?.members[userId];
  const member =
    existingMember && existingMember.messagesSeen > runtime.config.newMemberMessageLimit
      ? existingMember
      : await mutateTipBotModerationState((state) =>
          recordModerationMemberMessage(state, { chatId, userId, at: now }),
        );
  const text = messageText(message);
  if (!text) return false;
  const activity = recordRecentActivity(chatId, userId, text, runtime.config);
  const decision = classifyModerationMessage({
    text,
    memberMessageCount: member.messagesSeen,
    newMemberMessageLimit: runtime.config.newMemberMessageLimit,
    allowedDomains: runtime.config.allowedDomains,
    blockedDomains: runtime.config.blockedDomains,
    duplicate: activity.duplicate,
    flood: activity.flood,
  });
  if (!decision) return false;
  return executeAutomaticDecision(runtime, message, decision, mode, member.strikes);
}

export async function moderationPermissionWarnings(runtime: TipBotModerationRuntime): Promise<string[]> {
  const warnings: string[] = [];
  let chatIndex = 0;
  for (const chatId of runtime.config.chatIds) {
    chatIndex += 1;
    const label = `managed chat ${chatIndex}`;
    const member = await runtime.api.getChatMember({ chatId, userId: runtime.botUserId }).catch(() => null);
    if (!member || member.status !== "administrator") {
      warnings.push(`${label}: bot is not an administrator`);
      continue;
    }
    if (!member.can_delete_messages) warnings.push(`${label}: can_delete_messages is missing`);
    if (!member.can_restrict_members) warnings.push(`${label}: can_restrict_members is missing`);
  }
  return warnings;
}
