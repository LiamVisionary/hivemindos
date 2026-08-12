#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const tempRoot = await mkdtemp(join(tmpdir(), "hivemindos-outreach-mail-"));
const outboxPath = join(tempRoot, "outbox.jsonl");
const companyId = "company-webs-fixture";
const originalFetch = globalThis.fetch;
const originalEnv = {
  MAPS_AGENCY_OUTBOX_PATH: process.env.MAPS_AGENCY_OUTBOX_PATH,
  AGENTMAIL_API_KEY: process.env.AGENTMAIL_API_KEY,
  AGENTMAIL_INBOX: process.env.AGENTMAIL_INBOX,
  HIVE_ENV_FILE: process.env.HIVE_ENV_FILE,
};

await writeFile(outboxPath, [
  {
    company_id: companyId,
    lead_id: "lead-legacy-sent",
    business_name: "Legacy Sent Restaurant",
    to: "legacy-owner@example.com",
    inbox: "liamvisionary@agentmail.to",
    subject: "A historical AgentMail send",
    body: "Historical live outreach body",
    message_id: "message-legacy",
    thread_id: "thread-legacy",
    sent_at: "2026-08-11T23:00:00.000Z",
    status: "delivered",
    provider: "agentmail",
  },
  {
    company_id: companyId,
    lead_id: "lead-replied",
    business_name: "Replying Restaurant",
    to: "owner@example.com",
    inbox: "liamvisionary@agentmail.to",
    subject: "I built a website concept for Replying Restaurant",
    body: "Original outreach body with https://preview.example.test/p/replying-restaurant",
    attachments: ["https://preview.example.test/p/replying-restaurant"],
    message_id: "message-1",
    thread_id: "thread-1",
    sent_at: "2026-08-12T01:00:00.000Z",
    external_send: true,
    status: "delivered",
  },
  {
    company_id: companyId,
    lead_id: "lead-queued",
    business_name: "Queued Restaurant",
    subject: "Queued concept",
    body: "Queued body",
    generated_at: "2026-08-12T00:00:00.000Z",
    external_send: false,
    status: "queued",
    send_blockers: ["verified recipient email missing"],
  },
].map((row) => JSON.stringify(row)).join("\n") + "\n");

process.env.MAPS_AGENCY_OUTBOX_PATH = outboxPath;
process.env.AGENTMAIL_API_KEY = "fixture-agentmail-token";
process.env.AGENTMAIL_INBOX = "liamvisionary@agentmail.to";
process.env.HIVE_ENV_FILE = join(tempRoot, "empty.env");

globalThis.fetch = async (url, init = {}) => {
  assert.equal(init.headers.Authorization, "Bearer fixture-agentmail-token");
  if (String(url).endsWith("/threads/thread-legacy")) {
    return new Response(JSON.stringify({
      thread_id: "thread-legacy",
      subject: "A historical AgentMail send",
      senders: ["liamvisionary@agentmail.to"],
      recipients: ["legacy-owner@example.com"],
      sent_timestamp: "2026-08-11T23:00:00.000Z",
      updated_at: "2026-08-11T23:00:00.000Z",
      message_count: 1,
      messages: [{ message_id: "message-legacy", from: "liamvisionary@agentmail.to", text: "Historical live outreach body" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  assert.equal(String(url), "https://api.agentmail.to/v0/inboxes/liamvisionary%40agentmail.to/threads/thread-1");
  return new Response(JSON.stringify({
    thread_id: "thread-1",
    subject: "Re: I built a website concept for Replying Restaurant",
    senders: ["liamvisionary@agentmail.to", "Owner <owner@example.com>"],
    recipients: ["Owner <owner@example.com>", "liamvisionary@agentmail.to"],
    sent_timestamp: "2026-08-12T01:00:00.000Z",
    received_timestamp: "2026-08-12T02:00:00.000Z",
    updated_at: "2026-08-12T02:00:00.000Z",
    message_count: 2,
    messages: [
      {
        message_id: "message-1",
        from: "liamvisionary@agentmail.to",
        text: "Original outreach body",
        timestamp: "2026-08-12T01:00:00.000Z",
      },
      {
        message_id: "reply-1",
        from: "Owner <owner@example.com>",
        text: "Yes, I would like to talk about the Standard package.",
        timestamp: "2026-08-12T02:00:00.000Z",
      },
    ],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

try {
  const { readMapsAgencyOutboxForCompany } = await import("../src/lib/services/company-outreach-outbox.ts");
  const result = await readMapsAgencyOutboxForCompany({ agentIds: [], companyId });

  assert.equal(result.connected, true);
  assert.match(result.note, /2 sent · 1 replied · 1 queued/);
  assert.equal(result.threads.length, 3);
  const replied = result.threads.find((thread) => thread.id.endsWith(":lead-replied"));
  assert.ok(replied);
  assert.equal(replied.direction, "mixed");
  assert.equal(replied.threadId, "thread-1");
  assert.equal(replied.messageCount, 2);
  assert.deepEqual(replied.labels, ["delivered", "reply received"]);
  assert.match(replied.preview, /Standard package/);
  assert.match(replied.body, /Latest reply:/);
  assert.match(replied.body, /Original outreach:/);
  assert.deepEqual(replied.correspondents, ["Owner <owner@example.com>"]);
  assert.doesNotMatch(JSON.stringify(result), /fixture-agentmail-token/);

  console.log("Company outreach reply tracking checks passed.");
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(tempRoot, { recursive: true, force: true });
}
