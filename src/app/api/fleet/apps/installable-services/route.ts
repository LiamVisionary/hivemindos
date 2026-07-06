import { NextRequest, NextResponse } from "next/server";
import {
  INSTALLABLE_SERVICE_IDS,
  readInstallableServiceStatus,
  runInstallableServiceAction,
  type InstallableServiceAction,
  type InstallableServiceActionInput,
  type InstallableServiceActionResult,
  type InstallableServiceStatus,
  type InstallableServiceId,
} from "@/lib/services/installable-services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serviceId(value: unknown): InstallableServiceId {
  if (value === "n8n") return value;
  if (value === "browser-use") return value;
  if (value === "agentic-inbox") return value;
  if (value === "mcp-email-server") return value;
  if (value === "openhands") return value;
  if (value === "aider") return value;
  if (value === "agent-reach") return value;
  if (value === "palmier-pro") return value;
  if (value === "copy-trading-daemon") return value;
  throw new Error("Unknown installable service.");
}

function serviceAction(value: unknown): InstallableServiceAction {
  if (
    value === "install" ||
    value === "start" ||
    value === "stop" ||
    value === "status" ||
    value === "install-pipx" ||
    value === "install-agent-reach-x" ||
    value === "check-agent-reach-x-auth" ||
    value === "agent-reach-doctor" ||
    value === "test-agent-reach-x-profile" ||
    value === "reset-agent-reach-x"
  ) return value;
  throw new Error("Unknown service action.");
}

function actionInput(body: { input?: unknown }): InstallableServiceActionInput | undefined {
  if (!body.input || typeof body.input !== "object" || Array.isArray(body.input)) return undefined;
  const raw = body.input as Record<string, unknown>;
  return {
    profileUrl: typeof raw.profileUrl === "string" ? raw.profileUrl : undefined,
    maxPosts: typeof raw.maxPosts === "number" ? raw.maxPosts : undefined,
    maxReplies: typeof raw.maxReplies === "number" ? raw.maxReplies : undefined,
  };
}

function isActionResult(value: InstallableServiceStatus | InstallableServiceActionResult): value is InstallableServiceActionResult {
  return Boolean(value && typeof value === "object" && "service" in value);
}

export async function GET(request: NextRequest) {
  try {
    const requestedId = request.nextUrl.searchParams.get("id");
    if (requestedId) {
      return NextResponse.json({ ok: true, service: await readInstallableServiceStatus(serviceId(requestedId)) });
    }
    const services = await Promise.all(INSTALLABLE_SERVICE_IDS.map((id) => readInstallableServiceStatus(id)));
    return NextResponse.json({ ok: true, services });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Service status failed." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { id?: unknown; action?: unknown; input?: unknown };
    const id = serviceId(body.id || "n8n");
    const action = serviceAction(body.action || "status");
    const actionResult = await runInstallableServiceAction(id, action, actionInput(body));
    if (isActionResult(actionResult)) return NextResponse.json({ ok: true, ...actionResult });
    return NextResponse.json({ ok: true, service: actionResult });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Service action failed." }, { status: 400 });
  }
}
