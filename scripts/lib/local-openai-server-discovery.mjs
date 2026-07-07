export const COMMON_LOCAL_OPENAI_SERVER_PORTS = [1234, 1244, 8000, 8080, 11434];

export function localOpenAiBasePort(value) {
  try {
    const parsed = new URL(value);
    const portNumber = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    return Number.isInteger(portNumber) ? portNumber : undefined;
  } catch {
    return undefined;
  }
}

export function localOpenAiServerKindForPort(portValue) {
  if (portValue === 1234) return "lm-studio";
  if (portValue === 1244) return "llama-cpp";
  if (portValue === 11434) return "ollama";
  if (portValue === 8000 || portValue === 8080) return "vllm";
  return "openai-compatible";
}

export function localOpenAiServerLabel(kind, portValue) {
  if (kind === "lm-studio") return "LM Studio server";
  if (kind === "llama-cpp") return "llama.cpp server";
  if (kind === "ollama") return "Ollama server";
  if (kind === "vllm") return "vLLM server";
  return portValue ? `OpenAI server :${portValue}` : "OpenAI-compatible server";
}

export function localOpenAiModelType(id) {
  return /(?:^|[-_/])embed(?:ding)?(?:[-_/]|$)|text-embedding/i.test(id) ? "embedding" : "llm";
}

export function localOpenAiServerCandidates(agent = {}, options = {}) {
  const candidates = new Set();
  const env = options.env || process.env;
  const ports = options.ports || COMMON_LOCAL_OPENAI_SERVER_PORTS;
  const defaultBaseUrl = options.defaultBaseUrl || "http://127.0.0.1:1234";
  const configuredBaseUrl =
    typeof options.baseUrlForAgent === "function"
      ? options.baseUrlForAgent(agent)
      : agent?.gatewayUrl || defaultBaseUrl;
  const add = (value) => {
    const base = String(value || "").trim().replace(/\/+$/, "");
    if (base) candidates.add(base);
  };
  add(configuredBaseUrl);
  add(env.LOCAL_OPENAI_BASE_URL);
  add(env.NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL);
  for (const portValue of ports) add(`http://127.0.0.1:${portValue}`);
  return [...candidates];
}

export async function discoverLocalOpenAiServer(baseUrl, options = {}) {
  const fetchJsonWithTimeout = options.fetchJsonWithTimeout;
  if (typeof fetchJsonWithTimeout !== "function") {
    throw new Error("discoverLocalOpenAiServer requires fetchJsonWithTimeout.");
  }
  const portValue = localOpenAiBasePort(baseUrl);
  const kind = localOpenAiServerKindForPort(portValue);
  const statusPath = "/v1/models";
  const chatPath = "/v1/chat/completions";
  const checkedAt = new Date().toISOString();
  try {
    const payload = await fetchJsonWithTimeout(
      `${baseUrl}${statusPath}`,
      { headers: { Accept: "application/json" } },
      options.timeoutMs || 2_500,
    );
    const models = Array.isArray(payload.data)
      ? payload.data
          .map((model) => String(model?.id || "").trim())
          .filter(Boolean)
          .map((id) => ({
            id,
            displayName: id,
            type: localOpenAiModelType(id),
            loaded: true,
          }))
      : [];
    if (!models.length) return null;
    return {
      id: `${kind}:${baseUrl}`,
      label: localOpenAiServerLabel(kind, portValue),
      kind,
      baseUrl,
      chatPath,
      statusPath,
      port: portValue,
      reachable: true,
      models,
      checkedAt,
    };
  } catch {
    return null;
  }
}

export async function discoverLocalOpenAiServers(agent = {}, options = {}) {
  const servers = (await Promise.all(
    localOpenAiServerCandidates(agent, options).map((baseUrl) =>
      discoverLocalOpenAiServer(baseUrl, options),
    ),
  )).filter((server) => server?.reachable && server.models?.length);
  const byBase = new Map();
  for (const server of servers) {
    if (!byBase.has(server.baseUrl)) byBase.set(server.baseUrl, server);
  }
  return [...byBase.values()];
}
