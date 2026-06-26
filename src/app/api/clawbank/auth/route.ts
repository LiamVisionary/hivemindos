import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  clawbankMintApiToken,
  clawbankRequestCode,
  clawbankVerifyCode,
} from "@/lib/services/clawbank";
import { clawbankRouteError, readJsonBody, stringField } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// guard:allow-hive-action-route - dashboard-only ClawBank onboarding; mints a
// credential (API token) and is intentionally NOT an autonomous agent/MCP
// action. Tokens are returned once to the authenticated dashboard user, never
// persisted server-side.

/**
 * ClawBank onboarding: the three-step email login that mints a long-lived API
 * token. Auth-gated so only the local dashboard user can run it.
 *
 *   POST { action: "request_code", email }              -> emails a login code
 *   POST { action: "verify_code", email, code }         -> { bootstrap_token }
 *   POST { action: "mint_token", bootstrapToken, name } -> { api_token }
 *
 * The minted token is returned to the (already authenticated) caller exactly
 * once; the server does NOT persist it. Store it with the established secret
 * flow — `hive-env-add CLAWBANK_TOKEN <token>` — so it never lands in a file or
 * chat transcript. This route is the only place secret material crosses; treat
 * the response as sensitive.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(request);
  const action = stringField(body, "action") || "request_code";

  if (action === "request_code") {
    const email = stringField(body, "email");
    if (!email) return NextResponse.json({ ok: false, error: "An email is required to request a login code." }, { status: 400 });
    const result = await clawbankRequestCode(email);
    if (!result.ok) return clawbankRouteError(result);
    return NextResponse.json({ ok: true, action, data: result.data });
  }

  if (action === "verify_code") {
    const email = stringField(body, "email");
    const code = stringField(body, "code");
    if (!email || !code) return NextResponse.json({ ok: false, error: "Both email and code are required to verify." }, { status: 400 });
    const result = await clawbankVerifyCode(email, code);
    if (!result.ok) return clawbankRouteError(result);
    return NextResponse.json({ ok: true, action, data: result.data });
  }

  if (action === "mint_token") {
    const bootstrapToken = stringField(body, "bootstrapToken") || stringField(body, "bootstrap_token");
    if (!bootstrapToken) return NextResponse.json({ ok: false, error: "A bootstrap token from verify_code is required to mint an API token." }, { status: 400 });
    const result = await clawbankMintApiToken(bootstrapToken, {
      name: stringField(body, "name") || undefined,
      expiresAt: stringField(body, "expiresAt") || stringField(body, "expires_at") || undefined,
    });
    if (!result.ok) return clawbankRouteError(result);
    return NextResponse.json({
      ok: true,
      action,
      data: result.data,
      note: "Store this api_token with `hive-env-add CLAWBANK_TOKEN <token>`. It is shown once and is not persisted server-side.",
    });
  }

  return NextResponse.json({ ok: false, error: `Unknown auth action "${action}". Use request_code, verify_code, or mint_token.` }, { status: 400 });
}
