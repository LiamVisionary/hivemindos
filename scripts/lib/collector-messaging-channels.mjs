import { createHash } from "node:crypto";

const SUPPORTED_PROVIDERS = new Set(["telegram", "discord", "slack"]);
const discoveryTimeoutMs = 6_000;
const sendTimeoutMs = 30_000;

function providerCopy(provider) {
  if (provider === "discord") {
    return { label: "Discord", credentialKind: "env-webhook-url" };
  }
  if (provider === "slack") {
    return { label: "Slack", credentialKind: "env-bot-token" };
  }
  return { label: "Telegram", credentialKind: "env-bot-token" };
}

function parseHermesMessagingTargets(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return [];
  }
  const platforms = parsed?.platforms;
  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms)) {
    return [];
  }
  const targets = [];
  for (const [platform, entries] of Object.entries(platforms)) {
    const provider = String(platform || "").trim().toLowerCase();
    if (!SUPPORTED_PROVIDERS.has(provider) || !Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const chatId = String(entry.id || entry.chat_id || "").trim();
      if (!chatId) continue;
      const threadId = String(entry.thread_id || entry.threadId || "").trim();
      const name = String(
        entry.name || entry.display_name || entry.displayName || chatId,
      ).trim();
      targets.push({
        provider,
        chatId,
        threadId: threadId || undefined,
        name: name || chatId,
        targetRef: `${provider}:${chatId}${threadId ? `:${threadId}` : ""}`,
      });
    }
  }
  return targets;
}

function runtimeMessagingChannelId(hostName, agent, targetRef) {
  const hash = createHash("sha256")
    .update(
      [hostName, agent.id || agent.agentId || agent.name || "hermes", targetRef].join(
        "\n",
      ),
    )
    .digest("hex")
    .slice(0, 16);
  return `hermes-${hash}`;
}

function selectHermesAgent(agents, agentInput, defaultHermesDir) {
  return (
    agents.find((item) => item.id === agentInput.id) ||
    agents.find((item) => item.agentId === agentInput.agentId) ||
    agents.find(
      (item) => item.runtime === "hermes" && item.agentId === "local-hermes",
    ) ||
    agents.find((item) => item.runtime === "hermes") || {
      id: "hermes-local",
      name: "Hermes",
      runtime: "hermes",
      agentId: "local-hermes",
      localDataDir: defaultHermesDir,
    }
  );
}

export function createCollectorMessagingChannelBridge({
  defaultHermesDir,
  expandHome,
  getHostname,
  localAgents,
  runHermesStdout,
  sanitizeLocalDataDir,
}) {
  const hermesMessagingEnv = (agent = {}) => {
    const hermesHome = expandHome(
      sanitizeLocalDataDir(agent.localDataDir) || defaultHermesDir,
    );
    return hermesHome ? { HERMES_HOME: hermesHome } : {};
  };

  const hermesChannel = (agent, target) => {
    const now = new Date().toISOString();
    const hostName = getHostname();
    const copy = providerCopy(target.provider);
    return {
      id: runtimeMessagingChannelId(hostName, agent, target.targetRef),
      provider: target.provider,
      label: `${copy.label} ${target.name}`,
      agentId: agent.id || agent.agentId || "hermes",
      agentName: agent.name || "Hermes",
      enabled: true,
      defaultForAgent: false,
      credentialKind: copy.credentialKind,
      target: {
        chatId: target.chatId,
        threadId: target.threadId,
        displayName: target.name,
      },
      createdAt: now,
      updatedAt: now,
      readOnly: true,
      source: {
        kind: "hermes",
        label: "Hermes",
        machineName: hostName,
        runtime: "hermes",
      },
      delivery: {
        kind: "hermes-send",
        targetRef: target.targetRef,
        machineName: hostName,
        agentLocalDataDir:
          sanitizeLocalDataDir(agent.localDataDir) || defaultHermesDir,
      },
    };
  };

  const list = async (agentInput = {}) => {
    const agent = selectHermesAgent(
      await localAgents(),
      agentInput || {},
      defaultHermesDir,
    );
    const raw = await runHermesStdout(
      ["send", "-l", "--json"],
      discoveryTimeoutMs,
      hermesMessagingEnv(agent),
    );
    return {
      ok: true,
      host: getHostname(),
      channels: parseHermesMessagingTargets(raw).map((target) =>
        hermesChannel(agent, target),
      ),
    };
  };

  const send = async (body = {}) => {
    const targetRef = String(body.targetRef || "").trim();
    const message = String(body.message || "").trim();
    if (!targetRef) {
      return { ok: false, error: "Hermes messaging target is required." };
    }
    if (!message) {
      return { ok: false, error: "Message is required." };
    }
    const raw = await runHermesStdout(
      ["send", "--to", targetRef, "--json", message],
      sendTimeoutMs,
      hermesMessagingEnv(body.agent || {}),
    );
    const payload = JSON.parse(raw || "{}");
    if (payload?.ok === false) {
      return { ok: false, error: String(payload.error || "Hermes send failed.") };
    }
    return {
      ok: true,
      message: "Sent via Hermes.",
      providerMessageId: payload?.id || payload?.message_id,
    };
  };

  return { list, send };
}
