import { NextRequest } from "next/server";
import { openChromeProfile } from "@/lib/services/beeline/chrome-profiles";
import { readBeelineProfiles, resolveBeelineProfile } from "@/lib/services/beeline/profile-store";
import { runBrowserUse, type BrowserUseAction } from "@/lib/services/browser-use-runner";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { verifyAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRMATION = "CONFIRM_BEELINE_BROWSER";
const AUTOMATION_CONFIRMATION = "CONFIRM_BEELINE_BROWSER_ACTION";
const BEELINE_BROWSER_ACTIONS = new Set<BrowserUseAction>(["open", "state", "click", "input", "type", "screenshot"]);

async function authorize(request: NextRequest) {
  const auth = await verifyAuth(request);
  return auth.userId ? null : errorJson(auth.reason ?? "Dashboard authentication is required.", 401);
}

export async function GET(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
    if (query) return okJson({ resolution: await resolveBeelineProfile(query) });
    return okJson(await readBeelineProfiles());
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not resolve Beeline profiles.", 500);
  }
}

export async function POST(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({})) as {
      profileId?: string;
      confirmation?: string;
      browserAction?: BrowserUseAction;
      url?: string;
      index?: number;
      text?: string;
    };
    const profile = (await readBeelineProfiles()).profiles.find((candidate) => candidate.id === body.profileId);
    if (!profile) return errorJson("That Beeline profile was not found.", 404);
    if (profile.consent.status !== "confirmed") {
      return errorJson("Confirm your authority for this family member in Beeline before opening their browser profile.", 403);
    }
    if (!profile.capabilities.includes("browser")) {
      return errorJson("Browser access is not enabled for this Beeline profile.", 403);
    }
    if (!profile.browserBinding) return errorJson("Bind a Chrome profile to this family member first.", 409);
    if (body.browserAction) {
      if (body.confirmation !== AUTOMATION_CONFIRMATION) {
        return errorJson(`Family browser automation requires confirmation ${AUTOMATION_CONFIRMATION}.`, 409, {
          needsConfirmation: AUTOMATION_CONFIRMATION,
        });
      }
      if (profile.browserBinding.automationMode !== "trusted-agent") {
        return errorJson("Switch this Beeline browser binding to trusted-agent mode before using browser automation.", 403);
      }
      if (!BEELINE_BROWSER_ACTIONS.has(body.browserAction)) {
        return errorJson("That Browser Use action is not available through Beeline.", 403);
      }
      const result = await runBrowserUse({
        action: body.browserAction,
        url: body.url,
        index: body.index,
        text: body.text,
        profile: profile.browserBinding.profileDirectory,
        session: `beeline-${profile.id}`,
        headed: true,
      });
      return okJson({ profileId: profile.id, browserAction: body.browserAction, result });
    }
    if (body.confirmation !== CONFIRMATION) {
      return errorJson(`Opening a family browser profile requires confirmation ${CONFIRMATION}.`, 409, {
        needsConfirmation: CONFIRMATION,
      });
    }
    const opened = await openChromeProfile(profile.browserBinding.profileDirectory);
    return okJson({ profileId: profile.id, opened });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not open the Beeline browser profile.", 400);
  }
}
