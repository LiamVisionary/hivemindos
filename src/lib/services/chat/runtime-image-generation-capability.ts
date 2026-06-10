import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { RUNTIME_CAPABILITIES, type AgentProfile, type RuntimeCapabilities } from "@/lib/types/agent-runtime";

const IMAGE_GENERATION_SKILL_CAPABILITIES = new Set(["image-generation", "media-generation"]);

function expandHomePath(value: string) {
  const trimmed = value.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

function parseHermesImageGenerationConfig(raw: string) {
  const block = raw.match(/^image_gen:\s*\n((?:[ \t]+.*(?:\n|$))*)/m)?.[1] ?? "";
  if (!block.trim()) return null;
  const valueFor = (key: string) => {
    const match = block.match(new RegExp(`^\\s+${key}:\\s*([^\\n#]+)`, "m"));
    return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  };
  const provider = valueFor("provider");
  const model = valueFor("model");
  return provider || model ? { provider, model } : null;
}

function capabilitiesAdvertiseImageGeneration(capabilities?: RuntimeCapabilities) {
  return Boolean(capabilities?.imageGeneration)
    || Boolean(capabilities?.skillCapabilities?.some((capability) => IMAGE_GENERATION_SKILL_CAPABILITIES.has(capability)));
}

async function hermesImageGenerationDetails(profile: AgentProfile) {
  const configPaths = [
    profile.localDataDir?.trim() ? join(expandHomePath(profile.localDataDir), "config.yaml") : "",
    join(homedir(), ".hermes", "config.yaml"),
  ].filter(Boolean);
  for (const path of configPaths) {
    const raw = await readFile(path, "utf8").catch(() => "");
    const parsed = raw ? parseHermesImageGenerationConfig(raw) : null;
    if (parsed) return parsed;
  }
  return null;
}

export async function runtimeImageGenerationCapabilityContext(profile: AgentProfile) {
  const advertised = capabilitiesAdvertiseImageGeneration(RUNTIME_CAPABILITIES[profile.runtime])
    || capabilitiesAdvertiseImageGeneration(profile.runtimeCapabilities);
  if (profile.runtime !== "hermes") {
    return {
      runtime: profile.runtime,
      hasRuntimeImageGeneration: advertised,
      runtimeImageGenerationSource: advertised ? "runtime capabilities" : undefined,
    };
  }
  const details = await hermesImageGenerationDetails(profile);
  return {
    runtime: profile.runtime,
    hasRuntimeImageGeneration: Boolean(details) || advertised,
    runtimeImageGenerationProvider: details?.provider,
    runtimeImageGenerationModel: details?.model,
    runtimeImageGenerationSource: details ? "Hermes image_gen config" : advertised ? "runtime capabilities" : undefined,
  };
}
