import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  CLAWBANK_MISSING_CREDENTIAL_MESSAGE,
  CLAWBANK_TOKEN_ENV_NAMES,
  clawbankCredentialPresence,
  clawbankMe,
} from "@/lib/services/clawbank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ClawBank readiness + account status. Read-only.
 *
 * Returns credential presence by env-key NAME only (never values) and, when a
 * credential is set, the live `GET /api/v1/me` readiness flags (KYC, Bridge,
 * trading, wallet). This is the first stop before any ClawBank action.
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const presence = await clawbankCredentialPresence();
  const configured = presence.some((entry) => entry.present);
  const credentials = [...CLAWBANK_TOKEN_ENV_NAMES];

  if (!configured) {
    return NextResponse.json({
      ok: true,
      configured: false,
      ready: false,
      credentials,
      credentialStatus: presence,
      error: CLAWBANK_MISSING_CREDENTIAL_MESSAGE,
    });
  }

  const me = await clawbankMe();
  if (!me.ok) {
    // Key present but the read failed — report configured so the UI shows the
    // account; the readiness flags are just unavailable this turn.
    return NextResponse.json({
      ok: true,
      configured: true,
      ready: false,
      credentials,
      credentialStatus: presence,
      me: null,
      error: me.error,
    });
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    ready: true,
    credentials,
    credentialStatus: presence,
    me: me.data,
  });
}
