import { NextRequest, NextResponse } from "next/server";
import {
  callRentAHumanAction,
  normalizeRentAHumanAction,
  prepareRentAHumanAction,
  RENTAHUMAN_ACTION_CONFIRMATION,
  rentAHumanActionRequiresConfirmation,
  rentAHumanStatus,
  type RentAHumanCallInput,
} from "@/lib/services/rentahuman";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RentAHumanBody = RentAHumanCallInput & {
  action?: unknown;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const actionParam = request.nextUrl.searchParams.get("action");
  const action = actionParam ? normalizeRentAHumanAction(actionParam) : null;
  if (!actionParam || actionParam === "status") {
    return NextResponse.json(await rentAHumanStatus());
  }
  if (!action) {
    return NextResponse.json({ ok: false, error: `Unsupported RentAHuman action: ${actionParam}` }, { status: 400 });
  }
  if (rentAHumanActionRequiresConfirmation(action)) {
    return NextResponse.json({
      ok: false,
      error: "Use POST with explicit confirmation for RentAHuman actions that can message, hire, book, or move funds.",
      prepared: prepareRentAHumanAction(action, queryInput(request)),
      confirmation: RENTAHUMAN_ACTION_CONFIRMATION,
    }, { status: 400 });
  }

  try {
    const result = await callRentAHumanAction(action, queryInput(request));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "RentAHuman request failed." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as RentAHumanBody;
    const action = normalizeRentAHumanAction(body.action);
    if (!action) {
      return NextResponse.json({ ok: false, error: "RentAHuman action is required." }, { status: 400 });
    }
    if (body.mode === "prepare") {
      return NextResponse.json({
        ok: true,
        mode: "prepare",
        prepared: prepareRentAHumanAction(action, body),
        confirmation: rentAHumanActionRequiresConfirmation(action) ? RENTAHUMAN_ACTION_CONFIRMATION : undefined,
      });
    }
    const result = await callRentAHumanAction(action, body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "RentAHuman action failed." }, { status: 500 });
  }
}

function queryInput(request: NextRequest): RentAHumanCallInput {
  const query: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (key !== "action") query[key] = value;
  }
  return { query };
}
