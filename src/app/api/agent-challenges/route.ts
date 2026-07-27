import { NextRequest, NextResponse } from "next/server";
import {
  createAgentChallenge,
  distillAgentChallengePlaybook,
  getAgentChallenge,
  postAgentChallengeEntry,
  readAgentChallengesState,
  recordAgentChallengeResult,
  recordAgentChallengeRuling,
  type AgentChallengesOptions,
} from "@/lib/services/agent-challenges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AgentChallengeAction =
  | "list"
  | "get"
  | "create"
  | "post-entry"
  | "record-result"
  | "rule"
  | "distill-playbook";

const ACTIONS = new Set<AgentChallengeAction>([
  "list",
  "get",
  "create",
  "post-entry",
  "record-result",
  "rule",
  "distill-playbook",
]);

export async function GET(request: NextRequest) {
  try {
    const options = optionsFromRequest(request);
    const id = request.nextUrl.searchParams.get("id");
    if (id) {
      const result = await getAgentChallenge(id, options);
      return NextResponse.json({ ok: true, challenge: result.challenge, summary: result.summary, storage: result.storage });
    }
    const result = await readAgentChallengesState(options);
    return NextResponse.json({ ok: true, challenges: result.state.challenges, summaries: result.summaries, storage: result.storage });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = normalizeBody(await request.json().catch(() => ({})));
    const action = normalizeAction(body.action);
    const options = optionsFromBody(body);

    if (action === "list") {
      const result = await readAgentChallengesState(options);
      return NextResponse.json({ ok: true, challenges: result.state.challenges, summaries: result.summaries, storage: result.storage });
    }
    if (action === "get") {
      const result = await getAgentChallenge(stringValue(body.challengeId ?? body.id), options);
      return NextResponse.json({ ok: true, challenge: result.challenge, summary: result.summary, storage: result.storage });
    }
    if (action === "create") {
      const result = await createAgentChallenge(body, options);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "post-entry") {
      const result = await postAgentChallengeEntry(body, options);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "record-result") {
      const result = await recordAgentChallengeResult(body, options);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "rule") {
      const result = await recordAgentChallengeRuling(body, options);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "distill-playbook") {
      const result = await distillAgentChallengePlaybook(body, options);
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: false, error: "Unsupported agent challenge action." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

function optionsFromRequest(request: NextRequest): AgentChallengesOptions {
  return {
    vaultPath: request.nextUrl.searchParams.get("vaultPath"),
    challengesFolder: request.nextUrl.searchParams.get("challengesFolder"),
  };
}

function optionsFromBody(body: Record<string, unknown>): AgentChallengesOptions {
  return {
    vaultPath: typeof body.vaultPath === "string" ? body.vaultPath : undefined,
    challengesFolder: typeof body.challengesFolder === "string" ? body.challengesFolder : undefined,
  };
}

function normalizeAction(value: unknown): AgentChallengeAction {
  const action = typeof value === "string" ? value : "list";
  if (!ACTIONS.has(action as AgentChallengeAction)) {
    throw new Error(`Unknown agent challenge action. Use one of: ${[...ACTIONS].join(", ")}.`);
  }
  return action as AgentChallengeAction;
}

function normalizeBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Agent challenge request failed.";
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}
