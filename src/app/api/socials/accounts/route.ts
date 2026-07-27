// guard:allow-hive-action-route - dashboard-only Socials account management; not an agent-invokable
// Hive action. Posting lives behind the separate queue route's durable approval gates, and auto
// mode is only writable with an explicit human opt-in trail.
import { NextRequest } from "next/server";

import { errorJson, okJson } from "@/lib/utils/api-response";
import { readSharedAgentEnv } from "@/lib/services/integrations/shared-env";
import { socialAdapter } from "@/lib/services/socials/adapters";
import { socialPlatformCapabilityDtos, socialPlatformRow } from "@/lib/services/socials/social-platform-matrix";
import {
  connectSocialAccount,
  deleteSocialAccount,
  getSocialAccount,
  listSocialSoulOptions,
  mutateSocialDraftingRuntime,
  newContextSource,
  readSocialAccounts,
  readSocialQueueMeta,
  mutateSocialQueue,
  updateSocialAccount,
  type CreateSocialAccountInput,
} from "@/lib/services/socials/socials-store";
import {
  SOCIAL_CONNECT_METHODS,
  SOCIAL_DRAFT_CADENCE_HOURS,
  SOCIAL_DRAFTS_PER_RUN,
  SOCIAL_ENGAGEMENT_DRAFTS_PER_RUN,
  SOCIAL_ENGAGEMENT_LOOKBACK_HOURS,
  SOCIAL_PLATFORMS,
  SOCIAL_QUOTE_DRAFTS_PER_RUN,
  type SocialAccount,
  type SocialAwakeHours,
  type SocialContextSourceKind,
  type SocialDraftingPolicy,
} from "@/lib/services/socials/socials-types";
import { transitionQueueItem, validAwakeHoursConfiguration } from "@/lib/services/socials/social-queue-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTEXT_SOURCE_KINDS: readonly SocialContextSourceKind[] = ["github", "website", "x-account", "local-folder", "local-file"];

export async function GET() {
  try {
    const [accounts, env, queueMeta, souls] = await Promise.all([
      readSocialAccounts(),
      readSharedAgentEnv(),
      readSocialQueueMeta(),
      listSocialSoulOptions(),
    ]);
    const probes = await Promise.all(
      accounts.map(async (account) => {
        try {
          return await socialAdapter(account.platform).connectStatus(account, { env });
        } catch (error) {
          return { ok: false, detail: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
    const withStatus = accounts.map((account, index) => ({
      ...account,
      probe: probes[index],
      status: (probes[index].ok ? "connected" : account.status === "disconnected" ? "disconnected" : "needs-attention") as SocialAccount["status"],
      capabilities: socialAdapter(account.platform).capabilities(account),
    }));
    return okJson({ accounts: withStatus, platforms: socialPlatformCapabilityDtos(), queue: queueMeta, souls });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Failed to read social accounts", 500);
  }
}

type PostBody = {
  action?: string;
  id?: string;
  account?: Partial<CreateSocialAccountInput> & { platform?: string; handle?: string; method?: string };
  update?: Partial<Pick<SocialAccount, "displayName" | "soulPath" | "binding" | "maxDailyReadOps" | "handle">>;
  mode?: string;
  optIn?: boolean;
  optInNote?: string;
  awakeHours?: Partial<SocialAwakeHours>;
  sources?: Array<{ kind?: string; ref?: string; note?: string }>;
  sourceId?: string;
  drafting?: Partial<Pick<SocialDraftingPolicy,
    "enabled" | "cadenceHours" | "draftsPerRun" | "engagementEnabled" | "replyDraftsPerRun" | "quoteDraftsPerRun" | "engagementLookbackHours">>;
};

export async function POST(request: NextRequest) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return errorJson("Invalid JSON body");
  }
  const action = (body.action ?? "").trim();
  try {
    switch (action) {
      case "create": {
        const platform = body.account?.platform ?? "";
        const handle = (body.account?.handle ?? "").trim();
        const method = body.account?.method ?? "";
        if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) return errorJson(`Unknown platform: ${platform}`);
        if (!(SOCIAL_CONNECT_METHODS as readonly string[]).includes(method)) return errorJson(`Unknown connect method: ${method}`);
        if (!handle) return errorJson("Account handle is required");
        if (platform === "x" && method === "managed-oauth" && !(body.account?.binding?.connectionSlug ?? "").trim()) {
          // A managed X account IS a gateway connection; a record without a slug
          // can never post and probes as "finish the sign-in" forever.
          return errorJson("Managed X accounts need a gateway connection — pick one or finish the managed sign-in first.");
        }
        const account = await connectSocialAccount({
          platform: platform as CreateSocialAccountInput["platform"],
          handle,
          method: method as CreateSocialAccountInput["method"],
          ...(body.account?.displayName ? { displayName: body.account.displayName } : {}),
          ...(body.account?.soulPath ? { soulPath: body.account.soulPath } : {}),
          ...(body.account?.binding ? { binding: body.account.binding } : {}),
          ...(body.account?.awakeHours ? { awakeHours: body.account.awakeHours } : {}),
        });
        return okJson({ account });
      }
      case "update": {
        if (!body.id) return errorJson("Account id is required");
        const account = await updateSocialAccount(body.id, (current) => ({
          ...current,
          ...(body.update?.handle ? { handle: body.update.handle.replace(/^@/, "").trim() } : {}),
          ...(body.update?.displayName !== undefined ? { displayName: body.update.displayName } : {}),
          ...(body.update?.soulPath !== undefined ? { soulPath: body.update.soulPath } : {}),
          ...(body.update?.binding ? { binding: { ...(current.binding ?? {}), ...body.update.binding } } : {}),
          ...(typeof body.update?.maxDailyReadOps === "number" && body.update.maxDailyReadOps >= 0
            ? { maxDailyReadOps: Math.floor(body.update.maxDailyReadOps) }
            : {}),
        }));
        return okJson({ account });
      }
      case "delete": {
        if (!body.id) return errorJson("Account id is required");
        await deleteSocialAccount(body.id);
        return okJson({ deleted: body.id });
      }
      case "set-mode": {
        if (!body.id) return errorJson("Account id is required");
        const mode = body.mode === "auto" ? "auto" : body.mode === "manual" ? "manual" : null;
        if (!mode) return errorJson(`Unknown posting mode: ${body.mode}`);
        if (mode === "auto" && body.optIn !== true) {
          // Policy gate: auto mode requires the caller to send the explicit opt-in
          // flag the AutoModeOptInModal collects — a plain mode flip is refused.
          return errorJson("Auto posting mode requires the explicit opt-in confirmation.", 403);
        }
        const account = await updateSocialAccount(body.id, (current) => ({
          ...current,
          postingMode: mode,
          ...(mode === "auto"
            ? { autoOptIn: { enabledAt: new Date().toISOString(), enabledBy: "human" as const, ...(body.optInNote ? { note: body.optInNote } : {}) } }
            : { autoOptIn: undefined }),
        }));
        if (mode === "manual") {
          await mutateSocialQueue((queue) => queue.map((item) => {
            if (item.accountId !== body.id || item.approval?.by !== "auto-mode" || item.state !== "scheduled") return item;
            const reviewed = transitionQueueItem(item, "suggested", { by: "human" });
            return {
              ...reviewed,
              automated: false,
              approval: undefined,
              scheduledFor: undefined,
              cancelWindowEndsAt: undefined,
            };
          }));
        }
        return okJson({ account });
      }
      case "set-awake-hours": {
        if (!body.id) return errorJson("Account id is required");
        if (!body.awakeHours) return errorJson("awakeHours is required");
        const account = await updateSocialAccount(body.id, (current) => {
          const awakeHours = { ...current.awakeHours, ...body.awakeHours };
          if (!validAwakeHoursConfiguration(awakeHours)) {
            throw new Error("Awake hours need valid HH:MM start/end times, an IANA timezone, and one or more unique weekdays.");
          }
          return { ...current, awakeHours };
        });
        return okJson({ account });
      }
      case "set-drafting": {
        if (!body.id) return errorJson("Account id is required");
        if (!body.drafting) return errorJson("drafting is required");
        const cadenceHours = Number(body.drafting.cadenceHours);
        const draftsPerRun = Number(body.drafting.draftsPerRun);
        const replyDraftsPerRun = Number(body.drafting.replyDraftsPerRun);
        const quoteDraftsPerRun = Number(body.drafting.quoteDraftsPerRun);
        const engagementLookbackHours = Number(body.drafting.engagementLookbackHours);
        if (body.drafting.enabled !== undefined && typeof body.drafting.enabled !== "boolean") return errorJson("drafting.enabled must be a boolean");
        if (body.drafting.engagementEnabled !== undefined && typeof body.drafting.engagementEnabled !== "boolean") return errorJson("drafting.engagementEnabled must be a boolean");
        if (body.drafting.cadenceHours !== undefined && !(SOCIAL_DRAFT_CADENCE_HOURS as readonly number[]).includes(cadenceHours)) {
          return errorJson(`drafting.cadenceHours must be one of: ${SOCIAL_DRAFT_CADENCE_HOURS.join(", ")}`);
        }
        if (body.drafting.draftsPerRun !== undefined && !(SOCIAL_DRAFTS_PER_RUN as readonly number[]).includes(draftsPerRun)) {
          return errorJson(`drafting.draftsPerRun must be one of: ${SOCIAL_DRAFTS_PER_RUN.join(", ")}`);
        }
        if (body.drafting.replyDraftsPerRun !== undefined && !(SOCIAL_ENGAGEMENT_DRAFTS_PER_RUN as readonly number[]).includes(replyDraftsPerRun)) {
          return errorJson(`drafting.replyDraftsPerRun must be one of: ${SOCIAL_ENGAGEMENT_DRAFTS_PER_RUN.join(", ")}`);
        }
        if (body.drafting.quoteDraftsPerRun !== undefined && !(SOCIAL_QUOTE_DRAFTS_PER_RUN as readonly number[]).includes(quoteDraftsPerRun)) {
          return errorJson(`drafting.quoteDraftsPerRun must be one of: ${SOCIAL_QUOTE_DRAFTS_PER_RUN.join(", ")}`);
        }
        if (body.drafting.engagementLookbackHours !== undefined && !(SOCIAL_ENGAGEMENT_LOOKBACK_HOURS as readonly number[]).includes(engagementLookbackHours)) {
          return errorJson(`drafting.engagementLookbackHours must be one of: ${SOCIAL_ENGAGEMENT_LOOKBACK_HOURS.join(", ")}`);
        }
        const account = await updateSocialAccount(body.id, (current) => {
          if (!socialPlatformRow(current.platform).drafting.supported && body.drafting?.enabled) {
            throw new Error(`${current.platform} does not support automated drafting.`);
          }
          if (!socialPlatformRow(current.platform).drafting.engagement.supported && body.drafting?.engagementEnabled) {
            throw new Error(`${current.platform} does not support relevant-post discovery.`);
          }
          return {
            ...current,
            drafting: {
              ...current.drafting,
              ...(typeof body.drafting?.enabled === "boolean" ? { enabled: body.drafting.enabled } : {}),
              ...(body.drafting?.cadenceHours !== undefined ? { cadenceHours: cadenceHours as SocialDraftingPolicy["cadenceHours"] } : {}),
              ...(body.drafting?.draftsPerRun !== undefined ? { draftsPerRun: draftsPerRun as SocialDraftingPolicy["draftsPerRun"] } : {}),
              ...(typeof body.drafting?.engagementEnabled === "boolean" ? { engagementEnabled: body.drafting.engagementEnabled } : {}),
              ...(body.drafting?.replyDraftsPerRun !== undefined ? { replyDraftsPerRun: replyDraftsPerRun as SocialDraftingPolicy["replyDraftsPerRun"] } : {}),
              ...(body.drafting?.quoteDraftsPerRun !== undefined ? { quoteDraftsPerRun: quoteDraftsPerRun as SocialDraftingPolicy["quoteDraftsPerRun"] } : {}),
              ...(body.drafting?.engagementLookbackHours !== undefined ? { engagementLookbackHours: engagementLookbackHours as SocialDraftingPolicy["engagementLookbackHours"] } : {}),
              updatedAt: new Date().toISOString(),
              updatedBy: "human",
            },
          };
        });
        await mutateSocialDraftingRuntime(body.id, (runtime) => {
          const lastSuccess = Date.parse(runtime.lastSuccessAt ?? "");
          const producerEnabled = account.drafting.enabled || (
            socialPlatformRow(account.platform).drafting.engagement.supported && account.drafting.engagementEnabled
          );
          const nextRunAt = producerEnabled
            ? Number.isFinite(lastSuccess)
              ? new Date(lastSuccess + account.drafting.cadenceHours * 60 * 60_000).toISOString()
              : new Date().toISOString()
            : undefined;
          return {
            ...runtime,
            nextRunAt,
            ...(!producerEnabled ? { inFlightSince: undefined } : {}),
            lastError: undefined,
          };
        });
        return okJson({ account });
      }
      case "add-context-sources": {
        if (!body.id) return errorJson("Account id is required");
        const sources = Array.isArray(body.sources) ? body.sources : [];
        const valid = sources.filter(
          (source): source is { kind: SocialContextSourceKind; ref: string; note?: string } =>
            typeof source?.ref === "string" && source.ref.trim().length > 0 &&
            CONTEXT_SOURCE_KINDS.includes(source?.kind as SocialContextSourceKind),
        );
        if (!valid.length) return errorJson("No valid context sources supplied");
        const account = await updateSocialAccount(body.id, (current) => ({
          ...current,
          contextSources: [
            ...current.contextSources,
            ...valid.map((source) => newContextSource({ kind: source.kind, ref: source.ref.trim(), ...(source.note ? { note: source.note } : {}) })),
          ],
        }));
        return okJson({ account });
      }
      case "remove-context-source": {
        if (!body.id) return errorJson("Account id is required");
        if (!body.sourceId) return errorJson("sourceId is required");
        const account = await updateSocialAccount(body.id, (current) => ({
          ...current,
          contextSources: current.contextSources.filter((source) => source.id !== body.sourceId),
        }));
        return okJson({ account });
      }
      case "probe": {
        if (!body.id) return errorJson("Account id is required");
        const account = await getSocialAccount(body.id);
        if (!account) return errorJson(`Unknown social account: ${body.id}`, 404);
        const env = await readSharedAgentEnv();
        const probe = await socialAdapter(account.platform).connectStatus(account, { env });
        return okJson({ probe });
      }
      default:
        return errorJson(`Unknown action: ${action || "(none)"}`);
    }
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Socials account action failed", 500);
  }
}
