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
process.env.HIVE_ENV_FILE = join(tempRoot, "empty.env");

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
  process.env.HIVEMINDOS_AGENT_MAILBOX_API_URL = "https://mailbox-broker.example.test";
  process.env.HIVEMINDOS_AGENT_MAILBOX_API_TOKEN = "fixture-token";
  const unimplementedManagedProvider = await service.readAgentMailboxProviderStatus();
  assert.notEqual(unimplementedManagedProvider.id, "hivemindos-managed", "an endpoint setting alone must not advertise an unimplemented managed mailbox provisioner as ready");
  assert.equal(unimplementedManagedProvider.ready, false);
  delete process.env.HIVEMINDOS_AGENT_MAILBOX_API_URL;
  delete process.env.HIVEMINDOS_AGENT_MAILBOX_API_TOKEN;

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

  const agentMailProvider = {
    id: "agentmail",
    name: "AgentMail",
    ready: true,
    canProvision: true,
    canSendLiveInternetMail: true,
    canReceiveLiveInternetMail: true,
    detail: "AgentMail fixture is ready.",
    domain: "agentmail.to",
    agentmail: { apiBaseUrl: "https://api.agentmail.to" },
    blockers: [],
    requiredActions: [],
    evidence: [{ key: "agentmail-fixture", ok: true, detail: "AgentMail fixture provider injected by test." }],
  };
  const agentMailCreated = await service.createAgentMailbox(
    { agentId: "agent-beta", agentName: "Beta Mail" },
    {
      now: () => new Date("2026-06-25T03:00:57.000Z"),
      providerStatus: agentMailProvider,
      provisionMailbox: async (input) => {
        assert.equal(input.address, "agent-beta-mail@agentmail.to");
        assert.equal(input.providerStatus.agentmail.apiBaseUrl, "https://api.agentmail.to");
        return { address: "agent-beta-mail@agentmail.to", detail: "Fixture AgentMail inbox created.", providerResourceIds: { inboxId: "agent-beta-mail@agentmail.to" } };
      },
    },
  );
  assert.equal(agentMailCreated.ok, true);
  assert.equal(agentMailCreated.mailbox.providerId, "agentmail");
  assert.equal(agentMailCreated.mailbox.providerResourceIds.inboxId, "agent-beta-mail@agentmail.to");

  const originalAgentMailApiKey = process.env.AGENTMAIL_API_KEY;
  const originalFetchForProvision = globalThis.fetch;
  let agentMailPostBody;
  process.env.AGENTMAIL_API_KEY = "fixture-agentmail-token";
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://api.agentmail.to/v0/inboxes");
    assert.equal(init.method, "POST");
    agentMailPostBody = JSON.parse(String(init.body || "{}"));
    assert.equal(agentMailPostBody.username, "agent-gamma-sales");
    assert.match(agentMailPostBody.client_id, /^[A-Za-z0-9._~-]+$/);
    assert.doesNotMatch(agentMailPostBody.client_id, /:/);
    assert.match(agentMailPostBody.client_id, /^hivemindos-agent-mailbox-/);
    return new Response(JSON.stringify({
      inbox_id: "agent-gamma-sales@agentmail.to",
      email: "agent-gamma-sales@agentmail.to",
      client_id: agentMailPostBody.client_id,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const safeClientIdCreated = await service.createAgentMailbox(
      { agentId: "agent:gamma/sales team", agentName: "Gamma Sales" },
      {
        now: () => new Date("2026-07-07T14:44:00.000Z"),
        providerStatus: agentMailProvider,
      },
    );
    assert.equal(safeClientIdCreated.ok, true);
    assert.equal(safeClientIdCreated.mailbox.providerResourceIds.clientId, agentMailPostBody.client_id);
  } finally {
    globalThis.fetch = originalFetchForProvision;
    if (originalAgentMailApiKey === undefined) delete process.env.AGENTMAIL_API_KEY;
    else process.env.AGENTMAIL_API_KEY = originalAgentMailApiKey;
  }

  const persisted = JSON.parse(await readFile(process.env.HIVEMINDOS_AGENT_MAILBOX_STORE_PATH, "utf8"));
  assert.equal(persisted.mailboxes.length, 3);
  assert.doesNotMatch(JSON.stringify(persisted), /password|secret|token/i, "mailbox store should not persist provider secrets");

  const routeSource = readFileSync("src/app/api/agents/mailbox/route.ts", "utf8");
  assert.match(routeSource, /readAgentMailboxOverview/);
  assert.match(routeSource, /createAgentMailbox/);
  const serviceSource = readFileSync("src/lib/services/agent-mailboxes.ts", "utf8");
  assert.match(serviceSource, /AGENTMAIL_API_KEY/);
  assert.match(serviceSource, /\/v0\/inboxes/);

  const originalFetch = globalThis.fetch;
  const originalCloudflareToken = process.env.CLOUDFLARE_API_TOKEN;
  const originalCloudflareAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  let fetchCalls = 0;
  process.env.CLOUDFLARE_API_TOKEN = "fixture-token";
  process.env.CLOUDFLARE_ACCOUNT_ID = "fixture-account";
  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    throw new Error(`Unexpected network call while reading company mailboxes: ${String(url)}`);
  };
  try {
    const companyMail = await service.readCompanyEmailThreads({
      agentIds: ["agent-without-cloudflare-mailbox"],
      companyId: "company-without-cloudflare-mailbox",
      totalLimit: 10,
    });
    assert.equal(fetchCalls, 0, "companies with no Cloudflare mailboxes must not run the live Cloudflare inbox status probe");
    const cloudflare = companyMail.providers.find((provider) => provider.id === "cloudflare-agentic-inbox");
    assert.equal(cloudflare?.connected, false);
    assert.equal(cloudflare?.inboxCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCloudflareToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalCloudflareToken;
    if (originalCloudflareAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = originalCloudflareAccount;
  }

  const modalSource = readFileSync("src/features/dashboard/views/chat/AgentSettingsModal.tsx", "utf8");
  const toolsPanelSource = readFileSync("src/features/dashboard/views/chat/AgentSettingsToolsPanel.tsx", "utf8");
  assert.match(modalSource, /\/api\/agents\/mailbox/);
  assert.match(toolsPanelSource, /Create mailbox/);
  assert.match(toolsPanelSource, /Agent mailbox/);
  assert.doesNotMatch(toolsPanelSource, /Ready to create/);
  assert.doesNotMatch(modalSource, /MCP_EMAIL|IMAP|SMTP|PASSWORD|HOST/, "agent settings mailbox UI should not expose raw mail-server setup");

  console.log("Agent mailbox provisioning UX checks passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
