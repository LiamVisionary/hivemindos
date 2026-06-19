#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const tempRoot = await mkdtemp(join(tmpdir(), "hivemindos-agent-mailboxes-"));
process.env.HIVEMINDOS_AGENT_MAILBOX_STORE_PATH = join(tempRoot, "agent-mailboxes.json");

const service = await import("../src/lib/services/agent-mailboxes.ts");

try {
  process.env.HIVEMINDOS_AGENT_MAILBOX_PROVIDER = "disabled";
  const blocked = await service.createAgentMailbox({ agentId: "agent-alpha", agentName: "Alpha Vision" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.created, false);
  assert.equal(blocked.providerStatus.ready, false);
  assert.doesNotMatch(JSON.stringify(blocked), /MCP_EMAIL|IMAP|SMTP|PASSWORD|HOST/, "primary mailbox flow must not expose raw mail-server credential setup");
  assert.match(JSON.stringify(blocked), /provider|mailbox/i, "blocked state should explain provider readiness");

  delete process.env.HIVEMINDOS_AGENT_MAILBOX_PROVIDER;
  const readyProvider = {
    id: "cloudflare-agentic-inbox",
    name: "Fixture Mail Provider",
    ready: true,
    canProvision: true,
    canSendLiveInternetMail: true,
    canReceiveLiveInternetMail: true,
    detail: "Fixture provider is ready.",
    domain: "agents.example.test",
    cloudflare: { zoneId: "fixture-zone", workerName: "fixture-worker" },
    blockers: [],
    requiredActions: [],
    evidence: [{ key: "fixture", ok: true, detail: "Fixture provider injected by test." }],
  };
  const created = await service.createAgentMailbox(
    { agentId: "agent-alpha", agentName: "Alpha Vision" },
    {
      now: () => new Date("2026-06-19T06:31:04.000Z"),
      providerStatus: readyProvider,
      provisionMailbox: async (input) => {
        assert.equal(input.address, "agent-alpha-vision@agents.example.test");
        assert.equal(input.providerStatus.ready, true);
        return { detail: "Fixture routing rule created.", providerResourceIds: { routingRuleId: "fixture-rule-1" } };
      },
    },
  );
  assert.equal(created.ok, true);
  assert.equal(created.created, true);
  assert.equal(created.mailbox.address, "agent-alpha-vision@agents.example.test");
  assert.equal(created.mailbox.canSendLiveInternetMail, true);
  assert.equal(created.mailbox.canReceiveLiveInternetMail, true);
  assert.equal(created.mailbox.providerResourceIds.routingRuleId, "fixture-rule-1");

  const repeated = await service.createAgentMailbox({ agentId: "agent-alpha", agentName: "Alpha Vision" }, { providerStatus: readyProvider });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.created, false);
  assert.equal(repeated.mailbox.address, created.mailbox.address, "same agent should keep its persistent mailbox");

  const listed = await service.listAgentMailboxes("agent-alpha");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].address, "agent-alpha-vision@agents.example.test");

  const persisted = JSON.parse(await readFile(process.env.HIVEMINDOS_AGENT_MAILBOX_STORE_PATH, "utf8"));
  assert.equal(persisted.mailboxes.length, 1);
  assert.doesNotMatch(JSON.stringify(persisted), /password|secret|token/i, "mailbox store should not persist provider secrets");

  const routeSource = readFileSync("src/app/api/agents/mailbox/route.ts", "utf8");
  assert.match(routeSource, /readAgentMailboxOverview/);
  assert.match(routeSource, /createAgentMailbox/);

  const modalSource = readFileSync("src/features/dashboard/views/chat/AgentSettingsModal.tsx", "utf8");
  assert.match(modalSource, /\/api\/agents\/mailbox/);
  assert.match(modalSource, /Create mailbox/);
  assert.match(modalSource, /Agent mailbox/);
  assert.doesNotMatch(modalSource, /MCP_EMAIL|IMAP|SMTP|PASSWORD|HOST/, "agent settings mailbox UI should not expose raw mail-server setup");

  console.log("Agent mailbox provisioning UX checks passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
