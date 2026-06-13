import { NextResponse } from "next/server";
import {
  DEFAULT_SKILL_SECURITY_SETTINGS,
  describeSecurityLlmRouting,
  isSkillSpectorAvailable,
  readSkillSecuritySettings,
  writeSkillSecuritySettings,
  type SkillSecurityEngine,
} from "@/lib/services/skills/skillspector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENGINES: SkillSecurityEngine[] = ["auto", "regex", "skillspector"];

export async function GET() {
  const [settings, scannerAvailable, llmRouting] = await Promise.all([
    readSkillSecuritySettings(),
    isSkillSpectorAvailable(),
    describeSecurityLlmRouting(),
  ]);
  return NextResponse.json({
    ok: true,
    settings,
    scannerAvailable,
    llmRouting,
    defaults: DEFAULT_SKILL_SECURITY_SETTINGS,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      engine?: string;
      llm?: boolean;
    };
    const patch: Parameters<typeof writeSkillSecuritySettings>[0] = {};
    if (body.engine !== undefined) {
      if (!ENGINES.includes(body.engine as SkillSecurityEngine)) {
        return NextResponse.json({ ok: false, error: `engine must be one of ${ENGINES.join(", ")}` }, { status: 400 });
      }
      patch.engine = body.engine as SkillSecurityEngine;
    }
    if (body.llm !== undefined) patch.llm = body.llm === true;
    const settings = await writeSkillSecuritySettings(patch);
    const [scannerAvailable, llmRouting] = await Promise.all([
      isSkillSpectorAvailable(),
      describeSecurityLlmRouting(),
    ]);
    return NextResponse.json({ ok: true, settings, scannerAvailable, llmRouting });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to update skill-security settings." },
      { status: 400 },
    );
  }
}
