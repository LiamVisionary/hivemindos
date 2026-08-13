#!/usr/bin/env node
// Hermetic coverage for agent-scoped MCP registration.
//
// The point of the whole feature: an agent must present ITS OWN credential, not
// the machine-wide dashboard device token. If an agent-scoped registration still
// carried the device token, the agent would authenticate as the operator and its
// authority level would mean nothing. These assertions are what stop that
// regressing silently.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { verifyAgentAuthToken } = await import("../src/lib/utils/agent-auth-token.ts");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "z".repeat(48);
const home = await mkdtemp(join(tmpdir(), "hivemind-agent-mcp-"));

// A minimal, valid harness config for the registrar to write into.
await writeFile(join(home, ".claude.json"), JSON.stringify({ mcpServers: {} }, null, 2), "utf8");

function runRegistrar(args) {
  return spawnSync(process.execPath, [join(ROOT, "scripts", "register-mcp-clients.mjs"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      HIVEMINDOS_DASHBOARD_AUTH_SECRET: SECRET,
    },
  });
}

// ------------------------------------------------- agent-scoped registration
{
  const result = runRegistrar(["--agent", "ceo-1", "--authority", "autonomous", "--targets", "claude"]);
  assert.equal(result.status, 0, `registrar failed: ${result.stderr || result.stdout}`);
  assert.match(result.stdout, /hivemind-ceo-1/, "the entry is named per agent");

  const config = JSON.parse(await readFile(join(home, ".claude.json"), "utf8"));
  const entry = config.mcpServers?.["hivemind-ceo-1"];
  assert.ok(entry, `expected a hivemind-ceo-1 server entry, got ${Object.keys(config.mcpServers ?? {}).join(", ")}`);

  assert.ok(entry.env?.HIVEMINDOS_AGENT_TOKEN, "the registration carries an agent credential");
  assert.equal(entry.env.HIVEMINDOS_AGENT_ID, "ceo-1");

  // THE assertion. An agent-scoped registration must NOT hand over the
  // machine-wide credential, or the agent authenticates as the operator.
  assert.equal(
    entry.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN,
    undefined,
    "an agent-scoped registration must not carry the machine device token",
  );

  // The minted token must verify, name this agent, and carry the level asked for.
  const verified = await verifyAgentAuthToken(SECRET, entry.env.HIVEMINDOS_AGENT_TOKEN);
  assert.deepEqual(verified, { agentId: "ceo-1", preset: "autonomous" });

  // It must not verify under a different secret.
  assert.equal(await verifyAgentAuthToken("q".repeat(48), entry.env.HIVEMINDOS_AGENT_TOKEN), null);
}

// A second agent gets its own entry and its own credential.
{
  const result = runRegistrar(["--agent", "worker-2", "--targets", "claude"]);
  assert.equal(result.status, 0, `registrar failed: ${result.stderr || result.stdout}`);
  const config = JSON.parse(await readFile(join(home, ".claude.json"), "utf8"));
  const entry = config.mcpServers?.["hivemind-worker-2"];
  assert.ok(entry, "second agent registered separately");
  const verified = await verifyAgentAuthToken(SECRET, entry.env.HIVEMINDOS_AGENT_TOKEN);
  assert.deepEqual(verified, { agentId: "worker-2", preset: "standard" }, "authority defaults to standard");
  assert.notEqual(
    entry.env.HIVEMINDOS_AGENT_TOKEN,
    config.mcpServers["hivemind-ceo-1"].env.HIVEMINDOS_AGENT_TOKEN,
    "each agent gets a distinct credential",
  );
  // The unscoped entry must be untouched by agent registrations.
  assert.equal(config.mcpServers.hivemind, undefined, "agent registration does not create the shared entry");
}

// ------------------------------------------------------------------ guards
{
  const result = runRegistrar(["--agent", "x", "--server", "xapi", "--targets", "claude"]);
  assert.notEqual(result.status, 0, "--agent is rejected for non-hivemind servers");
  assert.match(result.stderr, /only supported for the hivemind/i);
}
{
  // --remove must take the agent entry back out, so an agent can be
  // de-authorized by un-registering it.
  const result = runRegistrar(["--agent", "worker-2", "--targets", "claude", "--remove"]);
  assert.equal(result.status, 0, `removal failed: ${result.stderr || result.stdout}`);
  const config = JSON.parse(await readFile(join(home, ".claude.json"), "utf8"));
  assert.equal(config.mcpServers["hivemind-worker-2"], undefined, "the agent entry is removed");
  assert.ok(config.mcpServers["hivemind-ceo-1"], "removing one agent leaves the others registered");
}

// Note: the "no secret configured" path is covered where the failure actually
// lives — mintAgentAuthToken throws on a short/absent secret, asserted in
// test-agent-scoped-permissions.mjs. It cannot be exercised here because the
// registrar deliberately falls back to the checkout's .env.local, which on a
// real machine holds the secret.

console.log("Agent-scoped MCP registration tests passed.");
