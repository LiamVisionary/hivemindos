#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const routing = await import(
  new URL("../src/lib/config/openai-provider-routing.ts", import.meta.url)
).catch(() => null);
const profileConfiguration = await import(
  new URL(
    "../src/lib/config/agent-profile-configuration.ts",
    import.meta.url,
  )
).catch(() => null);

assert.ok(routing, "the canonical OpenAI provider-routing matrix must exist");
assert.ok(
  profileConfiguration,
  "agent profile routing changes must carry synchronization revisions",
);

const stampedPatch = profileConfiguration.stampAgentProfileConfigurationPatch(
  { provider: "openai-codex", model: "gpt-5.4" },
  200,
);
assert.equal(stampedPatch.configurationUpdatedAt, 200);
const currentOAuthProfile = {
  id: "queen",
  name: "Queen",
  runtime: "hermes",
  gatewayUrl: "http://127.0.0.1:8642",
  provider: "openai-codex",
  model: "gpt-5.4",
  configurationUpdatedAt: 200,
};
const staleApiProfile = {
  ...currentOAuthProfile,
  name: "Queen from stale client",
  provider: "openai-api",
  model: "gpt-4o-mini",
  configurationUpdatedAt: 100,
};
const staleMerge = profileConfiguration.mergeAgentProfileConfiguration(
  currentOAuthProfile,
  staleApiProfile,
);
assert.equal(staleMerge.name, "Queen from stale client");
assert.equal(staleMerge.provider, "openai-codex");
assert.equal(staleMerge.model, "gpt-5.4");
assert.equal(staleMerge.configurationUpdatedAt, 200);
const unversionedDowngrade =
  profileConfiguration.mergeAgentProfileConfiguration(
    { ...currentOAuthProfile, configurationUpdatedAt: undefined },
    {
      ...staleApiProfile,
      configurationUpdatedAt: undefined,
    },
  );
assert.equal(
  unversionedDowngrade.provider,
  "openai-codex",
  "an old unversioned snapshot cannot downgrade OAuth to API-key billing",
);
const explicitNewerApiSelection =
  profileConfiguration.mergeAgentProfileConfiguration(
    currentOAuthProfile,
    { ...staleApiProfile, configurationUpdatedAt: 300 },
  );
assert.equal(
  explicitNewerApiSelection.provider,
  "openai-api",
  "a newer explicit profile edit remains representable",
);
const mergedSnapshot = JSON.parse(
  profileConfiguration.mergeSerializedAgentProfileSnapshot(
    JSON.stringify([
      currentOAuthProfile,
      {
        id: "removed",
        name: "Removed",
        runtime: "hermes",
        gatewayUrl: "http://127.0.0.1:8642",
      },
    ]),
    JSON.stringify([staleApiProfile]),
    400,
  ),
);
assert.equal(mergedSnapshot.length, 1, "full snapshots can still delete agents");
assert.equal(mergedSnapshot[0].provider, "openai-codex");
assert.equal(mergedSnapshot[0].name, "Queen from stale client");

const oauthDefault = routing.choosePreferredOpenAiChatRoute({
  oauthConfigured: true,
  preferApiKey: false,
  requestedModel: "gpt-4o-mini",
});
assert.deepEqual(oauthDefault, {
  auth: "oauth",
  model: "gpt-5.4",
}, "connected OAuth must win and select an OAuth-served model");

const oauthRequestedModel = routing.choosePreferredOpenAiChatRoute({
  oauthConfigured: true,
  preferApiKey: false,
  requestedModel: "gpt-5.4",
});
assert.deepEqual(oauthRequestedModel, {
  auth: "oauth",
  model: "gpt-5.4",
}, "an OAuth-served requested model must be preserved");

const explicitApiKey = routing.choosePreferredOpenAiChatRoute({
  oauthConfigured: true,
  preferApiKey: true,
  requestedModel: "gpt-4o-mini",
});
assert.deepEqual(explicitApiKey, {
  auth: "api-key",
  model: "gpt-4o-mini",
}, "OPENAI_PREFER_API_KEY must remain the explicit override");

const disconnected = routing.choosePreferredOpenAiChatRoute({
  oauthConfigured: false,
  preferApiKey: false,
  requestedModel: "gpt-4o-mini",
});
assert.deepEqual(disconnected, {
  auth: "api-key",
  model: "gpt-4o-mini",
}, "the API key remains the fallback when OAuth is disconnected");

const oauthRuntimeProfile = routing.openAiOAuthRuntimeProfile(
  {
    id: "stale-direct-agent",
    runtime: "hivemind-os",
    provider: "openai-api",
    model: "gpt-4o-mini",
    gatewayUrl: "https://api.openai.com/v1",
    token: "must-not-survive",
  },
  "gpt-5.4",
);
assert.equal(oauthRuntimeProfile.runtime, "hermes");
assert.equal(oauthRuntimeProfile.provider, "openai-codex");
assert.equal(oauthRuntimeProfile.model, "gpt-5.4");
assert.equal(oauthRuntimeProfile.gatewayUrl, "http://127.0.0.1:8642");
assert.equal(oauthRuntimeProfile.chatPath, "/chat");
assert.equal(oauthRuntimeProfile.token, undefined);
assert.equal(
  routing.openAiOAuthRuntimeGateway({
    runtime: "codex",
    gatewayUrl: "http://127.0.0.1:8787",
  }),
  "http://127.0.0.1:8787",
  "an OAuth-routed Codex profile must keep its collector bridge",
);
assert.equal(
  routing.openAiOAuthRuntimeGateway({
    runtime: "hivemind-os",
    gatewayUrl: "https://api.openai.com/v1",
  }),
  "http://127.0.0.1:8642",
  "a direct OpenAI gateway must be replaced by the local OAuth runtime",
);
const explicitCollectorApiSelection =
  routing.resolvePreferredOpenAiAgentSelection({
    agent: { provider: "openai-api", model: "gpt-4o-mini" },
    sharedEnv: {
      OPENAI_OAUTH_REFRESH_TOKEN: "connected",
      OPENAI_PREFER_API_KEY: "1",
    },
  });
assert.equal(explicitCollectorApiSelection.auth, "api-key");
assert.equal(explicitCollectorApiSelection.profile.provider, "openai-api");
const explicitOAuthSelection = routing.resolvePreferredOpenAiAgentSelection({
  agent: { provider: "openai-codex", model: "gpt-5.4" },
  sharedEnv: {
    OPENAI_OAUTH_REFRESH_TOKEN: "connected",
    OPENAI_PREFER_API_KEY: "1",
  },
});
assert.equal(
  explicitOAuthSelection.auth,
  "oauth",
  "an explicitly OAuth-selected profile must fail closed even under a global API override",
);

const calls = [];
const oauthResult = await routing.runPreferredOpenAiChatRoute(
  {
    oauthConfigured: true,
    preferApiKey: false,
    requestedModel: "gpt-4o-mini",
  },
  {
    oauth: async (model) => {
      calls.push(`oauth:${model}`);
      return "oauth result";
    },
    apiKey: async (model) => {
      calls.push(`api-key:${model}`);
      return "api result";
    },
  },
);
assert.equal(oauthResult, "oauth result");
assert.deepEqual(calls, ["oauth:gpt-5.4"], "the OAuth route must execute without touching the API key");

const oauthFirstServices = [
  "src/lib/services/companies-goal-planner.ts",
  "src/lib/services/queen-bee/pilot-turn.ts",
  "src/lib/services/queen-bee/email-qa-reviewer.ts",
  "src/lib/services/queen-bee/issue-explainer.ts",
  "src/lib/services/x-transcript/summarize.ts",
];

for (const relativePath of oauthFirstServices) {
  const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
  assert.match(source, /runPreferredOpenAiTextTurn/, `${relativePath} must use the OAuth-first chat adapter`);
  assert.doesNotMatch(source, /api\.openai\.com\/v1\/chat\/completions/, `${relativePath} must not bypass provider routing`);
  assert.doesNotMatch(source, /transcriptionApiKey/, `${relativePath} must not use the STT key resolver for chat`);
}

const mainAgentRuntimeRoute = readFileSync(
  new URL("../src/app/api/chat/agent-runtime/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  mainAgentRuntimeRoute,
  /enforceOpenAiChatProfile/,
  "the main agent chat boundary must re-check the OAuth billing preference",
);

const voiceTurn = readFileSync(
  new URL("../src/lib/services/queen-bee/voice-turn.ts", import.meta.url),
  "utf8",
);
assert.match(
  voiceTurn,
  /runPreferredOpenAiTextTurn/,
  "Queen's conversational last-resort path must use the OAuth-first chat adapter",
);
assert.doesNotMatch(
  voiceTurn,
  /async function runOpenAiAgentTurn[\s\S]*?fetch\("https:\/\/api\.openai\.com\/v1\/chat\/completions"/,
  "Queen's agent fallback must not call the API-key endpoint directly",
);

const voiceRoute = readFileSync(
  new URL("../src/app/api/queen-bee/voice/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  voiceRoute,
  /openAiOAuthSupportsChatModel/,
  "Queen voice brain selection must use the canonical OAuth capability matrix",
);
assert.doesNotMatch(
  voiceRoute,
  /const oauthServable = \/\^\(gpt-5\|o\\d\|codex\)\/i/,
  "Queen voice brain selection must not duplicate the OAuth model-family rule",
);

const directChatFetches = [];
for (const relativePath of [
  ...oauthFirstServices,
  "src/lib/services/queen-bee/voice-turn.ts",
]) {
  const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
  if (/fetch\("https:\/\/api\.openai\.com\/v1\/chat\/completions"/.test(source)) {
    directChatFetches.push(relativePath);
  }
}
assert.deepEqual(directChatFetches, [], "feature services must not bypass the canonical OpenAI text adapter");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(check, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

const collectorSandbox = await mkdtemp(join(tmpdir(), "hive-openai-oauth-guard-"));
const collectorHome = join(collectorSandbox, "home");
const collectorArgs = join(collectorSandbox, "hermes-args.log");
const collectorStreamArgs = join(collectorSandbox, "hermes-stream-args.log");
const fakeHermes = join(collectorSandbox, "fake-hermes");
const fakeHermesPython = join(collectorSandbox, "fake-hermes-python");
const collectorPort = await freePort();
const collectorBase = `http://127.0.0.1:${collectorPort}`;
await mkdir(join(collectorHome, ".hivemindos"), { recursive: true });
await writeFile(
  join(collectorHome, ".hivemindos", ".env"),
  "OPENAI_OAUTH_REFRESH_TOKEN=test-refresh-token\n",
);
await writeFile(fakeHermes, `#!/bin/sh
printf '%s\n' "$*" >> "$HIVE_TEST_HERMES_ARGS"
case "$*" in
  *oauth-empty-test*) exit 0 ;;
esac
printf '%s\n' 'collector oauth guard response'
`);
await writeFile(fakeHermesPython, `#!/bin/sh
case "$1" in
  *hermes-hivemind-stream.py)
    shift
    printf '%s\n' "$*" >> "$HIVE_TEST_HERMES_STREAM_ARGS"
    printf '%s\n' '__HIVEMIND_HERMES_EVENT__{"type":"assistant.delta","delta":"stream oauth guard response"}'
    ;;
esac
`);
await chmod(fakeHermes, 0o755);
await chmod(fakeHermesPython, 0o755);
const collector = spawn(
  process.execPath,
  [new URL("./agent-telemetry-collector.mjs", import.meta.url).pathname],
  {
    env: {
      ...process.env,
      HOME: collectorHome,
      USERPROFILE: collectorHome,
      HERMES_BIN: fakeHermes,
      HERMES_PYTHON: fakeHermesPython,
      HIVE_TEST_HERMES_ARGS: collectorArgs,
      HIVE_TEST_HERMES_STREAM_ARGS: collectorStreamArgs,
      OPENAI_OAUTH_REFRESH_TOKEN: "",
      OPENAI_PREFER_API_KEY: "",
      OPENAI_OAUTH_CHAT_MODEL: "",
      AGENT_TELEMETRY_PORT: String(collectorPort),
      AGENT_TELEMETRY_HOST: "127.0.0.1",
      AGENT_TELEMETRY_CHAT_TIMEOUT_MS: "10000",
      HIVEMINDOS_MDNS_DISABLE: "1",
      AGENT_TELEMETRY_DISABLE_SELF_RELOAD: "1",
      AGENT_TELEMETRY_ENV_SYNC_DISABLED: "1",
      HIVE_COLLECTOR_ONLY: "1",
      HIVEMINDOS_SYNC_PATH: join(collectorSandbox, "vault"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
);

try {
  await waitFor(
    () => fetch(`${collectorBase}/health`, { signal: AbortSignal.timeout(1_000) })
      .then((response) => response.ok, () => false),
    "OAuth guard collector did not start",
  );

  const guardedResponse = await fetch(`${collectorBase}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stream: false,
      message: "oauth billing guard test",
      agent: {
        id: "stale-openai-profile",
        runtime: "hermes",
        provider: "openai-api",
        model: "gpt-4o-mini",
      },
    }),
  });
  assert.equal(guardedResponse.status, 200);
  const guardedArgs = await readFile(collectorArgs, "utf8");
  assert.match(
    guardedArgs,
    /--provider openai-codex/,
    "a stale API-key profile must be rewritten to subscription OAuth before Hermes starts",
  );
  assert.match(
    guardedArgs,
    /-m gpt-5\.4/,
    "the collector must replace an API-only model with the canonical OAuth model",
  );
  assert.doesNotMatch(
    guardedArgs,
    /--provider openai-api/,
    "the collector must never pass openai-api to Hermes while OAuth is preferred",
  );

  const invocationsBeforeEmpty = guardedArgs.trim().split("\n").length;
  const emptyResponse = await fetch(`${collectorBase}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stream: false,
      message: "oauth-empty-test",
      agent: {
        id: "oauth-no-paid-fallback",
        runtime: "hermes",
        provider: "openai-codex",
        model: "gpt-5.4",
      },
    }),
  });
  assert.equal(emptyResponse.status, 502, "an empty OAuth run should fail closed");
  const invocationsAfterEmpty = (await readFile(collectorArgs, "utf8")).trim().split("\n").length;
  assert.equal(
    invocationsAfterEmpty - invocationsBeforeEmpty,
    1,
    "an OAuth-selected run must not retry through Hermes's potentially API-billed default model",
  );

  const streamingResponse = await fetch(`${collectorBase}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stream: true,
      forceHermesCli: true,
      message: "stream oauth billing guard test",
      agent: {
        id: "stale-streaming-openai-profile",
        runtime: "hermes",
        provider: "openai-api",
        model: "gpt-4o-mini",
      },
    }),
  });
  assert.equal(streamingResponse.status, 200);
  assert.match(await streamingResponse.text(), /stream oauth guard response/);
  const streamingArgs = await readFile(collectorStreamArgs, "utf8");
  assert.match(
    streamingArgs,
    /--provider openai-codex/,
    "streaming delegated chat must enforce OAuth before Hermes starts",
  );
  assert.doesNotMatch(streamingArgs, /--provider openai-api/);
} finally {
  if (!collector.killed) collector.kill("SIGTERM");
  await rm(collectorSandbox, { recursive: true, force: true });
}

const genericProviders = readFileSync(
  new URL("../src/lib/providers.ts", import.meta.url),
  "utf8",
);
assert.match(
  genericProviders,
  /resolvePreferredOpenAiChatRoute/,
  "the generic AI SDK chat provider must use the canonical OAuth-first router",
);
assert.match(
  genericProviders,
  /openAiOAuthFetch/,
  "the generic AI SDK chat provider must reuse the canonical OAuth transport",
);
assert.doesNotMatch(genericProviders, /chatgpt\.com\/backend-api\/codex/, "OAuth backend ownership must stay in openai-oauth.ts");
assert.doesNotMatch(genericProviders, /OpenAI-Beta|originator|chatgpt-account-id/, "OAuth headers must stay in openai-oauth.ts");
const genericAgentRoute = readFileSync(
  new URL("../src/app/api/chat/agent/route.ts", import.meta.url),
  "utf8",
);
assert.match(genericAgentRoute, /await getLanguageModel\(\)/, "the generic chat route must await OAuth resolution");

function sourceFiles(directoryUrl) {
  return readdirSync(directoryUrl, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [url] : [];
  });
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
function repositoryRelativePath(url) {
  return relative(repositoryRoot, fileURLToPath(url)).split(sep).join("/");
}

const oauthBackendOwners = sourceFiles(new URL("../src/", import.meta.url))
  .filter((url) => /chatgpt\.com\/backend-api\/codex/.test(readFileSync(url, "utf8")))
  .map(repositoryRelativePath);
assert.deepEqual(
  oauthBackendOwners,
  ["src/lib/services/openai-oauth.ts"],
  "the OAuth transport must be the only source file that owns the ChatGPT backend URL",
);

const directOpenAiChatEndpoints = sourceFiles(new URL("../src/", import.meta.url))
  .filter((url) => /api\.openai\.com\/v1\/chat\/completions/.test(readFileSync(url, "utf8")))
  .map(repositoryRelativePath);
assert.deepEqual(
  directOpenAiChatEndpoints,
  ["src/lib/services/openai-preferred-chat.ts"],
  "the canonical adapter must be the only source file that owns the OpenAI chat-completions endpoint",
);

assert.doesNotMatch(
  voiceTurn,
  /transcriptionApiKey/,
  "Queen chat routing must not obtain chat credentials from the STT key resolver",
);
const typedChat = readFileSync(
  new URL("../src/lib/services/queen-bee/typed-chat-turn.ts", import.meta.url),
  "utf8",
);
assert.match(
  typedChat,
  /resolvePreferredOpenAiChatRoute/,
  "Queen typed-chat fallback selection must use the canonical OAuth-first router",
);
assert.doesNotMatch(
  typedChat,
  /transcriptionApiKey/,
  "Queen typed chat must not obtain chat credentials from the STT key resolver",
);
const capabilityFallback = readFileSync(
  new URL(
    "../src/lib/services/queen-bee/capability-fallback.ts",
    import.meta.url,
  ),
  "utf8",
);
assert.match(
  capabilityFallback,
  /resolvePreferredOpenAiChatRoute/,
  "Queen capability fallback must use the canonical OAuth-first router",
);
assert.doesNotMatch(
  capabilityFallback,
  /transcriptionApiKey/,
  "Queen capability fallback must not obtain chat credentials from the STT key resolver",
);
assert.match(
  typedChat,
  /runOpenAiOAuthChatTurnDetailed/,
  "Queen typed chat must preserve tool calls when the preferred OAuth brain answers",
);
const oauthTransport = readFileSync(
  new URL("../src/lib/services/openai-oauth.ts", import.meta.url),
  "utf8",
);
assert.match(oauthTransport, /runOpenAiOAuthChatTurnDetailed/, "the OAuth transport must expose structured turns");
assert.match(oauthTransport, /response\.output_item\.done/, "the OAuth transport must collect Responses tool calls");
assert.match(oauthTransport, /function_call/, "the OAuth transport must normalize function calls");

const transcriptService = readFileSync(
  new URL("../src/lib/services/x-transcript/x-transcript-service.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  transcriptService,
  /yt-dlp video transcription failed/,
  "X transcript warnings must not blame yt-dlp when the downstream STT provider fails",
);
assert.doesNotMatch(
  transcriptService,
  /Video download via X API failed/,
  "X transcript warnings must not blame the X download when fallback STT fails",
);

const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
assert.match(packageJson, /"test:openai-oauth-preference"/, "package scripts must expose the OAuth preference guard");
const testGate = readFileSync(new URL("./test-gate.mjs", import.meta.url), "utf8");
assert.match(testGate, /"test:openai-oauth-preference"/, "the repository gate must run the OAuth preference guard");

console.log("OpenAI OAuth preference contract ok");
