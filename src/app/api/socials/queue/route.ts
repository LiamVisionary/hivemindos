// guard:allow-hive-action-route - dashboard queue control. Agent-originated suggestions use the
// governed socials.queue-suggestion Hive Action; public posting remains confirmation-gated here.
import { NextRequest } from "next/server";

import {
  getSocialQueueEngineStatus,
  runSocialQueueTickNow,
  startSocialQueueEngine,
} from "@/lib/services/socials/social-queue-engine";
import { runSocialDraftingCycle } from "@/lib/services/socials/social-drafting-engine";
import { readSharedAgentEnv } from "@/lib/services/integrations/shared-env";
import { socialAdapter } from "@/lib/services/socials/adapters";
import {
  approveSocialQueueItem,
  cancelSocialQueueItem,
  deleteSocialQueueItem,
  enqueueSocialPost,
  retrySocialQueueItem,
  scheduleSocialQueueItem,
  sendSocialQueueItemNow,
  socialQueueDashboard,
  updateSocialQueueDraft,
} from "@/lib/services/socials/social-queue-service";
import {
  getSocialAccount,
  readSocialQueue,
  setSocialQueueEngineEnabled,
} from "@/lib/services/socials/socials-store";
import { refreshSocialAnalytics } from "@/lib/services/socials/social-analytics";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    startSocialQueueEngine();
    const accountId = request.nextUrl.searchParams.get("accountId")?.trim() || undefined;
    const [dashboard, engine] = await Promise.all([socialQueueDashboard(accountId), getSocialQueueEngineStatus()]);
    return okJson({ ...dashboard, engine });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Failed to read the social queue.", 500);
  }
}

type QueueBody = {
  action?: string;
  id?: string;
  accountId?: string;
  text?: string;
  title?: string;
  subreddit?: string;
  replyTo?: string;
  quoteOf?: string;
  suggestedFor?: string;
  scheduledFor?: string;
  deliveryVerified?: boolean;
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as QueueBody | null;
  if (!body) return errorJson("Invalid JSON body.");
  try {
    switch (body.action) {
      case "create":
        if (!body.accountId) return errorJson("accountId is required.");
        return okJson({ item: await enqueueSocialPost({
          accountId: body.accountId,
          text: body.text ?? "",
          title: body.title,
          subreddit: body.subreddit,
          replyTo: body.replyTo,
          quoteOf: body.quoteOf,
          suggestedFor: body.suggestedFor,
          origin: "human",
        }) });
      case "update":
        if (!body.id) return errorJson("id is required.");
        return okJson({ item: await updateSocialQueueDraft({
          id: body.id,
          text: body.text ?? "",
          title: body.title,
          subreddit: body.subreddit,
          replyTo: body.replyTo,
          quoteOf: body.quoteOf,
        }) });
      case "approve":
        if (!body.id) return errorJson("id is required.");
        return okJson({ item: await approveSocialQueueItem(body.id) });
      case "schedule":
        if (!body.id || !body.scheduledFor) return errorJson("id and scheduledFor are required.");
        return okJson({ item: await scheduleSocialQueueItem(body.id, body.scheduledFor) });
      case "send-now": {
        if (!body.id) return errorJson("id is required.");
        const queued = (await readSocialQueue()).find((item) => item.id === body.id);
        if (!queued) return errorJson(`Unknown social queue item: ${body.id}`, 404);
        const account = await getSocialAccount(queued.accountId);
        if (!account) return errorJson(`Unknown social account: ${queued.accountId}`, 404);
        const probe = await socialAdapter(account.platform).connectStatus(account, {
          env: await readSharedAgentEnv(),
        });
        if (!probe.ok) {
          return errorJson(`Reconnect @${account.handle} before publishing. ${probe.detail}`, 409);
        }
        const item = await sendSocialQueueItemNow(body.id);
        startSocialQueueEngine();
        const tick = await runSocialQueueTickNow();
        return okJson({ item, tick });
      }
      case "cancel":
        if (!body.id) return errorJson("id is required.");
        return okJson({ item: await cancelSocialQueueItem(body.id) });
      case "retry": {
        if (!body.id) return errorJson("id is required.");
        const item = await retrySocialQueueItem(body.id, body.deliveryVerified === true);
        const tick = await runSocialQueueTickNow();
        return okJson({ item, tick });
      }
      case "delete":
        if (!body.id) return errorJson("id is required.");
        await deleteSocialQueueItem(body.id);
        return okJson({ deleted: body.id });
      case "pause-engine":
        return okJson({ engine: await setSocialQueueEngineEnabled(false) });
      case "start-engine":
        return okJson({ engine: startSocialQueueEngine() });
      case "resume-engine":
        startSocialQueueEngine();
        return okJson({ engine: await setSocialQueueEngineEnabled(true) });
      case "tick":
        startSocialQueueEngine();
        return okJson({ tick: await runSocialQueueTickNow() });
      case "generate-drafts": {
        if (!body.accountId) return errorJson("accountId is required.");
        const drafting = await runSocialDraftingCycle({ accountId: body.accountId, force: true });
        if (drafting.failed.length) throw new Error(drafting.failed[0].error);
        if (!drafting.generated.length) throw new Error(drafting.skipped[0]?.reason || "No drafts were generated.");
        return okJson({ drafting });
      }
      case "generate-engagement": {
        if (!body.accountId) return errorJson("accountId is required.");
        const drafting = await runSocialDraftingCycle({ accountId: body.accountId, force: true, mode: "engagement" });
        if (drafting.failed.length) throw new Error(drafting.failed[0].error);
        if (!drafting.generated.length) throw new Error(drafting.skipped[0]?.reason || "No reply or quote suggestions were generated.");
        return okJson({ drafting });
      }
      case "refresh-analytics":
        if (!body.accountId) return errorJson("accountId is required.");
        return okJson({ analytics: await refreshSocialAnalytics(body.accountId) });
      default:
        return errorJson(`Unknown action: ${body.action || "(none)"}.`);
    }
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Social queue action failed.", 400);
  }
}
