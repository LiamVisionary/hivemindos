#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const fixtureDir = await mkdtemp(join(tmpdir(), "hivemind-codex-models-"));
const fakeCodexPath = join(fixtureDir, "codex");

const fakeCodexSource = `#!/usr/bin/env node
const readline = require("node:readline");

const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("codex-cli fixture");
  process.exit(0);
}
if (args[0] === "login" && args[1] === "status") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
if (args[0] !== "app-server" || args[1] !== "--stdio") process.exit(2);

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 1 && message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: 1, result: { userAgent: "fixture" } }) + "\\n");
    return;
  }
  if (message.id === 2 && message.method === "model/list") {
    if (message.params?.includeHidden !== false) process.exit(3);
    process.stdout.write(JSON.stringify({
      id: 2,
      result: {
        data: [
          { model: "gpt-fixture-default", displayName: "Fixture Default", description: "Default Codex model", hidden: false, isDefault: true },
          { model: "gpt-fixture-fast", displayName: "Fixture Fast", description: "Fast Codex model", hidden: false, isDefault: false },
        ],
        nextCursor: null,
      },
    }) + "\\n");
  }
});
`;

try {
  await writeFile(fakeCodexPath, fakeCodexSource, { mode: 0o755 });
  await chmod(fakeCodexPath, 0o755);
  process.env.CODEX_BIN = fakeCodexPath;

  const { readCodexRuntimeIntegrationStatus } = await import("./lib/codex-app-server-models.mjs");
  const collectorStatus = await readCodexRuntimeIntegrationStatus({
    command: fakeCodexPath,
    env: process.env,
    capabilities: { modelSelection: true },
  });
  assert.equal(collectorStatus.ok, true);
  assert.equal(collectorStatus.modelSelection.model, "gpt-fixture-default");
  assert.equal(collectorStatus.modelSelection.providers[0].totalModels, 2);

  const { codexAdapter } = await import("../src/lib/services/runtime-adapters/cli-runtimes.ts");
  const blankProfileStatus = await codexAdapter.getStatus?.({
    id: "codex-test",
    name: "Codex Test",
    runtime: "codex",
    provider: "openai-codex",
    model: "",
  }, {});

  assert.equal(blankProfileStatus?.ok, true);
  assert.equal(blankProfileStatus?.modelSelection?.model, "gpt-fixture-default");
  assert.equal(blankProfileStatus?.modelSelection?.providers?.[0]?.totalModels, 2);
  assert.deepEqual(
    blankProfileStatus?.modelSelection?.providers?.[0]?.models?.map((model) => model.id),
    ["gpt-fixture-default", "gpt-fixture-fast"],
  );

  const pinnedProfileStatus = await codexAdapter.getStatus?.({
    id: "codex-pinned",
    name: "Codex Pinned",
    runtime: "codex",
    provider: "openai-codex",
    model: "gpt-fixture-pinned",
  }, {});
  assert.equal(pinnedProfileStatus?.modelSelection?.model, "gpt-fixture-pinned");
  assert.deepEqual(
    pinnedProfileStatus?.modelSelection?.providers?.[0]?.models?.map((model) => model.id),
    ["gpt-fixture-pinned", "gpt-fixture-default", "gpt-fixture-fast"],
  );

  const collectorSource = await readFile(new URL("./agent-telemetry-collector.mjs", import.meta.url), "utf8");
  assert.match(collectorSource, /async function codexIntegrationStatus/);
  assert.match(collectorSource, /runtimeName === "codex" && !body\.action[\s\S]*codexIntegrationStatus\(body\.agent/);
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
}

console.log("Codex runtime model discovery tests passed");
