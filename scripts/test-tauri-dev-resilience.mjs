import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function functionBody(content, name) {
  const start = content.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const braceStart = content.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < content.length; index += 1) {
    if (content[index] === "{") depth += 1;
    if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(braceStart + 1, index);
    }
  }
  throw new Error(`Could not parse function body for ${name}`);
}

const tauriDev = source("scripts/tauri-next-dev.mjs");
const devExitBody = functionBody(tauriDev, "handleDevServerExit");
const proxyTimeoutBody = functionBody(tauriDev, "proxyTimeoutForRequest");
const stopBody = functionBody(tauriDev, "stopChildren");
const brainGraphRefresh = source("src/features/dashboard/hooks/brain-graph-refresh.ts");

assert.match(
  tauriDev,
  /reusing the dev server[\s\S]*setInterval\(\(\) => \{\}, 60_000\);[\s\S]*await new Promise\(\(\) => \{\}\);/,
  "A Tauri window attached to the shared dev server must keep a real event-loop handle so Node does not exit with unsettled top-level await.",
);

assert.match(
  tauriDev,
  /function spawnDevServer\(\)[\s\S]*child\.on\("exit", handleDevServerExit\);[\s\S]*child\.on\("error", handleDevServerError\);/,
  "Tauri dev proxy should own and observe the dev-server child lifecycle.",
);

assert.match(
  devExitBody,
  /scheduleDevServerRespawn\(/,
  "Unexpected dev-server child exits should schedule a backend respawn.",
);

assert.doesNotMatch(
  devExitBody,
  /proxyServer\.close\(|process\.exit\(/,
  "A dev-server child exit must not close the proxy or exit the Tauri dev parent.",
);

assert.match(
  stopBody,
  /stopping = true;[\s\S]*child && !child\.killed[\s\S]*voiceWorker && !voiceWorker\.killed/,
  "Intentional shutdown should still stop both the dev-server child and voice worker.",
);

assert.match(
  tauriDev,
  /var routeLoadingTimeoutMs = 30000;/,
  "Tauri dev route loading recovery should not hard-reload during ordinary cold route compilation.",
);

assert.match(
  proxyTimeoutBody,
  /clientRequest\.url\?\.startsWith\("\/api\/queen-bee\/chat"\)[\s\S]*return 130_000;/,
  "Queen Bee text chat should use a route name and timeout budget distinct from the legacy voice endpoint.",
);

assert.match(
  proxyTimeoutBody,
  /clientRequest\.url\?\.startsWith\("\/api\/integrations\/x-transcript"\)[\s\S]*return 330_000;/,
  "X transcript requests must outlive the route's five-minute backend budget instead of inheriting the generic 60-second API timeout.",
);

assert.match(
  proxyTimeoutBody,
  /clientRequest\.url\?\.startsWith\("\/api\/hive-compute\/marketplace"\)[\s\S]*return 11 \* 60_000;/,
  "Hive Compute's warmed multi-model benchmark must outlive the generic 60-second API proxy budget.",
);

const nativeInvoke = source("src/lib/native/invoke.ts");
assert.match(
  nativeInvoke,
  /^import \{ invoke \} from "@tauri-apps\/api\/core";/m,
  "The native invoke bridge should be statically bundled instead of fetched as a late dynamic chunk.",
);

for (const path of [
  "src/lib/native/brain-graph.ts",
  "src/lib/native/brain-skills.ts",
  "src/lib/services/dashboard-state-client.ts",
]) {
  const content = source(path);
  assert.doesNotMatch(
    content,
    /await import\("@tauri-apps\/api\/core"\)/,
    `${path} must not lazy-load @tauri-apps/api/core after the dev backend may be down.`,
  );
  assert.match(
    content,
    /invokeNative/,
    `${path} should use the shared static native invoke bridge.`,
  );
}

assert.match(
  brainGraphRefresh,
  /const BRAIN_GRAPH_RETRY_DELAYS_MS = \[1_000, 2_000, 4_000\] as const;/,
  "Brain graph loading should retry transient dev proxy outages with bounded backoff.",
);

assert.match(
  brainGraphRefresh,
  /code\.startsWith\("DEV_PROXY_"\)/,
  "Brain graph loading should recognize structured dev proxy fallback errors as transient.",
);

assert.match(
  brainGraphRefresh,
  /await waitForBrainGraphRetry\(retryDelay\);/,
  "Brain graph loading should keep the user in a retrying state before surfacing a transient outage.",
);

console.log("Tauri dev proxy respawns its backend, critical native reads avoid late Tauri-core chunks, and Brain graph loading retries transient proxy outages.");
