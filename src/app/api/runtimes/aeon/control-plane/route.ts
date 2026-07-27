// guard:allow-hive-action-route - dashboard AEON runtime-management control plane, same operator family as the baselined runtime admin routes.
import { NextRequest } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { aeonWorkspaceRoot } from "@/lib/services/runtime-adapters/aeon";
import { AEON_GATEWAYS, AEON_HARNESSES, AEON_MODELS } from "@/lib/services/runtime-adapters/aeon-capabilities";
import { aeonCli, readAeonControlPlane, runAeonCli } from "@/lib/services/runtime-adapters/aeon-cli";
import { isValidAeonSkillSlug } from "@/lib/services/runtime-adapters/aeon-identifiers";
import { inspectAeonWorkspace } from "@/lib/services/runtime-adapters/aeon-workspace";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MCP_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const REPOSITORY_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

type ControlPlaneBody = {
  action?: string;
  agent?: AgentProfile;
  field?: string;
  value?: string;
  skill?: string;
  enabled?: boolean;
  schedule?: string;
  var?: string;
  model?: string;
  harness?: string;
  repo?: string;
  skills?: string[];
  name?: string;
  url?: string;
  content?: string;
  goal?: string;
  links?: string;
  handle?: string;
};

function requiredText(value: unknown, label: string, max = 10_000) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  if (text.length > max) throw Object.assign(new Error(`${label} is too long.`), { status: 400 });
  return text;
}

function validateModel(model: string) {
  if (model && !(AEON_MODELS as readonly string[]).includes(model)) {
    throw Object.assign(new Error(`Unsupported AEON model: ${model}`), { status: 400 });
  }
}

async function configureSkill(root: string, body: ControlPlaneBody) {
  const skill = requiredText(body.skill, "Skill", 120);
  if (!isValidAeonSkillSlug(skill)) throw Object.assign(new Error("Invalid AEON skill name."), { status: 400 });
  if (body.model !== undefined) validateModel(body.model);
  if (body.harness !== undefined && body.harness && !(AEON_HARNESSES as readonly string[]).includes(body.harness)) {
    throw Object.assign(new Error(`Unsupported AEON harness: ${body.harness}`), { status: 400 });
  }

  const results: Record<string, unknown> = {};
  if (body.schedule !== undefined) results.schedule = await aeonCli.scheduleSkill(root, skill, body.schedule || "manual");
  if (body.var !== undefined || body.model !== undefined || body.harness !== undefined) {
    results.settings = await aeonCli.setSkill(root, skill, {
      ...(body.var !== undefined ? { var: body.var } : {}),
      ...(body.model !== undefined ? { model: body.model } : {}),
      ...(body.harness !== undefined ? { harness: body.harness } : {}),
    });
  }
  if (body.enabled !== undefined) results.enabled = await aeonCli.enableSkill(root, skill, body.enabled);
  if (!Object.keys(results).length) throw Object.assign(new Error("No skill changes were supplied."), { status: 400 });
  return results;
}

async function runAction(root: string, body: ControlPlaneBody) {
  switch (body.action ?? "summary") {
    case "summary":
      return { controlPlane: await readAeonControlPlane(root) };
    case "config-set": {
      const field = requiredText(body.field, "Config field", 30);
      const value = requiredText(body.value, "Config value", 200);
      if (field === "model") validateModel(value);
      else if (field === "harness" && !(AEON_HARNESSES as readonly string[]).includes(value)) {
        throw Object.assign(new Error(`Unsupported AEON harness: ${value}`), { status: 400 });
      } else if (field === "gateway" && !(AEON_GATEWAYS as readonly string[]).includes(value)) {
        throw Object.assign(new Error(`Unsupported AEON gateway: ${value}`), { status: 400 });
      } else if (!["model", "harness", "gateway"].includes(field)) {
        throw Object.assign(new Error(`Unsupported AEON config field: ${field}`), { status: 400 });
      }
      return { result: await runAeonCli<Record<string, unknown>>(root, ["config", "set", field, value]) };
    }
    case "skill-configure":
      return { result: await configureSkill(root, body) };
    case "pack-install": {
      const repo = requiredText(body.repo, "Pack repository", 200);
      if (!REPOSITORY_RE.test(repo)) throw Object.assign(new Error("Pack repository must be owner/repo."), { status: 400 });
      const skills = (body.skills ?? []).filter(isValidAeonSkillSlug);
      return { result: await runAeonCli<Record<string, unknown>>(root, ["packs", "install", repo, ...skills], { timeoutMs: 180_000 }) };
    }
    case "mcp-add": {
      const name = requiredText(body.name, "MCP server", 120);
      if (!MCP_NAME_RE.test(name)) throw Object.assign(new Error("Invalid MCP server name."), { status: 400 });
      const args = ["mcp", "add", name];
      if (body.url) {
        try {
          const url = new URL(body.url);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error();
          args.push(url.toString());
        } catch {
          throw Object.assign(new Error("MCP URL must be a valid HTTP or HTTPS URL."), { status: 400 });
        }
      }
      return { result: await runAeonCli<Record<string, unknown>>(root, args) };
    }
    case "mcp-remove": {
      const name = requiredText(body.name, "MCP server", 120);
      if (!MCP_NAME_RE.test(name)) throw Object.assign(new Error("Invalid MCP server name."), { status: 400 });
      return { result: await runAeonCli<Record<string, unknown>>(root, ["mcp", "rm", name]) };
    }
    case "strategy-set":
      return { result: await runAeonCli<Record<string, unknown>>(root, ["strategy", "set", "--stdin"], { stdin: requiredText(body.content, "Strategy", 100_000) }) };
    case "strategy-build": {
      const args = ["strategy", "build", requiredText(body.goal, "Strategy goal", 2_000)];
      if (body.repo) args.push("--repo", body.repo);
      if (body.links) args.push("--links", body.links);
      if (body.model) { validateModel(body.model); args.push("--model", body.model); }
      return { result: await runAeonCli<Record<string, unknown>>(root, args, { timeoutMs: 300_000 }) };
    }
    case "soul-build": {
      const args = ["soul", "build"];
      if (body.handle) args.push("--handle", body.handle);
      if (body.name) args.push("--name", body.name);
      if (body.links) args.push("--links", body.links);
      if (body.model) { validateModel(body.model); args.push("--model", body.model); }
      return { result: await runAeonCli<Record<string, unknown>>(root, args, { timeoutMs: 300_000 }) };
    }
    case "telegram-register":
      return { result: await runAeonCli<Record<string, unknown>>(root, ["telegram", "register"]) };
    default:
      throw Object.assign(new Error(`Unsupported AEON control-plane action: ${body.action}`), { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as ControlPlaneBody | null;
  if (!body?.agent) return errorJson("AEON agent profile is required.", 400);
  const root = aeonWorkspaceRoot(body.agent);
  try {
    return okJson(await runAction(root, body));
  } catch (error) {
    if ((body.action ?? "summary") === "summary") {
      const layout = await inspectAeonWorkspace(root);
      if (layout.generation === "legacy") {
        return errorJson(
          "This workspace uses the legacy AEON layout. Install AEON v0.1 to unlock the control plane.",
          409,
          { code: "AEON_LEGACY_WORKSPACE", remediation: "repair-legacy" },
        );
      }
    }
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
    if (status >= 400 && status < 500) return errorJson(error instanceof Error ? error.message : "Invalid AEON request.", status);
    return upstreamErrorJson("AEON control-plane action failed", error);
  }
}
