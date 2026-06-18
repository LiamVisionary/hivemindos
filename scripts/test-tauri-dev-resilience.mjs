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
const stopBody = functionBody(tauriDev, "stopChildren");

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

console.log("Tauri dev proxy respawns its backend and critical native reads no longer depend on late Tauri-core chunks.");
