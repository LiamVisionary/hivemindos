import "server-only";

import { CommunityHoneyClient } from "./community-honey";
import { telegramPublicLabel } from "./community-honey-logic";
import { honeyAuditDetail, honeyRecognitionAuditId, type HoneyRecognitionAuditEntry } from "./honey-audit-state";
import { finishHoneyRecognitionAudit, startHoneyRecognitionAudit } from "./honey-audit-store";
import {
  HONEY_REACTION_REASON,
  HONEY_RECOGNITION_REACTION_EMOJI,
  reportRejectedHoneyReaction,
} from "./honey-recognition";
import { escapeHtml, type TelegramBotApi, type TgUpdate, type TgUser } from "./telegram-api";

type HoneyReactionHandlerInput = {
  api: Pick<TelegramBotApi, "deleteMessageReaction" | "sendMessage">;
  client: CommunityHoneyClient;
  update: TgUpdate;
  recipient: TgUser | null;
  notifyGiver: (userId: string, text: string) => Promise<boolean>;
};

export async function handleHoneyReactionWithAudit(input: HoneyReactionHandlerInput) {
  const reaction = input.update.message_reaction;
  const giver = reaction?.user;
  if (!reaction || !giver) return;

  const now = new Date().toISOString();
  const audit: HoneyRecognitionAuditEntry = {
    id: honeyRecognitionAuditId("reaction", input.update.update_id),
    source: "reaction",
    updateId: input.update.update_id,
    chatId: String(reaction.chat.id),
    messageId: reaction.message_id,
    giverUserId: String(giver.id),
    recipientUserId: input.recipient ? String(input.recipient.id) : undefined,
    outcome: "received",
    createdAt: now,
    updatedAt: now,
  };
  await startHoneyRecognitionAudit(audit);

  if (!input.recipient) {
    const detail = "The reacted-to message was not present in the recent-member index.";
    return reportReactionRejection({
      input,
      audit,
      giver,
      reason: "I couldn't match that message to a recent member. Reply to it with <code>/honey &lt;why&gt;</code> instead.",
      auditDetail: detail,
    });
  }

  let ledgerOutcome: "recorded" | "duplicate" | null = null;
  try {
    const result = await input.client.givePeerHoney({
      giverTelegramUserId: String(giver.id),
      recipientTelegramUserId: String(input.recipient.id),
      telegramUpdateId: String(input.update.update_id),
      reason: HONEY_REACTION_REASON,
    });
    ledgerOutcome = result.duplicate ? "duplicate" : "recorded";
    await finishHoneyRecognitionAudit(audit.id, {
      outcome: result.duplicate ? "duplicate" : "recorded",
      recognitionsRemainingToday: result.recognitionsRemainingToday,
      dailyRecognitionLimit: result.dailyRecognitionLimit,
      detail: result.duplicate
        ? "The hosted ledger had already processed this Telegram update."
        : "The hosted ledger recorded the recognition.",
    });
    if (result.duplicate) return;
    await input.api.sendMessage({
      chatId: reaction.chat.id,
      replyToMessageId: reaction.message_id,
      text: [
        `${HONEY_RECOGNITION_REACTION_EMOJI} <b>${escapeHtml(telegramPublicLabel(giver))} recognized ${escapeHtml(result.recipientPublicLabel || telegramPublicLabel(input.recipient))} via 🏆 reaction</b>`,
        `🍯 +${Number(result.honeyGiven || 1).toLocaleString()} HONEY`,
        `Quota for ${escapeHtml(telegramPublicLabel(giver))}: ${Number(result.recognitionsRemainingToday || 0).toLocaleString()} of ${Number(result.dailyRecognitionLimit || 0).toLocaleString()} recognitions left this UTC day.`,
        ...(result.recipientLinked === false
          ? ["Banked to their Telegram account — <code>/linkhoney</code> transfers it to HivemindOS anytime."]
          : []),
        `Receipt: <code>${escapeHtml(audit.id)}</code>`,
      ].join("\n"),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The recognition could not be recorded.";
    if (ledgerOutcome) {
      const auditUpdated = await finishHoneyRecognitionAudit(audit.id, {
        outcome: ledgerOutcome === "recorded" ? "recorded-reply-failed" : "duplicate",
        detail: `Post-ledger receipt handling failed: ${honeyAuditDetail(error)}`,
      }).then(() => true).catch(() => false);
      const notified = await input.notifyGiver(
        String(giver.id),
        ledgerOutcome === "recorded"
          ? `${HONEY_RECOGNITION_REACTION_EMOJI} HONEY was recorded, but I couldn't complete its Telegram receipt. An admin can verify <code>${escapeHtml(audit.id)}</code> with <code>/honeyaudit</code>.`
          : `${HONEY_RECOGNITION_REACTION_EMOJI} This Telegram update was already processed; no second HONEY was added. An admin can verify <code>${escapeHtml(audit.id)}</code> with <code>/honeyaudit</code>.`,
      );
      if (!notified || !auditUpdated) throw new Error(`Hosted HONEY receipt ${audit.id} could not be fully audited and delivered.`);
      return;
    }
    await reportReactionRejection({
      input,
      audit,
      giver,
      reason: escapeHtml(reason),
      auditDetail: honeyAuditDetail(error),
    });
  }
}

async function reportReactionRejection(params: {
  input: HoneyReactionHandlerInput;
  audit: HoneyRecognitionAuditEntry;
  giver: TgUser;
  reason: string;
  auditDetail: string;
}) {
  const { input, audit, giver } = params;
  const report = await reportRejectedHoneyReaction({
    deleteReaction: () => input.api.deleteMessageReaction({
      chatId: audit.chatId,
      messageId: audit.messageId,
      userId: giver.id,
    }),
    sendGroupReply: async (reactionRemoved) => {
      await input.api.sendMessage({
        chatId: audit.chatId,
        replyToMessageId: audit.messageId,
        text: rejectionMessage({
          audit,
          giver,
          recipient: input.recipient,
          reason: params.reason,
          reactionRemoved,
        }),
      });
    },
    notifyGiver: (reactionRemoved) => input.notifyGiver(
      String(giver.id),
      [
        rejectionMessage({
          audit,
          giver,
          recipient: input.recipient,
          reason: params.reason,
          reactionRemoved,
        }),
        "I couldn't post this failure in the group.",
      ].join("\n"),
    ),
  });
  const deliveryDetail = [
    report.reactionRemoved ? "The giver's trophy reaction was removed." : "The giver's trophy reaction could not be removed.",
    report.publicReplySent
      ? "The rejection was reported in the group."
      : report.giverDmSent
        ? "The group reply failed, so the giver was notified privately."
        : "Neither the group reply nor the private fallback was delivered.",
  ].join(" ");
  const auditUpdated = await finishHoneyRecognitionAudit(audit.id, {
    outcome: "rejected",
    detail: `${params.auditDetail} ${deliveryDetail}`,
  }).then(() => true).catch(() => false);
  if (report.reported && auditUpdated) return;

  await finishHoneyRecognitionAudit(audit.id, {
    outcome: "rejected-reply-failed",
    detail: `${params.auditDetail} ${deliveryDetail}${auditUpdated ? "" : " The audit outcome could not be finalized."}`,
  }).catch(() => undefined);
  throw new Error(`Rejected HONEY receipt ${audit.id} could not be fully audited and delivered.`);
}

function rejectionMessage(params: {
  audit: HoneyRecognitionAuditEntry;
  giver: TgUser;
  recipient: TgUser | null;
  reason: string;
  reactionRemoved: boolean;
}) {
  const participants = params.recipient
    ? `${escapeHtml(telegramPublicLabel(params.giver))} → ${escapeHtml(telegramPublicLabel(params.recipient))}`
    : escapeHtml(telegramPublicLabel(params.giver));
  return [
    `${HONEY_RECOGNITION_REACTION_EMOJI} <b>Recognition not recorded</b>`,
    participants,
    params.reason,
    params.reactionRemoved
      ? "The 🏆 reaction was removed."
      : "I couldn't remove the 🏆 reaction automatically; please remove it manually.",
    `Receipt: <code>${escapeHtml(params.audit.id)}</code>`,
  ].join("\n");
}
