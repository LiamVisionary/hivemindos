export type ModelFitMachine = {
  id?: string;
  name?: string;
  os?: string;
  kind?: string;
  collector?: string;
  capabilities?: { runtimes?: string[] };
  system?: {
    cpuCores?: number;
    cpuModel?: string;
    ramTotalGb?: number;
    ramPct?: number;
    platform?: string;
    arch?: string;
  };
  agents?: Array<{ runtime?: string; canChat?: boolean }>;
};

export type ModelFitRecommendation = {
  machineId: string;
  machineName: string;
  tier: "local-small" | "local-medium" | "local-large" | "hosted-or-remote";
  label: string;
  rationale: string[];
  preferredProviders: string[];
  suggestedUses: string[];
  caution?: string;
};

function runtimeNames(machine: ModelFitMachine) {
  return [
    ...(machine.capabilities?.runtimes ?? []),
    ...(machine.agents ?? []).map((agent) => agent.runtime ?? ""),
  ].map((value) => value.toLowerCase()).filter(Boolean);
}

export function recommendModelFit(machines: ModelFitMachine[]): ModelFitRecommendation[] {
  return machines.map((machine, index) => {
    const ram = machine.system?.ramTotalGb ?? 0;
    const cores = machine.system?.cpuCores ?? 0;
    const os = `${machine.os ?? ""} ${machine.system?.platform ?? ""} ${machine.system?.cpuModel ?? ""}`.toLowerCase();
    const runtimes = runtimeNames(machine);
    const hasLocalModelRuntime = runtimes.some((runtime) => /hivemind-os|openai-compatible|lm|ollama|vllm|llama|local/i.test(runtime));
    const appleSilicon = /apple|m1|m2|m3|m4|darwin|macos/.test(os);
    const linuxWorkhorse = /linux|ubuntu|debian|fedora|arch/.test(os) && (ram >= 48 || cores >= 16);

    let tier: ModelFitRecommendation["tier"] = "hosted-or-remote";
    let label = "Prefer hosted or remote inference";
    const rationale: string[] = [];
    const preferredProviders = ["Bankr LLM", "OpenRouter Adaptive", "UsePod"];
    const suggestedUses = ["chat", "research", "fallback when local model servers are unavailable"];
    let caution: string | undefined;

    if (ram >= 96 || cores >= 24 || linuxWorkhorse) {
      tier = "local-large";
      label = "Strong local model host";
      rationale.push("High RAM or CPU core count makes this a good long-context or multi-agent inference host.");
      preferredProviders.unshift("local OpenAI-compatible", "vLLM or llama.cpp server");
      suggestedUses.unshift("Hive Fusion panel member", "long research runs", "background evaluation");
    } else if (ram >= 32 || (appleSilicon && ram >= 24)) {
      tier = "local-medium";
      label = "Good local medium-model host";
      rationale.push("Memory profile can support practical local chat models when a model server is running.");
      preferredProviders.unshift("LM Studio", "Ollama", "local OpenAI-compatible");
      suggestedUses.unshift("everyday local chat", "private drafting", "small Fusion panel member");
    } else if (ram >= 12 || cores >= 8) {
      tier = "local-small";
      label = "Small local model host";
      rationale.push("Hardware can handle small local models, but hosted fallback should stay configured.");
      preferredProviders.unshift("LM Studio small models", "Ollama small models");
      suggestedUses.unshift("short private prompts", "offline fallback");
      caution = "Avoid heavy long-context research or large multimodal models on this machine.";
    } else {
      rationale.push("Machine facts do not show enough RAM or CPU headroom for reliable local inference.");
      caution = "Use this machine as a controller or agent shell, not the main model host.";
    }

    if (!hasLocalModelRuntime && tier !== "hosted-or-remote") {
      rationale.push("No local model runtime is visible yet; install or enable one before selecting local inference.");
    }
    if ((machine.system?.ramPct ?? 0) > 85) {
      caution = "RAM is currently under pressure; prefer hosted fallback until load drops.";
    }

    return {
      machineId: machine.id || `machine-${index + 1}`,
      machineName: machine.name || `Machine ${index + 1}`,
      tier,
      label,
      rationale,
      preferredProviders: [...new Set(preferredProviders)].slice(0, 5),
      suggestedUses: [...new Set(suggestedUses)].slice(0, 5),
      caution,
    };
  });
}
