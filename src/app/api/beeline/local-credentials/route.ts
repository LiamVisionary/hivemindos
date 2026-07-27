import { NextRequest } from "next/server";
import {
  listLocalBeelineCredentials,
  NativeBeelineCredentialBrokerUnavailableError,
  executeLocalBeelineCredential,
} from "@/lib/services/beeline/local-credential-broker";
import { readBeelineProfiles } from "@/lib/services/beeline/profile-store";
import {
  BEELINE_CAPABILITIES,
  type BeelineCapability,
  type BeelineLocalCredentialUseInput,
} from "@/lib/types/beeline";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { verifyAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(request: NextRequest) {
  const auth = await verifyAuth(request);
  return auth.userId ? null : errorJson(auth.reason ?? "Dashboard authentication is required.", 401);
}

async function requireProfile(profileId: string) {
  const profile = (await readBeelineProfiles()).profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error("That Beeline profile was not found.");
  if (profile.consent.status !== "confirmed") {
    throw new Error("Confirm authority for this family member before using local credentials.");
  }
  return profile;
}

function failure(error: unknown, fallback: string) {
  const status = error instanceof NativeBeelineCredentialBrokerUnavailableError ? 424 : 400;
  return errorJson(error instanceof Error ? error.message : fallback, status);
}

export async function GET(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    const profileId = request.nextUrl.searchParams.get("profileId")?.trim() ?? "";
    await requireProfile(profileId);
    return okJson({
      backend: "os-keychain",
      credentials: await listLocalBeelineCredentials(profileId),
    });
  } catch (error) {
    return failure(error, "Could not list local Beeline credentials.");
  }
}

export async function POST(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({})) as Partial<BeelineLocalCredentialUseInput>;
    const profile = await requireProfile(body.profileId?.trim() ?? "");
    const capability = body.capability as BeelineCapability;
    if (!BEELINE_CAPABILITIES.includes(capability)) {
      return errorJson("A recognized Beeline capability is required.", 400);
    }
    if (!profile.capabilities.includes(capability)) {
      return errorJson(`The ${capability} capability is not enabled for this Beeline profile.`, 403);
    }
    if (body.usage === "browser-login") {
      if (capability !== "browser") return errorJson("Browser login requires the browser capability.", 403);
      if (profile.browserBinding?.automationMode !== "trusted-agent") {
        return errorJson("Switch this Beeline browser binding to trusted-agent mode before filling a saved login.", 403);
      }
    } else if (body.usage !== "http") {
      return errorJson("Credential usage must be browser-login or http.", 400);
    }
    if (!body.destinationUrl?.trim()) return errorJson("destinationUrl is required.", 400);
    const result = await executeLocalBeelineCredential(body as BeelineLocalCredentialUseInput);
    return okJson({ profileId: profile.id, result });
  } catch (error) {
    return failure(error, "Could not use the local Beeline credential.");
  }
}
