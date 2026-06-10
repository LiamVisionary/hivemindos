import type { AgentProfile } from "@/lib/types/agent-runtime";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeAdapter } from "./types";

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || join(homedir(), ".openclaw");
const OPENCLAW_CONFIG = join(OPENCLAW_HOME, "openclaw.json");

function readOpenClawConfig() {
  if (!existsSync(OPENCLAW_CONFIG)) return {};
  try {
    return JSON.parse(readFileSync(OPENCLAW_CONFIG, "utf8").replace(/\/\/[^\n]*/g, "")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getNested(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function defaultAgentModel(config: Record<string, unknown>) {
  const agents = record(config.agents);
  const list = Array.isArray(agents.list) ? agents.list.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>> : [];
  const agent = list.find((item) => item.default === true) ?? list[0];
  return typeof agent?.model === "string"
    ? agent.model
    : typeof getNested(config, "agents.defaults.model.primary") === "string"
      ? getNested(config, "agents.defaults.model.primary") as string
      : typeof getNested(config, "agents.defaults.model") === "string"
        ? getNested(config, "agents.defaults.model") as string
        : "";
}

function configuredModelProviders(config: Record<string, unknown>, extraRefs: string[] = []) {
  const configuredProviders = record(getNested(config, "models.providers"));
  const providers = new Map<string, { name: string; models: Array<{ id: string; name?: string }>; source?: string; isUserDefined?: boolean }>();
  for (const [slug, rawProvider] of Object.entries(configuredProviders)) {
    const provider = record(rawProvider);
    const models = modelOptions(provider.models);
    if (!models.length) continue;
    providers.set(slug, {
      name: typeof provider.name === "string" ? provider.name : providerName(slug),
      models,
      source: "~/.openclaw/openclaw.json",
      isUserDefined: true,
    });
  }
  for (const ref of [...configuredModelRefs(config), ...extraRefs]) {
    const parsed = splitModelRef(ref);
    if (!parsed) continue;
    const existing = providers.get(parsed.provider);
    if (existing) {
      if (!existing.models.some((model) => model.id === parsed.model)) existing.models.unshift({ id: parsed.model });
    } else {
      providers.set(parsed.provider, {
        name: providerName(parsed.provider),
        models: [{ id: parsed.model }],
        source: "~/.openclaw/openclaw.json",
        isUserDefined: true,
      });
    }
  }
  return providers;
}

function openClawModelSelection(profile: AgentProfile) {
  const config = readOpenClawConfig();
  const profileProvider = profile.provider?.trim() || "";
  const profileModel = profile.model?.trim() || "";
  const profilePair = profileProvider && profileModel
    ? `${profileProvider}/${profileModel}`
    : "";
  const configuredDefault = defaultAgentModel(config);
  const providers = configuredModelProviders(config, profilePair ? [profilePair] : []);
  const current = profilePair || configuredDefault;
  const parsed = current ? splitModelRef(current) : null;
  const firstProvider = providers.entries().next().value as [string, { models: Array<{ id: string }> }] | undefined;
  const provider = parsed?.provider ?? firstProvider?.[0] ?? profileProvider;
  const model = parsed?.model ?? firstProvider?.[1]?.models[0]?.id ?? profileModel;
  if (provider && model && !providers.has(provider)) {
    providers.set(provider, {
      name: providerName(provider),
      models: [{ id: model }],
      source: "current-agent-model",
      isUserDefined: true,
    });
  } else if (provider && model && !providers.get(provider)?.models.some((item) => item.id === model)) {
    providers.get(provider)?.models.unshift({ id: model });
  }
  return {
    provider,
    model,
    providers: [...providers.entries()].map(([slug, item]) => ({
      slug,
      name: item.name,
      models: item.models,
      totalModels: item.models.length,
      isCurrent: slug === provider,
      isUserDefined: item.isUserDefined,
      source: item.source,
    })),
  };
}

function providerName(slug: string) {
  const known = new Map(Object.entries({
    openai: "OpenAI",
    "openai-codex": "OpenAI Codex",
    xai: "xAI",
    anthropic: "Anthropic",
    google: "Google",
    "lm-studio": "Local OpenAI",
    openrouter: "OpenRouter",
  }));
  if (known.has(slug)) return known.get(slug) as string;
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.toLowerCase() === "ai" ? "AI" : part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || slug;
}

function modelOptions(value: unknown): Array<{ id: string; name?: string }> {
  if (Array.isArray(value)) {
    return value
      .map((model) => typeof model === "string" ? { id: model } : record(model))
      .map((model) => ({
        id: typeof model.id === "string" ? model.id : "",
        name: typeof model.name === "string" ? model.name : undefined,
      }))
      .filter((model) => model.id);
  }
  const models = record(value);
  return Object.entries(models)
    .map(([id, meta]) => ({ id, name: typeof record(meta).name === "string" ? record(meta).name as string : undefined }))
    .filter((model) => model.id);
}

function configuredModelRefs(config: Record<string, unknown>) {
  const refs = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && splitModelRef(value)) refs.add(value);
  };
  add(defaultAgentModel(config));
  for (const agent of Array.isArray(record(config.agents).list) ? record(config.agents).list as unknown[] : []) {
    add(record(agent).model);
  }
  for (const value of Object.keys(record(getNested(config, "agents.defaults.models")))) add(value);
  return [...refs];
}

function splitModelRef(value: string) {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash >= value.length - 1) return null;
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}

export const openClawAdapter: RuntimeAdapter = {
  runtime: "openclaw",
  label: "OpenClaw",
  kind: "gateway",
  capabilities: {
    status: true,
    chat: true,
    modelSelection: true,
  },
  defaultProfile: {
    gatewayUrl: "ws://127.0.0.1:18789",
    agentId: "main",
    provider: "",
    model: "",
  },
  async getStatus(profile) {
    return {
      ok: existsSync(OPENCLAW_CONFIG),
      runtime: "openclaw",
      modelSelection: openClawModelSelection(profile),
    };
  },
};
