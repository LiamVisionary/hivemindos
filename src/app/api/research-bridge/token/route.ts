import {
  readOrCreateResearchBridgeToken,
  rotateResearchBridgeToken,
} from "@/lib/services/research-bridge";
import { errorJson, okJson } from "@/lib/utils/api-response";

// Dashboard-authenticated (proxy-gated — deliberately NOT in the
// self-authenticating allowlist, unlike hello/recall): shows the bridge token
// so the user can paste it into hivemindos.app/research, mirroring the phone
// pairing-token route. POST rotates it, invalidating every paired page.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return okJson({ token: await readOrCreateResearchBridgeToken() });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not read the bridge token.", 500);
  }
}

export async function POST() {
  try {
    return okJson({ token: await rotateResearchBridgeToken(), rotated: true });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not rotate the bridge token.", 500);
  }
}
