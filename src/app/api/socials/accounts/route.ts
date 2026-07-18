// guard:allow-hive-action-route - dashboard-only Socials account management; not an agent-invokable
// Hive action. Posting is not reachable here: queue/posting routes land in Phase 2 with their own
// approval gates, and auto mode is only writable with an explicit human opt-in trail (policy:
// nothing posts without explicit permission).
import { NextRequest } from "next/server";

import { errorJson, okJson } from "@/lib/utils/api-response";
import { readSharedAgentEnv } from "@/lib/services/integrations/shared-env";
import { socialAdapter } from "@/lib/services/socials/adapters";
import { socialPlatformCapabilityDtos } from "@/lib/services/socials/social-platform-matrix";
import {
  createSocialAccount,
  deleteSocialAccount,
  getSocialAccount,
  listSocialSoulOptions,
  newContextSource,
  readSocialAccounts,
  readSocialQueueMeta,
  updateSocialAccount,
  type CreateSocialAccountInput,
} from "@/lib/services/socials/socials-store";
import {
  SOCIAL_CONNECT_METHODS,
  SOCIAL_PLATFORMS,
  type SocialAccount,
  type SocialAwakeHours,
  type SocialContextSourceKind,
} from "@/lib/services/socials/socials-types";

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
        const account = await createSocialAccount({
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
        return okJson({ account });
      }
      case "set-awake-hours": {
        if (!body.id) return errorJson("Account id is required");
        if (!body.awakeHours) return errorJson("awakeHours is required");
        const account = await updateSocialAccount(body.id, (current) => ({
          ...current,
          awakeHours: { ...current.awakeHours, ...body.awakeHours },
        }));
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
