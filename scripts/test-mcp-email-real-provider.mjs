#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { McpClient } from "./lib/mcp-email-test-client.mjs";

const ENABLED = process.env.MCP_EMAIL_REAL_E2E === "1";
const CALL_TIMEOUT_MS = Number(process.env.MCP_EMAIL_REAL_CALL_TIMEOUT_MS || "60000");
const DELIVERY_TIMEOUT_MS = Number(process.env.MCP_EMAIL_REAL_DELIVERY_TIMEOUT_MS || "180000");
const POLL_INTERVAL_MS = Number(process.env.MCP_EMAIL_REAL_POLL_INTERVAL_MS || "5000");

if (!ENABLED) {
  console.log("Skipped real MCP Email Server provider E2E. Set MCP_EMAIL_REAL_E2E=1 to run against live mailboxes.");
  process.exit(0);
}

const REQUIRED_SUFFIXES = ["EMAIL_ADDRESS", "PASSWORD", "IMAP_HOST", "SMTP_HOST"];
const missing = ["ALPHA", "BETA"].flatMap((name) =>
  REQUIRED_SUFFIXES.map((suffix) => `MCP_EMAIL_REAL_${name}_${suffix}`).filter((key) => !process.env[key]?.trim()),
);

if (missing.length > 0) {
  const preflightReport = {
    suite: "mcp-email-real-provider",
    status: "blocked",
    reason: "missing_required_env",
    missingEnvKeys: missing,
  };
  console.error("Real MCP Email Server provider E2E preflight report:");
  console.error(JSON.stringify(preflightReport, null, 2));
  if (process.env.MCP_EMAIL_REAL_REPORT_PATH) {
    await writeFile(process.env.MCP_EMAIL_REAL_REPORT_PATH, `${JSON.stringify(preflightReport, null, 2)}\n`, "utf8");
    console.error(`Real MCP Email Server provider E2E preflight report written to ${process.env.MCP_EMAIL_REAL_REPORT_PATH}`);
  }
  console.error(`Missing required real-provider email test env keys: ${missing.join(", ")}`);
  process.exit(1);
}

async function main() {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), "hivemindos-mcp-email-real-"));
  const clients = [];
  const cleanup = [];
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const alpha = readAccount("ALPHA", "real-alpha");
  const beta = readAccount("BETA", "real-beta");
  const report = {
    suite: "mcp-email-real-provider",
    status: "running",
    startedAt: new Date().toISOString(),
    runId,
    accounts: {
      alpha: { accountName: alpha.accountName, emailAddress: alpha.emailAddress, canSend: true },
      beta: { accountName: beta.accountName, emailAddress: beta.emailAddress, canSend: true },
      betaReadOnly: { accountName: "real-beta-readonly", emailAddress: beta.emailAddress, canSend: false },
    },
    sentEmails: [],
    searches: [],
    readEmails: [],
    attachmentDownloads: [],
    mailboxOperations: [],
    cleanup: [],
  };

  try {
    const alphaClient = await startRealClient("alpha", alpha, testRoot, true);
    const betaClient = await startRealClient("beta", beta, testRoot, true);
    const betaReadOnly = await startRealClient("beta-readonly", { ...beta, accountName: "real-beta-readonly" }, testRoot, false);
    clients.push(alphaClient, betaClient, betaReadOnly);

    report.toolVisibility = await assertRealToolVisibility(alphaClient, betaClient, betaReadOnly);
    report.mailboxOperations.push(await assertRealMailboxes(alphaClient, alpha.accountName));
    report.mailboxOperations.push(await assertRealMailboxes(betaClient, beta.accountName));

    const attachmentPath = path.join(testRoot, `real-provider-${runId}.txt`);
    const attachmentBody = `real-provider attachment token ${runId}\n`;
    await writeFile(attachmentPath, attachmentBody, "utf8");

    const subject = `[HivemindOS MCP real E2E ${runId}] alpha to beta`;
    const sendAlphaResult = await alphaClient.callTool(
      "send_email",
      {
        account_name: alpha.accountName,
        recipients: [beta.emailAddress],
        subject,
        body: `Real provider agent email E2E token ${runId}`,
        attachments: [attachmentPath],
      },
      CALL_TIMEOUT_MS,
    );
    report.sentEmails.push({
      label: "alpha live email to beta",
      from: alpha.emailAddress,
      to: [beta.emailAddress],
      subject,
      bodySnippet: `Real provider agent email E2E token ${runId}`,
      attachments: [path.basename(attachmentPath)],
      toolResult: sendAlphaResult,
    });

    const betaMessage = await waitForMessage(betaClient, beta.accountName, {
      subject,
      from_address: alpha.emailAddress,
      to_address: beta.emailAddress,
    });
    cleanup.push({ client: betaClient, accountName: beta.accountName, mailbox: "INBOX", emailId: betaMessage.email_id });
    report.searches.push({
      label: "beta live search for alpha email",
      account: beta.accountName,
      filters: { subject, from_address: alpha.emailAddress, to_address: beta.emailAddress },
      returned: [summarizeMetadata(betaMessage)],
    });

    const betaContent = await betaClient.callTool(
      "get_emails_content",
      {
        account_name: beta.accountName,
        email_ids: [betaMessage.email_id],
        mark_as_read: true,
      },
      CALL_TIMEOUT_MS,
    );
    assert.equal(betaContent.retrieved_count, 1);
    assert.match(betaContent.emails[0].body, new RegExp(runId));
    assert.ok(betaContent.emails[0].message_id, "live provider should expose Message-ID for replies");
    assert.deepEqual(betaContent.emails[0].attachments, [path.basename(attachmentPath)]);
    report.readEmails.push({
      label: "beta read alpha live email",
      account: beta.accountName,
      requestedEmailIds: [betaMessage.email_id],
      retrievedCount: betaContent.retrieved_count,
      returned: betaContent.emails.map(summarizeEmail),
    });

    const downloadPath = path.join(testRoot, "downloads", path.basename(attachmentPath));
    const download = await betaClient.callTool(
      "download_attachment",
      {
        account_name: beta.accountName,
        email_id: betaMessage.email_id,
        attachment_name: path.basename(attachmentPath),
        save_path: downloadPath,
      },
      CALL_TIMEOUT_MS,
    );
    assert.equal((await readFile(downloadPath, "utf8")), attachmentBody);
    assert.equal((await stat(downloadPath)).size, download.size);
    report.attachmentDownloads.push({
      label: "beta downloaded live attachment",
      account: beta.accountName,
      emailId: betaMessage.email_id,
      attachmentName: download.attachment_name,
      mimeType: download.mime_type,
      size: download.size,
      savedPath: download.saved_path,
    });

    const readonlyTools = await betaReadOnly.listTools();
    assert.equal(readonlyTools.includes("send_email"), false);
    const readonlySeen = await waitForMessage(betaReadOnly, betaReadOnly.accountName, { subject, from_address: alpha.emailAddress });
    assert.equal(readonlySeen.email_id, betaMessage.email_id, "read-only MCP process should see the same live inbox");
    report.searches.push({
      label: "beta read-only MCP process saw same live inbox message",
      account: betaReadOnly.accountName,
      filters: { subject, from_address: alpha.emailAddress },
      returned: [summarizeMetadata(readonlySeen)],
    });

    const htmlSubject = `[HivemindOS MCP real E2E ${runId}] html`;
    const sendHtmlResult = await alphaClient.callTool(
      "send_email",
      {
        account_name: alpha.accountName,
        recipients: [beta.emailAddress],
        subject: htmlSubject,
        body: `<p>Real HTML token <strong>${runId}</strong></p><script>window.bad = true</script>`,
        html: true,
      },
      CALL_TIMEOUT_MS,
    );
    report.sentEmails.push({
      label: "alpha live HTML email to beta",
      from: alpha.emailAddress,
      to: [beta.emailAddress],
      subject: htmlSubject,
      html: true,
      bodySnippet: `Real HTML token ${runId}`,
      toolResult: sendHtmlResult,
    });
    const htmlMessage = await waitForMessage(betaClient, beta.accountName, { subject: htmlSubject, from_address: alpha.emailAddress });
    cleanup.push({ client: betaClient, accountName: beta.accountName, mailbox: "INBOX", emailId: htmlMessage.email_id });
    const htmlContent = await betaClient.callTool(
      "get_emails_content",
      { account_name: beta.accountName, email_ids: [htmlMessage.email_id] },
      CALL_TIMEOUT_MS,
    );
    assert.match(htmlContent.emails[0].body, new RegExp(runId));
    assert.doesNotMatch(htmlContent.emails[0].body, /window\.bad/);
    report.searches.push({
      label: "beta live search for HTML email",
      account: beta.accountName,
      filters: { subject: htmlSubject, from_address: alpha.emailAddress },
      returned: [summarizeMetadata(htmlMessage)],
    });
    report.readEmails.push({
      label: "beta read live HTML email",
      account: beta.accountName,
      requestedEmailIds: [htmlMessage.email_id],
      retrievedCount: htmlContent.retrieved_count,
      returned: htmlContent.emails.map(summarizeEmail),
    });

    const replySubject = `[HivemindOS MCP real E2E ${runId}] beta reply`;
    const sendReplyResult = await betaClient.callTool(
      "send_email",
      {
        account_name: beta.accountName,
        recipients: [alpha.emailAddress],
        subject: replySubject,
        body: `Real provider reply token ${runId}`,
        in_reply_to: betaContent.emails[0].message_id,
        references: betaContent.emails[0].message_id,
      },
      CALL_TIMEOUT_MS,
    );
    report.sentEmails.push({
      label: "beta live reply to alpha",
      from: beta.emailAddress,
      to: [alpha.emailAddress],
      subject: replySubject,
      inReplyTo: betaContent.emails[0].message_id,
      references: betaContent.emails[0].message_id,
      bodySnippet: `Real provider reply token ${runId}`,
      toolResult: sendReplyResult,
    });
    const alphaReply = await waitForMessage(alphaClient, alpha.accountName, { subject: replySubject, from_address: beta.emailAddress });
    cleanup.push({ client: alphaClient, accountName: alpha.accountName, mailbox: "INBOX", emailId: alphaReply.email_id });
    const alphaReplyContent = await alphaClient.callTool(
      "get_emails_content",
      { account_name: alpha.accountName, email_ids: [alphaReply.email_id], mark_as_read: true },
      CALL_TIMEOUT_MS,
    );
    assert.match(alphaReplyContent.emails[0].body, new RegExp(runId));
    report.searches.push({
      label: "alpha live search for beta reply",
      account: alpha.accountName,
      filters: { subject: replySubject, from_address: beta.emailAddress },
      returned: [summarizeMetadata(alphaReply)],
    });
    report.readEmails.push({
      label: "alpha read live beta reply",
      account: alpha.accountName,
      requestedEmailIds: [alphaReply.email_id],
      retrievedCount: alphaReplyContent.retrieved_count,
      returned: alphaReplyContent.emails.map(summarizeEmail),
    });

    const draftReport = await maybeAssertDraftSave(betaClient, beta, runId, cleanup);
    if (draftReport) report.mailboxOperations.push(draftReport);
    report.cleanup = await cleanupMessages(cleanup);
    report.status = "passed";
    report.finishedAt = new Date().toISOString();

    console.log("Real MCP Email Server provider E2E passed:");
    console.log("- two live agent mailboxes sent, received, read, replied, and cleaned up test messages");
    console.log("- attachment upload/download, HTML parsing, Message-ID reply threading, mailbox listing, and read-only mode passed");
    await emitReport(report);
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    await rm(testRoot, { recursive: true, force: true });
  }
}

function readAccount(prefix, defaultName) {
  const envPrefix = `MCP_EMAIL_REAL_${prefix}_`;
  const emailAddress = requireEnv(`${envPrefix}EMAIL_ADDRESS`);
  return {
    accountName: process.env[`${envPrefix}ACCOUNT_NAME`]?.trim() || defaultName,
    fullName: process.env[`${envPrefix}FULL_NAME`]?.trim() || defaultName,
    emailAddress,
    userName: process.env[`${envPrefix}USER_NAME`]?.trim() || emailAddress,
    password: requireEnv(`${envPrefix}PASSWORD`),
    imapHost: requireEnv(`${envPrefix}IMAP_HOST`),
    imapPort: process.env[`${envPrefix}IMAP_PORT`]?.trim() || "993",
    imapSsl: process.env[`${envPrefix}IMAP_SSL`]?.trim() || "true",
    imapStartSsl: process.env[`${envPrefix}IMAP_START_SSL`]?.trim() || "false",
    imapVerifySsl: process.env[`${envPrefix}IMAP_VERIFY_SSL`]?.trim() || "true",
    smtpHost: requireEnv(`${envPrefix}SMTP_HOST`),
    smtpPort: process.env[`${envPrefix}SMTP_PORT`]?.trim() || "465",
    smtpSsl: process.env[`${envPrefix}SMTP_SSL`]?.trim() || "true",
    smtpStartSsl: process.env[`${envPrefix}SMTP_START_SSL`]?.trim() || "false",
    smtpVerifySsl: process.env[`${envPrefix}SMTP_VERIFY_SSL`]?.trim() || "true",
  };
}

async function startRealClient(label, account, testRoot, canSend) {
  const client = new McpClient({
    name: label,
    accountName: account.accountName,
    env: {
      ...process.env,
      HOME: testRoot,
      PYTHONUNBUFFERED: "1",
      MCP_EMAIL_SERVER_CONFIG_PATH: path.join(testRoot, `${label}.toml`),
      MCP_EMAIL_SERVER_ACCOUNT_NAME: account.accountName,
      MCP_EMAIL_SERVER_FULL_NAME: account.fullName,
      MCP_EMAIL_SERVER_EMAIL_ADDRESS: account.emailAddress,
      MCP_EMAIL_SERVER_USER_NAME: account.userName,
      MCP_EMAIL_SERVER_PASSWORD: account.password,
      MCP_EMAIL_SERVER_IMAP_HOST: account.imapHost,
      MCP_EMAIL_SERVER_IMAP_PORT: account.imapPort,
      MCP_EMAIL_SERVER_IMAP_SSL: account.imapSsl,
      MCP_EMAIL_SERVER_IMAP_START_SSL: account.imapStartSsl,
      MCP_EMAIL_SERVER_IMAP_VERIFY_SSL: account.imapVerifySsl,
      MCP_EMAIL_SERVER_SAVE_TO_SENT: process.env.MCP_EMAIL_REAL_SAVE_TO_SENT || "false",
      MCP_EMAIL_SERVER_SENT_FOLDER_NAME: process.env.MCP_EMAIL_REAL_SENT_FOLDER_NAME || "",
      MCP_EMAIL_SERVER_ENABLE_ATTACHMENT_DOWNLOAD: "true",
      ...(canSend
        ? {
            MCP_EMAIL_SERVER_SMTP_HOST: account.smtpHost,
            MCP_EMAIL_SERVER_SMTP_PORT: account.smtpPort,
            MCP_EMAIL_SERVER_SMTP_SSL: account.smtpSsl,
            MCP_EMAIL_SERVER_SMTP_START_SSL: account.smtpStartSsl,
            MCP_EMAIL_SERVER_SMTP_VERIFY_SSL: account.smtpVerifySsl,
          }
        : {}),
    },
  });
  await client.start();
  return client;
}

async function assertRealToolVisibility(alphaClient, betaClient, betaReadOnly) {
  const visibility = [];
  for (const client of [alphaClient, betaClient]) {
    const tools = await client.listTools();
    visibility.push({ account: client.accountName, tools });
    assert.ok(tools.includes("send_email"));
    assert.ok(tools.includes("save_to_mailbox"));
    assert.ok(tools.includes("download_attachment"));
  }
  const readOnlyTools = await betaReadOnly.listTools();
  visibility.push({ account: betaReadOnly.accountName, tools: readOnlyTools });
  assert.ok(readOnlyTools.includes("list_emails_metadata"));
  assert.ok(readOnlyTools.includes("get_emails_content"));
  assert.equal(readOnlyTools.includes("send_email"), false);
  assert.equal(readOnlyTools.includes("save_to_mailbox"), false);
  return visibility;
}

async function assertRealMailboxes(client, accountName) {
  const mailboxes = await client.callTool("list_mailboxes", { account_name: accountName }, CALL_TIMEOUT_MS);
  assert.ok(mailboxes.some((mailbox) => mailbox.name.toUpperCase() === "INBOX"), "live provider should expose INBOX");
  return {
    label: "list live provider mailboxes",
    account: accountName,
    returned: mailboxes,
  };
}

async function waitForMessage(client, accountName, filters) {
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  let lastTotal = 0;
  while (Date.now() < deadline) {
    const result = await client.callTool(
      "list_emails_metadata",
      {
        account_name: accountName,
        page_size: 10,
        ...filters,
      },
      CALL_TIMEOUT_MS,
    );
    lastTotal = result.total;
    if (result.emails.length > 0) {
      return result.emails[0];
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for live email ${JSON.stringify(filters)}; last total=${lastTotal}`);
}

async function maybeAssertDraftSave(client, account, runId, cleanup) {
  const mailbox = process.env.MCP_EMAIL_REAL_DRAFTS_MAILBOX?.trim();
  if (!mailbox) {
    return null;
  }
  const subject = `[HivemindOS MCP real E2E ${runId}] draft`;
  const toolResult = await client.callTool(
    "save_to_mailbox",
    {
      account_name: account.accountName,
      recipients: [account.emailAddress],
      subject,
      body: `Real provider draft token ${runId}`,
      mailbox,
      flags: ["\\Draft", "\\Seen", "\\Flagged"],
    },
    CALL_TIMEOUT_MS,
  );
  const draft = await waitForMessage(client, account.accountName, { mailbox, subject });
  cleanup.push({ client, accountName: account.accountName, mailbox, emailId: draft.email_id });
  return {
    label: "save live provider draft",
    account: account.accountName,
    mailbox,
    subject,
    toolResult,
    returned: [summarizeMetadata(draft)],
  };
}

async function cleanupMessages(messages) {
  if (process.env.MCP_EMAIL_REAL_KEEP_MESSAGES === "1") {
    console.log("Keeping real-provider E2E messages because MCP_EMAIL_REAL_KEEP_MESSAGES=1.");
    return messages.map((message) => ({
      account: message.accountName,
      mailbox: message.mailbox,
      emailId: message.emailId,
      status: "kept",
    }));
  }
  const results = [];
  for (const message of messages.reverse()) {
    const toolResult = await message.client.callTool(
      "delete_emails",
      {
        account_name: message.accountName,
        email_ids: [message.emailId],
        mailbox: message.mailbox,
      },
      CALL_TIMEOUT_MS,
    );
    results.push({
      account: message.accountName,
      mailbox: message.mailbox,
      emailId: message.emailId,
      status: "deleted",
      toolResult,
    });
  }
  return results;
}

async function emitReport(report) {
  const json = JSON.stringify(report, null, 2);
  console.log("Real MCP Email Server provider E2E concrete report:");
  console.log(json);
  if (process.env.MCP_EMAIL_REAL_REPORT_PATH) {
    await writeFile(process.env.MCP_EMAIL_REAL_REPORT_PATH, `${json}\n`, "utf8");
    console.log(`Real MCP Email Server provider E2E report written to ${process.env.MCP_EMAIL_REAL_REPORT_PATH}`);
  }
}

function summarizeMetadata(email) {
  return {
    emailId: email.email_id,
    messageId: email.message_id,
    subject: email.subject,
    sender: email.sender,
    recipients: email.recipients,
    date: email.date,
    attachments: email.attachments,
  };
}

function summarizeEmail(email) {
  return {
    ...summarizeMetadata(email),
    bodySnippet: snippet(email.body),
  };
}

function snippet(value) {
  return String(value || "").replace(/\s+/g, " ").slice(0, 240);
}

function requireEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
