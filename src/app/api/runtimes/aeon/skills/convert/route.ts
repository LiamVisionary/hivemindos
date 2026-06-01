import { readFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { getSharedBrainSkills } from "@/lib/services/obsidian/brain-skills";
import { getRuntimeAdapter } from "@/lib/services/runtime-adapters/registry";
import { appendSkillAnalyticsEvent, auditSkillInput } from "@/lib/services/skills/skill-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      agent?: AgentProfile;
      skill?: string;
      vaultPath?: string;
      schedule?: string;
      var?: string;
      model?: string;
      enabled?: boolean;
    };
    if (!body.skill?.trim()) throw new Error("Choose a skill to convert.");
    const agent = body.agent ?? ({ runtime: "aeon" } as AgentProfile);
    const adapter = getRuntimeAdapter("aeon");
    if (!adapter?.updateSkillConfig) throw new Error("Aeon skill config editing is not available.");

    const inventory = await getSharedBrainSkills(body.vaultPath);
    const skill = inventory.shared.find((item) => item.slug === body.skill);
    if (!skill) throw new Error("That skill is not in the shared brain yet.");
    const markdown = await readFile(skill.path, "utf8");
    const audit = await auditSkillInput({ slug: skill.slug, markdown, sourceRef: skill.sourcePath ?? skill.path });
    if (audit.status === "blocked") {
      throw new Error(`Skill audit blocked Aeon conversion: ${audit.findings.map((finding) => finding.title).join(", ")}`);
    }

    if (adapter.syncSkills) {
      await adapter.syncSkills(agent, { requestUrl: request.url, vaultPath: body.vaultPath, agents: [agent] }).catch(() => undefined);
    }

    const brief = body.var?.trim() || `Run ${skill.name}. Use the shared skill instructions and report verification evidence.`;
    const schedule = body.schedule?.trim() || "manual";
    const model = body.model?.trim() || "";
    const configCalls = [
      { action: "schedule" as const, value: schedule },
      { action: "var" as const, value: brief },
      { action: "model" as const, value: model },
      { action: body.enabled ? "enable" as const : "disable" as const, value: Boolean(body.enabled) },
    ];
    const results = [];
    for (const call of configCalls) {
      const result = await adapter.updateSkillConfig(agent, skill.slug, call.action, call.value, {
        requestUrl: request.url,
        vaultPath: body.vaultPath,
        agents: [agent],
      });
      if (!result.ok) throw new Error(result.error ?? `Could not update Aeon ${call.action} config.`);
      results.push(result.result ?? result);
    }

    await appendSkillAnalyticsEvent({
      skillSlug: skill.slug,
      event: "converted",
      runtime: "aeon",
      agentId: agent.id,
      auditStatus: audit.status,
      status: "success",
      note: `Converted to Aeon workflow with ${schedule} cadence.`,
    }).catch(() => undefined);

    return NextResponse.json({
      ok: true,
      skill: skill.slug,
      audit,
      aeon: {
        schedule,
        var: brief,
        model,
        enabled: Boolean(body.enabled),
        config: results,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not convert skill to Aeon workflow." }, { status: 400 });
  }
}
