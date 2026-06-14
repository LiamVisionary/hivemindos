import { NextRequest, NextResponse } from "next/server";
import {
  bankrActionDraftMessage,
  bankrActionRequiresConfirmation,
  bankrActionResultMessage,
  BANKR_ACTION_CONFIRMATION,
  classifyBankrActionPrompt,
  executeBankrAction,
  normalizeBankrActionIntent,
  parseBankrActionDraftMessage,
  validateBankrActionReadiness,
} from "@/lib/services/bankr-actions";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BankrActionBody = {
  action?: "prepare" | "execute" | "status";
  prompt?: unknown;
  intent?: unknown;
  draftMessage?: unknown;
  confirmation?: unknown;
  jobId?: unknown;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const missing = await validateBankrActionReadiness();
  return NextResponse.json({
    ok: !missing,
    ready: !missing,
    credentials: ["BANKR_API_KEY", "BANKR_LLM_KEY", "BANKR_MANAGEMENT_KEY"],
    error: missing || undefined,
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as BankrActionBody;
    const draft = typeof body.draftMessage === "string"
      ? parseBankrActionDraftMessage(body.draftMessage)
      : draftFromBody(body);
    if (!draft) return NextResponse.json({ ok: false, error: "Could not understand that Bankr action." }, { status: 400 });

    const missing = await validateBankrActionReadiness();
    if (missing) return NextResponse.json({ ok: false, error: missing }, { status: 400 });

    if (body.action === "prepare" || (bankrActionRequiresConfirmation(draft) && body.action !== "execute")) {
      return NextResponse.json({
        ok: true,
        mode: "prepare",
        requiresConfirmation: bankrActionRequiresConfirmation(draft),
        confirmation: bankrActionRequiresConfirmation(draft) ? BANKR_ACTION_CONFIRMATION : undefined,
        draft,
        message: bankrActionDraftMessage(draft),
      });
    }

    if (bankrActionRequiresConfirmation(draft) && body.confirmation !== BANKR_ACTION_CONFIRMATION) {
      return NextResponse.json({
        ok: false,
        error: `Type ${BANKR_ACTION_CONFIRMATION} to execute this Bankr action.`,
        message: bankrActionDraftMessage(draft),
      }, { status: 400 });
    }

    const result = await executeBankrAction(draft);
    return NextResponse.json({
      ok: true,
      mode: "execute",
      result,
      message: bankrActionResultMessage(result),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Bankr action failed.",
    }, { status: 500 });
  }
}

function draftFromBody(body: BankrActionBody) {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const inferred = prompt ? classifyBankrActionPrompt(prompt) : null;
  const intent = normalizeBankrActionIntent(body.intent) ?? inferred?.intent;
  if (!intent || !prompt) return inferred;
  return {
    intent,
    prompt,
    readOnly: inferred?.readOnly ?? (intent === "portfolio" || (intent === "agent-job" && Boolean(body.jobId))),
    jobId: typeof body.jobId === "string" ? body.jobId.trim() : inferred?.jobId,
  };
}
