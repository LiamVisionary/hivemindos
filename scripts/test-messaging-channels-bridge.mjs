import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Native TS type-stripping + `@/` alias + `server-only` stub via the shared
// loader, then dynamic-import the module under test (the repo's standard
// hermetic-suite pattern). Run with: node scripts/test-messaging-channels-bridge.mjs
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const { listMessagingChannels, sendHiveMessage } = await import("../src/lib/services/messaging/channels.ts");

const tmp = await mkdtemp(join(tmpdir(), "hive-messaging-bridge-"));
const priorHermesBin = process.env.HERMES_BIN;

try {
  const vault = join(tmp, "vault");
  const hermesBin = join(tmp, "hermes");
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "AGENTS.md"), "# Test vault\n");
  await writeFile(
    hermesBin,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "if (args.join(' ') === 'send -l --json') {",
      "  console.log(JSON.stringify({ platforms: { telegram: [{ id: '123456789', name: 'Liam Test', type: 'dm', thread_id: null }] } }));",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'send' && args[1] === '--to' && args[3] === '--json') {",
      "  console.log(JSON.stringify({ ok: true, id: 'fake-message-1' }));",
      "  process.exit(0);",
      "}",
      "console.error(`unexpected hermes args: ${args.join(' ')}`);",
      "process.exit(2);",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  process.env.HERMES_BIN = hermesBin;

  const runtimeAgents = [{
    id: "hermes-test",
    name: "Hermes",
    runtime: "hermes",
    agentId: "local-hermes",
    localDataDir: "~/.hermes",
    machineName: "Test Mac",
  }];

  const vaultOnly = await listMessagingChannels({ vaultPath: vault });
  assert.equal(vaultOnly.channels.length, 0, "runtime channels stay opt-in");

  const bridged = await listMessagingChannels({
    vaultPath: vault,
    includeRuntimeChannels: true,
    runtimeAgents,
  });
  assert.equal(bridged.channels.length, 1);
  const channel = bridged.channels[0];
  assert.equal(channel.provider, "telegram");
  assert.equal(channel.source?.kind, "hermes");
  assert.equal(channel.delivery?.kind, "hermes-send");
  assert.equal(channel.readOnly, true);
  assert.equal(channel.agentId, "hermes-test");

  const result = await sendHiveMessage({
    vaultPath: vault,
    includeRuntimeChannels: true,
    runtimeAgents,
    channelId: channel.id,
    message: "bridge smoke",
  });
  assert.equal(result.ok, true);
  assert.equal(result.providerMessageId, "fake-message-1");

  const settings = JSON.parse(
    await readFile(
      join(vault, "Operations", "Brain Services", "Messaging Channels", "messaging-channels.json"),
      "utf8",
    ),
  );
  assert.deepEqual(settings.channels, [], "Hermes-discovered channels are not persisted into the vault registry");
} finally {
  if (priorHermesBin === undefined) delete process.env.HERMES_BIN;
  else process.env.HERMES_BIN = priorHermesBin;
  await rm(tmp, { recursive: true, force: true });
}

console.log("messaging channels bridge regression passed");
