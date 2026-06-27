#!/usr/bin/env node

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { McpClient } from "./lib/mcp-email-test-client.mjs";

const HOST = "127.0.0.1";
const DEFAULT_PASSWORD = "fixture-password";

const AGENTS = {
  alpha: {
    accountName: "agent-alpha",
    displayName: "Agent Alpha",
    email: "agent-alpha@hivemind.test",
  },
  beta: {
    accountName: "agent-beta",
    displayName: "Agent Beta",
    email: "agent-beta@hivemind.test",
  },
  readonly: {
    accountName: "agent-readonly",
    displayName: "Agent Readonly",
    email: "agent-readonly@hivemind.test",
  },
  observer: {
    accountName: "agent-observer",
    displayName: "Agent Observer",
    email: "agent-observer@hivemind.test",
  },
};

class MailStore {
  constructor(accounts) {
    this.accounts = new Map();
    for (const account of accounts) {
      this.addAccount(account.email, DEFAULT_PASSWORD);
    }
  }

  addAccount(email, password) {
    const key = normalizeAddress(email);
    if (this.accounts.has(key)) {
      return;
    }
    this.accounts.set(key, {
      email: key,
      password,
      mailboxes: new Map(),
    });
    for (const mailbox of ["INBOX", "Sent", "Drafts", "Archive", "Trash"]) {
      this.ensureMailbox(key, mailbox);
    }
  }

  authenticate(userName, password) {
    const account = this.accounts.get(normalizeAddress(userName));
    return Boolean(account && account.password === password);
  }

  ensureAccount(email) {
    const key = normalizeAddress(email);
    if (!this.accounts.has(key)) {
      this.addAccount(key, DEFAULT_PASSWORD);
    }
    return this.accounts.get(key);
  }

  ensureMailbox(email, mailboxName) {
    const account = this.ensureAccount(email);
    const name = canonicalMailboxName(account, mailboxName);
    if (!account.mailboxes.has(name)) {
      account.mailboxes.set(name, {
        name,
        uidNext: 1,
        messages: [],
      });
    }
    return account.mailboxes.get(name);
  }

  getMailbox(email, mailboxName) {
    const account = this.ensureAccount(email);
    return this.ensureMailbox(account.email, mailboxName);
  }

  listMailboxes(email) {
    const account = this.ensureAccount(email);
    return Array.from(account.mailboxes.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  append(email, mailboxName, raw, flags = [], date = new Date()) {
    const mailbox = this.getMailbox(email, mailboxName);
    const message = {
      uid: mailbox.uidNext++,
      raw: Buffer.from(raw),
      flags: new Set(flags),
      internalDate: date,
    };
    mailbox.messages.push(message);
    return message;
  }

  deliver(recipients, raw) {
    for (const recipient of recipients) {
      this.append(recipient, "INBOX", raw, [], new Date());
    }
  }

  copyMessage(email, sourceMailboxName, uid, destinationMailboxName) {
    const sourceMailbox = this.getMailbox(email, sourceMailboxName);
    const source = sourceMailbox.messages.find((message) => String(message.uid) === String(uid));
    if (!source) {
      return null;
    }
    return this.append(email, destinationMailboxName, source.raw, Array.from(source.flags), source.internalDate);
  }

  expunge(email, mailboxName) {
    const mailbox = this.getMailbox(email, mailboxName);
    const before = mailbox.messages.length;
    mailbox.messages = mailbox.messages.filter((message) => !message.flags.has("\\Deleted"));
    return before - mailbox.messages.length;
  }
}

class ImapFixtureSession {
  constructor(socket, store) {
    this.socket = socket;
    this.store = store;
    this.buffer = Buffer.alloc(0);
    this.userEmail = null;
    this.selectedMailboxName = "INBOX";
    this.pendingAppend = null;

    socket.on("data", (chunk) => this.onData(chunk));
    socket.on("error", () => {});
    this.writeLine("* OK [CAPABILITY IMAP4rev1 ID UIDPLUS] HivemindOS email fixture ready");
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  processBuffer() {
    while (this.buffer.length > 0) {
      if (this.pendingAppend) {
        if (this.buffer.length < this.pendingAppend.size) {
          return;
        }
        const literal = this.buffer.subarray(0, this.pendingAppend.size);
        this.buffer = this.buffer.subarray(this.pendingAppend.size);
        if (this.buffer.subarray(0, 2).toString() === "\r\n") {
          this.buffer = this.buffer.subarray(2);
        } else if (this.buffer.subarray(0, 1).toString() === "\n") {
          this.buffer = this.buffer.subarray(1);
        }
        this.finishAppend(literal);
        continue;
      }

      const lineEnd = this.buffer.indexOf(0x0a);
      if (lineEnd === -1) {
        return;
      }
      const rawLine = this.buffer.subarray(0, lineEnd + 1).toString("utf8");
      this.buffer = this.buffer.subarray(lineEnd + 1);
      const line = rawLine.replace(/\r?\n$/, "");
      if (line.trim()) {
        this.handleLine(line);
      }
    }
  }

  handleLine(line) {
    const tokens = tokenizeImap(line);
    const tag = tokens[0];
    const command = (tokens[1] || "").toUpperCase();

    if (!tag || !command) {
      return;
    }

    if (command === "CAPABILITY") {
      this.writeLine("* CAPABILITY IMAP4rev1 ID UIDPLUS");
      this.writeLine(`${tag} OK CAPABILITY completed`);
      return;
    }

    if (command === "LOGIN") {
      const userName = tokens[2] || "";
      const password = tokens[3] || "";
      if (!this.store.authenticate(userName, password)) {
        this.writeLine(`${tag} NO LOGIN failed`);
        return;
      }
      this.userEmail = normalizeAddress(userName);
      this.writeLine(`${tag} OK LOGIN completed`);
      return;
    }

    if (command === "ID") {
      this.writeLine("* ID NIL");
      this.writeLine(`${tag} OK ID completed`);
      return;
    }

    if (command === "SELECT") {
      this.handleSelect(tag, tokens[2] || "INBOX");
      return;
    }

    if (command === "LIST") {
      this.handleList(tag);
      return;
    }

    if (command === "UID") {
      this.handleUid(tag, tokens, line);
      return;
    }

    if (command === "APPEND") {
      this.handleAppendLine(tag, line);
      return;
    }

    if (command === "EXPUNGE") {
      this.handleExpunge(tag);
      return;
    }

    if (command === "NOOP") {
      this.writeLine(`${tag} OK NOOP completed`);
      return;
    }

    if (command === "LOGOUT") {
      this.writeLine("* BYE Logging out");
      this.writeLine(`${tag} OK LOGOUT completed`);
      this.socket.end();
      return;
    }

    this.writeLine(`${tag} BAD Unsupported command ${command}`);
  }

  handleSelect(tag, mailboxToken) {
    const mailboxName = stripQuotes(mailboxToken);
    const mailbox = this.mailbox(mailboxName);
    this.selectedMailboxName = mailbox.name;
    this.writeLine("* FLAGS (\\Answered \\Deleted \\Draft \\Flagged \\Seen)");
    this.writeLine(`* ${mailbox.messages.length} EXISTS`);
    this.writeLine("* 0 RECENT");
    this.writeLine("* OK [UIDVALIDITY 1] UIDs valid");
    this.writeLine(`* OK [UIDNEXT ${mailbox.uidNext}] Predicted next UID`);
    this.writeLine(`${tag} OK [READ-WRITE] SELECT completed`);
  }

  handleList(tag) {
    for (const mailbox of this.store.listMailboxes(this.userEmail)) {
      const flags = listMailboxFlags(mailbox.name).join(" ");
      this.writeLine(`* LIST (${flags}) "/" "${escapeQuoted(mailbox.name)}"`);
    }
    this.writeLine(`${tag} OK`);
  }

  handleUid(tag, tokens, line) {
    const subcommand = (tokens[2] || "").toUpperCase();
    if (subcommand === "SEARCH") {
      const criteria = tokens.slice(3);
      const matching = this.searchSelectedMailbox(criteria).map((message) => message.uid).join(" ");
      this.writeLine(`* SEARCH ${matching}`.trimEnd());
      this.writeLine(`${tag} OK SEARCH completed`);
      return;
    }

    if (subcommand === "FETCH") {
      this.handleUidFetch(tag, tokens[3], line);
      return;
    }

    if (subcommand === "STORE") {
      this.handleUidStore(tag, tokens);
      return;
    }

    if (subcommand === "COPY") {
      this.handleUidCopy(tag, tokens);
      return;
    }

    this.writeLine(`${tag} BAD Unsupported UID command ${subcommand}`);
  }

  handleUidFetch(tag, uidSet, line) {
    const mailbox = this.selectedMailbox();
    const spec = line.toUpperCase();
    const messages = expandUidSet(uidSet)
      .map((uid) => mailbox.messages.find((message) => String(message.uid) === String(uid)))
      .filter(Boolean);

    for (const message of messages) {
      const seq = mailbox.messages.indexOf(message) + 1;
      if (spec.includes("INTERNALDATE")) {
        this.writeLine(`* ${seq} FETCH (UID ${message.uid} INTERNALDATE "${formatInternalDate(message.internalDate)}")`);
      } else if (spec.includes("HEADER")) {
        this.writeLiteralFetch(seq, message.uid, "BODY[HEADER]", headerPart(message.raw));
      } else if (spec.includes("BODY.PEEK[]") || spec.includes("BODY[]")) {
        this.writeLiteralFetch(seq, message.uid, "BODY[]", message.raw);
      } else {
        this.writeLine(`* ${seq} FETCH (UID ${message.uid} FLAGS (${Array.from(message.flags).join(" ")}))`);
      }
    }
    this.writeLine(`${tag} OK FETCH completed`);
  }

  handleUidStore(tag, tokens) {
    const uid = tokens[3];
    const operation = tokens[4] || "";
    const flags = extractFlags(tokens.slice(5).join(" "));
    const mailbox = this.selectedMailbox();
    const message = mailbox.messages.find((candidate) => String(candidate.uid) === String(uid));
    if (!message) {
      this.writeLine(`${tag} NO UID not found`);
      return;
    }
    if (operation.startsWith("+")) {
      for (const flag of flags) {
        message.flags.add(flag);
      }
    } else if (operation.startsWith("-")) {
      for (const flag of flags) {
        message.flags.delete(flag);
      }
    } else {
      message.flags = new Set(flags);
    }
    const seq = mailbox.messages.indexOf(message) + 1;
    this.writeLine(`* ${seq} FETCH (UID ${message.uid} FLAGS (${Array.from(message.flags).join(" ")}))`);
    this.writeLine(`${tag} OK STORE completed`);
  }

  handleUidCopy(tag, tokens) {
    const uid = tokens[3];
    const destinationMailbox = stripQuotes(tokens[4] || "Archive");
    const copied = this.store.copyMessage(this.userEmail, this.selectedMailboxName, uid, destinationMailbox);
    if (!copied) {
      this.writeLine(`${tag} NO COPY failed`);
      return;
    }
    this.writeLine(`${tag} OK [COPYUID 1 ${uid} ${copied.uid}] COPY completed`);
  }

  handleAppendLine(tag, line) {
    const match = line.match(/^\S+\s+APPEND\s+("[^"]+"|\S+)(?:\s+\(([^)]*)\))?.*\{(\d+)\}\s*$/i);
    if (!match) {
      this.writeLine(`${tag} BAD APPEND parse failed`);
      return;
    }
    this.pendingAppend = {
      tag,
      mailboxName: stripQuotes(match[1]),
      flags: extractFlags(match[2] || ""),
      size: Number(match[3]),
    };
    this.writeLine("+ Ready for literal");
  }

  finishAppend(literal) {
    const append = this.pendingAppend;
    this.pendingAppend = null;
    const message = this.store.append(this.userEmail, append.mailboxName, literal, append.flags, new Date());
    this.writeLine(`${append.tag} OK [APPENDUID 1 ${message.uid}] APPEND completed`);
  }

  handleExpunge(tag) {
    const removed = this.store.expunge(this.userEmail, this.selectedMailboxName);
    for (let index = 0; index < removed; index += 1) {
      this.writeLine("* 1 EXPUNGE");
    }
    this.writeLine(`${tag} OK EXPUNGE completed`);
  }

  searchSelectedMailbox(criteria) {
    const mailbox = this.selectedMailbox();
    return mailbox.messages.filter((message) => matchesCriteria(message, criteria));
  }

  selectedMailbox() {
    return this.mailbox(this.selectedMailboxName);
  }

  mailbox(mailboxName) {
    return this.store.getMailbox(this.userEmail, mailboxName);
  }

  writeLiteralFetch(seq, uid, section, literal) {
    this.socket.write(`* ${seq} FETCH (UID ${uid} ${section} {${literal.length}}\r\n`);
    this.socket.write(literal);
    this.socket.write("\r\n)\r\n");
  }

  writeLine(line) {
    this.socket.write(`${line}\r\n`);
  }
}

class SmtpFixtureSession {
  constructor(socket, store) {
    this.socket = socket;
    this.store = store;
    this.buffer = "";
    this.recipients = [];
    this.collectingData = false;
    this.dataLines = [];

    socket.on("data", (chunk) => this.onData(chunk));
    socket.on("error", () => {});
    this.writeLine("220 hivemindos-email-fixture ESMTP ready");
  }

  onData(chunk) {
    this.buffer += chunk.toString("utf8");
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.handleLine(line);
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  handleLine(line) {
    if (this.collectingData) {
      if (line === ".") {
        const raw = Buffer.from(this.dataLines.map((item) => (item.startsWith("..") ? item.slice(1) : item)).join("\r\n") + "\r\n");
        this.store.deliver(this.recipients, raw);
        this.collectingData = false;
        this.dataLines = [];
        this.writeLine("250 2.0.0 Message accepted");
        return;
      }
      this.dataLines.push(line);
      return;
    }

    const command = line.split(/\s+/, 1)[0].toUpperCase();
    if (command === "EHLO" || command === "HELO") {
      this.socket.write("250-hivemindos-email-fixture\r\n");
      this.socket.write("250-AUTH PLAIN LOGIN\r\n");
      this.socket.write("250-SIZE 10485760\r\n");
      this.socket.write("250 HELP\r\n");
      return;
    }

    if (command === "AUTH") {
      this.writeLine("235 2.7.0 Authentication successful");
      return;
    }

    if (command === "MAIL") {
      this.recipients = [];
      this.writeLine("250 2.1.0 Sender OK");
      return;
    }

    if (command === "RCPT") {
      const recipient = extractSmtpAddress(line);
      if (recipient) {
        this.recipients.push(recipient);
      }
      this.writeLine("250 2.1.5 Recipient OK");
      return;
    }

    if (command === "DATA") {
      this.collectingData = true;
      this.dataLines = [];
      this.writeLine("354 End data with <CR><LF>.<CR><LF>");
      return;
    }

    if (command === "RSET") {
      this.recipients = [];
      this.collectingData = false;
      this.dataLines = [];
      this.writeLine("250 Reset OK");
      return;
    }

    if (command === "NOOP") {
      this.writeLine("250 OK");
      return;
    }

    if (command === "QUIT") {
      this.writeLine("221 Bye");
      this.socket.end();
      return;
    }

    this.writeLine("502 Command not implemented");
  }

  writeLine(line) {
    this.socket.write(`${line}\r\n`);
  }
}

async function main() {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), "hivemindos-mcp-email-e2e-"));
  const store = new MailStore(Object.values(AGENTS));
  const imapServer = await startImapServer(store);
  const smtpServer = await startSmtpServer(store);
  const clients = [];
  const report = {
    suite: "mcp-email-fixture",
    startedAt: new Date().toISOString(),
    accounts: Object.fromEntries(
      Object.entries(AGENTS).map(([key, agent]) => [
        key,
        {
          accountName: agent.accountName,
          email: agent.email,
          canSend: key === "alpha" || key === "beta",
        },
      ]),
    ),
    sentEmails: [],
    searches: [],
    readEmails: [],
    attachmentDownloads: [],
    mailboxOperations: [],
    toolVisibility: [],
  };

  try {
    const alpha = await startMcpClient("alpha", AGENTS.alpha, testRoot, imapServer.port, smtpServer.port, true);
    let beta = await startMcpClient("beta", AGENTS.beta, testRoot, imapServer.port, smtpServer.port, true);
    const readonly = await startMcpClient("readonly", AGENTS.readonly, testRoot, imapServer.port, smtpServer.port, false);
    const observer = await startMcpClient("observer", AGENTS.observer, testRoot, imapServer.port, smtpServer.port, false);
    clients.push(alpha, beta, readonly, observer);

    report.toolVisibility = await assertToolVisibility(alpha, beta, readonly, observer);
    await assertConfiguredAccounts(alpha, beta, readonly, observer);

    const attachmentPath = path.join(testRoot, "alpha-report.txt");
    await writeFile(attachmentPath, "alpha->beta fixture attachment\nhandoff-token: apis-make-mail-real\n", "utf8");

    const subject = `Agent E2E alpha to beta ${Date.now()}`;
    const body = [
      "Agent Alpha checking in with Agent Beta.",
      "handoff-token: apis-make-mail-real",
      "Please confirm receipt through the MCP email bridge.",
    ].join("\n");

    const sentResult = await alpha.callTool("send_email", {
      account_name: AGENTS.alpha.accountName,
      recipients: [AGENTS.beta.email],
      subject,
      body,
      cc: [AGENTS.readonly.email],
      bcc: [AGENTS.observer.email],
      reply_to: "triage@hivemind.test",
      attachments: [attachmentPath],
    });
    assert.match(sentResult, /Email sent successfully/);
    report.sentEmails.push({
      label: "alpha-to-beta",
      from: AGENTS.alpha.email,
      to: [AGENTS.beta.email],
      cc: [AGENTS.readonly.email],
      bcc: [AGENTS.observer.email],
      subject,
      bodySnippet: body,
      attachments: [path.basename(attachmentPath)],
      toolResult: sentResult,
    });

    const betaInbox = await beta.callTool("list_emails_metadata", {
      account_name: AGENTS.beta.accountName,
      page_size: 5,
      subject,
      from_address: AGENTS.alpha.email,
      to_address: AGENTS.beta.email,
      seen: false,
    });
    assert.equal(betaInbox.total, 1, "beta should receive alpha's unread message");
    const betaMessageId = betaInbox.emails[0].email_id;
    report.searches.push({
      label: "beta unread inbox search",
      account: AGENTS.beta.accountName,
      filters: { subject, from_address: AGENTS.alpha.email, to_address: AGENTS.beta.email, seen: false },
      total: betaInbox.total,
      returned: betaInbox.emails.map(summarizeMetadata),
    });

    const dateFilteredInbox = await beta.callTool("list_emails_metadata", {
      account_name: AGENTS.beta.accountName,
      subject,
      since: new Date(Date.now() - 86_400_000).toISOString(),
      before: new Date(Date.now() + 86_400_000).toISOString(),
    });
    assert.equal(dateFilteredInbox.total, 1, "date-bounded search should find the just-delivered message");
    report.searches.push({
      label: "beta date-bounded inbox search",
      account: AGENTS.beta.accountName,
      filters: { subject, since: "now - 1 day", before: "now + 1 day" },
      total: dateFilteredInbox.total,
      returned: dateFilteredInbox.emails.map(summarizeMetadata),
    });

    const betaContent = await beta.callTool("get_emails_content", {
      account_name: AGENTS.beta.accountName,
      email_ids: [betaMessageId],
      mark_as_read: false,
    });
    assert.equal(betaContent.retrieved_count, 1);
    const betaEmail = betaContent.emails[0];
    assert.equal(betaEmail.subject, subject);
    assert.match(betaEmail.body, /handoff-token: apis-make-mail-real/);
    assert.deepEqual(betaEmail.attachments, ["alpha-report.txt"]);
    assert.ok(betaEmail.message_id, "message_id should be exposed for replies");
    assertRecipientHeaders(store, subject);
    report.readEmails.push({
      label: "beta read alpha message",
      account: AGENTS.beta.accountName,
      requestedEmailIds: [betaMessageId],
      retrievedCount: betaContent.retrieved_count,
      returned: betaContent.emails.map(summarizeEmail),
    });

    const downloadPath = path.join(testRoot, "downloads", "alpha-report.txt");
    const download = await beta.callTool("download_attachment", {
      account_name: AGENTS.beta.accountName,
      email_id: betaMessageId,
      attachment_name: "alpha-report.txt",
      save_path: downloadPath,
    });
    assert.equal(download.attachment_name, "alpha-report.txt");
    assert.equal((await readFile(downloadPath, "utf8")).includes("apis-make-mail-real"), true);
    assert.equal((await stat(downloadPath)).size, download.size);
    report.attachmentDownloads.push({
      label: "beta downloaded alpha attachment",
      account: AGENTS.beta.accountName,
      emailId: betaMessageId,
      attachmentName: download.attachment_name,
      mimeType: download.mime_type,
      size: download.size,
      savedPath: download.saved_path,
    });

    report.mailboxOperations.push(await assertReadStateTransition(beta, subject, betaMessageId));
    const restartResult = await assertMcpRestartPersistence(beta, clients, testRoot, imapServer.port, smtpServer.port, subject);
    beta = restartResult.client;
    report.mailboxOperations.push(restartResult.report);
    const replyResult = await assertReplyFlow(beta, alpha, subject, betaEmail.message_id, store);
    report.sentEmails.push(replyResult.sent);
    report.searches.push(replyResult.search);
    report.readEmails.push(replyResult.read);
    const htmlResult = await assertHtmlEmail(alpha, beta, subject);
    report.sentEmails.push(htmlResult.sent);
    report.searches.push(htmlResult.search);
    report.readEmails.push(htmlResult.read);
    report.mailboxOperations.push(...(await assertMailboxFeatures(beta, betaMessageId, subject)));
    const readonlyResult = await assertReadonlyRecipient(readonly, subject);
    report.searches.push(readonlyResult.search);
    report.readEmails.push(readonlyResult.read);
    const bccResult = await assertBccRecipient(observer, subject);
    report.searches.push(bccResult.search);
    report.readEmails.push(bccResult.read);
    report.mailboxOperations.push(await assertSentCopy(alpha, subject, store));
    report.finishedAt = new Date().toISOString();
    report.status = "passed";

    console.log("MCP Email Server E2E passed:");
    console.log("- distinct agent email addresses sent and received mail through real MCP stdio sessions");
    console.log("- IMAP list/search/date-filter/fetch/read/restart/move/delete/list-mailboxes/save-draft paths passed");
    console.log("- SMTP send, HTML parsing, reply threading, CC/BCC delivery, Sent copy, and attachment download passed");
    console.log("- read-only IMAP mode hides send/save tools when SMTP is not configured");
    await emitReport(report);
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    await closeServer(imapServer.server);
    await closeServer(smtpServer.server);
    await rm(testRoot, { recursive: true, force: true });
  }
}

async function startMcpClient(label, agent, testRoot, imapPort, smtpPort, canSend) {
  const client = new McpClient({
    name: label,
    accountName: agent.accountName,
    env: {
      ...process.env,
      HOME: testRoot,
      PYTHONUNBUFFERED: "1",
      MCP_EMAIL_SERVER_CONFIG_PATH: path.join(testRoot, `${agent.accountName}.toml`),
      MCP_EMAIL_SERVER_ACCOUNT_NAME: agent.accountName,
      MCP_EMAIL_SERVER_FULL_NAME: agent.displayName,
      MCP_EMAIL_SERVER_EMAIL_ADDRESS: agent.email,
      MCP_EMAIL_SERVER_USER_NAME: agent.email,
      MCP_EMAIL_SERVER_PASSWORD: DEFAULT_PASSWORD,
      MCP_EMAIL_SERVER_IMAP_HOST: HOST,
      MCP_EMAIL_SERVER_IMAP_PORT: String(imapPort),
      MCP_EMAIL_SERVER_IMAP_SSL: "false",
      MCP_EMAIL_SERVER_IMAP_START_SSL: "false",
      MCP_EMAIL_SERVER_IMAP_VERIFY_SSL: "false",
      MCP_EMAIL_SERVER_SAVE_TO_SENT: "true",
      MCP_EMAIL_SERVER_SENT_FOLDER_NAME: "Sent",
      MCP_EMAIL_SERVER_ENABLE_ATTACHMENT_DOWNLOAD: "true",
      ...(canSend
        ? {
            MCP_EMAIL_SERVER_SMTP_HOST: HOST,
            MCP_EMAIL_SERVER_SMTP_PORT: String(smtpPort),
            MCP_EMAIL_SERVER_SMTP_SSL: "false",
            MCP_EMAIL_SERVER_SMTP_START_SSL: "false",
            MCP_EMAIL_SERVER_SMTP_VERIFY_SSL: "false",
          }
        : {}),
    },
  });
  await client.start();
  return client;
}

async function assertToolVisibility(alpha, beta, ...readOnlyClients) {
  const alphaTools = await alpha.listTools();
  const betaTools = await beta.listTools();
  const visibility = [
    { account: alpha.accountName, tools: alphaTools },
    { account: beta.accountName, tools: betaTools },
  ];

  for (const tools of [alphaTools, betaTools]) {
    assert.ok(tools.includes("send_email"), "SMTP-capable agents should expose send_email");
    assert.ok(tools.includes("save_to_mailbox"), "SMTP-capable agents should expose save_to_mailbox");
    assert.ok(tools.includes("download_attachment"), "agents should expose attachment download tool");
  }
  for (const client of readOnlyClients) {
    const tools = await client.listTools();
    visibility.push({ account: client.accountName, tools });
    assert.ok(tools.includes("list_emails_metadata"));
    assert.ok(tools.includes("get_emails_content"));
    assert.equal(tools.includes("send_email"), false, "read-only account should hide send_email");
    assert.equal(tools.includes("save_to_mailbox"), false, "read-only account should hide save_to_mailbox");
  }
  return visibility;
}

async function assertConfiguredAccounts(...clients) {
  for (const client of clients) {
    const accounts = await client.callTool("list_available_accounts");
    assert.equal(accounts[0].account_name, client.accountName);
  }
}

async function assertReadStateTransition(beta, subject, betaMessageId) {
  const markResult = await beta.callTool("mark_emails_as_read", {
    account_name: AGENTS.beta.accountName,
    email_ids: [betaMessageId],
  });

  const unread = await beta.callTool("list_emails_metadata", {
    account_name: AGENTS.beta.accountName,
    subject,
    seen: false,
  });
  assert.equal(unread.total, 0, "message should leave the unread search after mark_emails_as_read");

  const read = await beta.callTool("list_emails_metadata", {
    account_name: AGENTS.beta.accountName,
    subject,
    seen: true,
  });
  assert.equal(read.total, 1, "message should appear in the read search after mark_emails_as_read");
  return {
    label: "mark beta message read",
    account: AGENTS.beta.accountName,
    emailIds: [betaMessageId],
    toolResult: markResult,
    unreadSearchAfter: unread.total,
    readSearchAfter: read.total,
  };
}

function assertRecipientHeaders(store, subject) {
  const betaRaw = findRawMessage(store, AGENTS.beta.email, "INBOX", subject);
  const readonlyRaw = findRawMessage(store, AGENTS.readonly.email, "INBOX", subject);
  const observerRaw = findRawMessage(store, AGENTS.observer.email, "INBOX", subject);
  assert.ok(betaRaw, "beta should have a raw inbox message");
  assert.ok(readonlyRaw, "CC recipient should have a raw inbox message");
  assert.ok(observerRaw, "BCC recipient should have a raw inbox message");

  for (const rawMessage of [betaRaw, readonlyRaw, observerRaw]) {
    const headers = parseHeaders(rawMessage.raw);
    assert.equal(headers.bcc, undefined, "delivered recipient copies must not expose a Bcc header");
    assert.equal(headers["reply-to"], "triage@hivemind.test");
  }
}

async function assertMcpRestartPersistence(beta, clients, testRoot, imapPort, smtpPort, subject) {
  await beta.close();
  const restarted = await startMcpClient("beta-restarted", AGENTS.beta, testRoot, imapPort, smtpPort, true);
  clients.push(restarted);
  const afterRestart = await restarted.callTool("list_emails_metadata", {
    account_name: AGENTS.beta.accountName,
    subject,
    seen: true,
  });
  assert.equal(afterRestart.total, 1, "beta inbox state should persist across MCP server restarts");
  return {
    client: restarted,
    report: {
      label: "restart beta MCP process and re-list inbox",
      account: AGENTS.beta.accountName,
      subject,
      totalAfterRestart: afterRestart.total,
      returned: afterRestart.emails.map(summarizeMetadata),
    },
  };
}

async function assertReplyFlow(beta, alpha, originalSubject, originalMessageId, store) {
  const replySubject = `Re: ${originalSubject}`;
  const sendResult = await beta.callTool("send_email", {
    account_name: AGENTS.beta.accountName,
    recipients: [AGENTS.alpha.email],
    subject: replySubject,
    body: "Agent Beta confirms receipt over the E2E bridge.",
    in_reply_to: originalMessageId,
    references: originalMessageId,
  });

  const alphaInbox = await alpha.callTool("list_emails_metadata", {
    account_name: AGENTS.alpha.accountName,
    subject: replySubject,
    from_address: AGENTS.beta.email,
    seen: false,
  });
  assert.equal(alphaInbox.total, 1, "alpha should receive beta's reply");

  const replyContent = await alpha.callTool("get_emails_content", {
    account_name: AGENTS.alpha.accountName,
    email_ids: [alphaInbox.emails[0].email_id],
  });
  assert.match(replyContent.emails[0].body, /confirms receipt/);

  const rawReply = store
    .getMailbox(AGENTS.alpha.email, "INBOX")
    .messages.find((message) => parseHeaders(message.raw).subject === replySubject);
  assert.ok(rawReply, "fixture should have captured beta's raw reply");
  assert.equal(parseHeaders(rawReply.raw)["in-reply-to"], originalMessageId);
  assert.equal(parseHeaders(rawReply.raw).references, originalMessageId);
  return {
    sent: {
      label: "beta reply to alpha",
      from: AGENTS.beta.email,
      to: [AGENTS.alpha.email],
      subject: replySubject,
      inReplyTo: originalMessageId,
      references: originalMessageId,
      toolResult: sendResult,
    },
    search: {
      label: "alpha search for beta reply",
      account: AGENTS.alpha.accountName,
      filters: { subject: replySubject, from_address: AGENTS.beta.email, seen: false },
      total: alphaInbox.total,
      returned: alphaInbox.emails.map(summarizeMetadata),
    },
    read: {
      label: "alpha read beta reply",
      account: AGENTS.alpha.accountName,
      requestedEmailIds: [alphaInbox.emails[0].email_id],
      retrievedCount: replyContent.retrieved_count,
      returned: replyContent.emails.map(summarizeEmail),
    },
  };
}

async function assertHtmlEmail(alpha, beta, subject) {
  const htmlSubject = `Agent E2E HTML ${Date.now()} ${subject.slice(-6)}`;
  const sendResult = await alpha.callTool("send_email", {
    account_name: AGENTS.alpha.accountName,
    recipients: [AGENTS.beta.email],
    subject: htmlSubject,
    body: "<p>HTML hello <strong>Agent Beta</strong>.</p><script>window.bad = true</script>",
    html: true,
  });

  const htmlInbox = await beta.callTool("list_emails_metadata", {
    account_name: AGENTS.beta.accountName,
    subject: htmlSubject,
    from_address: AGENTS.alpha.email,
  });
  assert.equal(htmlInbox.total, 1, "beta should receive HTML mail");

  const htmlContent = await beta.callTool("get_emails_content", {
    account_name: AGENTS.beta.accountName,
    email_ids: [htmlInbox.emails[0].email_id],
  });
  assert.match(htmlContent.emails[0].body, /HTML hello/);
  assert.doesNotMatch(htmlContent.emails[0].body, /window\.bad/);
  return {
    sent: {
      label: "alpha sent HTML email to beta",
      from: AGENTS.alpha.email,
      to: [AGENTS.beta.email],
      subject: htmlSubject,
      html: true,
      toolResult: sendResult,
    },
    search: {
      label: "beta search for HTML email",
      account: AGENTS.beta.accountName,
      filters: { subject: htmlSubject, from_address: AGENTS.alpha.email },
      total: htmlInbox.total,
      returned: htmlInbox.emails.map(summarizeMetadata),
    },
    read: {
      label: "beta read HTML email",
      account: AGENTS.beta.accountName,
      requestedEmailIds: [htmlInbox.emails[0].email_id],
      retrievedCount: htmlContent.retrieved_count,
      returned: htmlContent.emails.map(summarizeEmail),
    },
  };
}

async function assertMailboxFeatures(beta, betaMessageId, subject) {
  const operations = [];
  const mailboxes = await beta.callTool("list_mailboxes", {
    account_name: AGENTS.beta.accountName,
  });
  const mailboxNames = mailboxes.map((mailbox) => mailbox.name).sort();
  assert.deepEqual(mailboxNames, ["Archive", "Drafts", "INBOX", "Sent", "Trash"]);
  operations.push({ label: "list beta mailboxes", account: AGENTS.beta.accountName, returned: mailboxes });

  const draftSubject = `Draft ${subject}`;
  const draftResult = await beta.callTool("save_to_mailbox", {
    account_name: AGENTS.beta.accountName,
    recipients: [AGENTS.alpha.email],
    subject: draftSubject,
    body: "This should stay in Drafts during the E2E run.",
    mailbox: "Drafts",
    flags: ["\\Draft", "\\Seen", "\\Flagged", "\\Answered"],
  });
  assert.match(draftResult, /Email saved to 'Drafts' successfully/);

  const drafts = await beta.callTool("list_emails_metadata", {
    account_name: AGENTS.beta.accountName,
    mailbox: "Drafts",
    subject: draftSubject,
    seen: true,
    flagged: true,
    answered: true,
  });
  assert.equal(drafts.total, 1, "save_to_mailbox should create a flagged, answered, read draft");
  operations.push({
    label: "save beta draft",
    account: AGENTS.beta.accountName,
    mailbox: "Drafts",
    subject: draftSubject,
    toolResult: draftResult,
    searchTotal: drafts.total,
    returned: drafts.emails.map(summarizeMetadata),
  });

  const moveResult = await beta.callTool("move_emails", {
    account_name: AGENTS.beta.accountName,
    email_ids: [betaMessageId],
    source_mailbox: "INBOX",
    destination_mailbox: "Archive",
  });
  assert.match(moveResult, /Successfully moved 1 email/);

  const inboxAfterMove = await beta.callTool("list_emails_metadata", {
    account_name: AGENTS.beta.accountName,
    mailbox: "INBOX",
    subject,
  });
  assert.equal(inboxAfterMove.total, 0, "moved message should leave INBOX");

  const archiveAfterMove = await beta.callTool("list_emails_metadata", {
    account_name: AGENTS.beta.accountName,
    mailbox: "Archive",
    subject,
  });
  assert.equal(archiveAfterMove.total, 1, "moved message should appear in Archive");
  operations.push({
    label: "move beta message from INBOX to Archive",
    account: AGENTS.beta.accountName,
    emailIds: [betaMessageId],
    toolResult: moveResult,
    inboxAfterMove: inboxAfterMove.total,
    archiveAfterMove: archiveAfterMove.total,
    archiveReturned: archiveAfterMove.emails.map(summarizeMetadata),
  });

  const deleteResult = await beta.callTool("delete_emails", {
    account_name: AGENTS.beta.accountName,
    email_ids: [archiveAfterMove.emails[0].email_id],
    mailbox: "Archive",
  });
  assert.match(deleteResult, /Successfully deleted 1 email/);

  const archiveAfterDelete = await beta.callTool("list_emails_metadata", {
    account_name: AGENTS.beta.accountName,
    mailbox: "Archive",
    subject,
  });
  assert.equal(archiveAfterDelete.total, 0, "deleted archived message should disappear");
  operations.push({
    label: "delete beta archived message",
    account: AGENTS.beta.accountName,
    emailIds: [archiveAfterMove.emails[0].email_id],
    mailbox: "Archive",
    toolResult: deleteResult,
    archiveAfterDelete: archiveAfterDelete.total,
  });
  return operations;
}

async function assertReadonlyRecipient(readonly, subject) {
  const readonlyInbox = await readonly.callTool("list_emails_metadata", {
    account_name: AGENTS.readonly.accountName,
    subject,
    from_address: AGENTS.alpha.email,
  });
  assert.equal(readonlyInbox.total, 1, "read-only CC recipient should still receive mail");

  const readonlyContent = await readonly.callTool("get_emails_content", {
    account_name: AGENTS.readonly.accountName,
    email_ids: [readonlyInbox.emails[0].email_id],
  });
  assert.match(readonlyContent.emails[0].body, /handoff-token/);
  return {
    search: {
      label: "readonly CC recipient search",
      account: AGENTS.readonly.accountName,
      filters: { subject, from_address: AGENTS.alpha.email },
      total: readonlyInbox.total,
      returned: readonlyInbox.emails.map(summarizeMetadata),
    },
    read: {
      label: "readonly CC recipient read",
      account: AGENTS.readonly.accountName,
      requestedEmailIds: [readonlyInbox.emails[0].email_id],
      retrievedCount: readonlyContent.retrieved_count,
      returned: readonlyContent.emails.map(summarizeEmail),
    },
  };
}

async function assertBccRecipient(observer, subject) {
  const observerInbox = await observer.callTool("list_emails_metadata", {
    account_name: AGENTS.observer.accountName,
    subject,
    from_address: AGENTS.alpha.email,
  });
  assert.equal(observerInbox.total, 1, "BCC recipient should receive the message via SMTP envelope delivery");

  const observerContent = await observer.callTool("get_emails_content", {
    account_name: AGENTS.observer.accountName,
    email_ids: [observerInbox.emails[0].email_id],
  });
  assert.match(observerContent.emails[0].body, /handoff-token/);
  return {
    search: {
      label: "observer BCC recipient search",
      account: AGENTS.observer.accountName,
      filters: { subject, from_address: AGENTS.alpha.email },
      total: observerInbox.total,
      returned: observerInbox.emails.map(summarizeMetadata),
    },
    read: {
      label: "observer BCC recipient read",
      account: AGENTS.observer.accountName,
      requestedEmailIds: [observerInbox.emails[0].email_id],
      retrievedCount: observerContent.retrieved_count,
      returned: observerContent.emails.map(summarizeEmail),
    },
  };
}

async function assertSentCopy(alpha, subject, store) {
  const sent = await alpha.callTool("list_emails_metadata", {
    account_name: AGENTS.alpha.accountName,
    mailbox: "Sent",
    subject,
    seen: true,
  });
  assert.equal(sent.total, 1, "send_email should save a sent copy when configured");

  const rawSent = findRawMessage(store, AGENTS.alpha.email, "Sent", subject);
  assert.ok(rawSent, "fixture should keep the raw sent copy");
  assert.equal(parseHeaders(rawSent.raw).bcc, AGENTS.observer.email);
  return {
    label: "verify alpha Sent copy",
    account: AGENTS.alpha.accountName,
    mailbox: "Sent",
    subject,
    total: sent.total,
    returned: sent.emails.map(summarizeMetadata),
    sentCopyBccHeader: parseHeaders(rawSent.raw).bcc,
  };
}

async function emitReport(report) {
  const json = JSON.stringify(report, null, 2);
  console.log("MCP Email Server E2E concrete report:");
  console.log(json);
  if (process.env.MCP_EMAIL_E2E_REPORT_PATH) {
    await writeFile(process.env.MCP_EMAIL_E2E_REPORT_PATH, `${json}\n`, "utf8");
    console.log(`MCP Email Server E2E report written to ${process.env.MCP_EMAIL_E2E_REPORT_PATH}`);
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

async function startImapServer(store) {
  const server = net.createServer((socket) => new ImapFixtureSession(socket, store));
  return await listen(server);
}

async function startSmtpServer(store) {
  const server = net.createServer((socket) => new SmtpFixtureSession(socket, store));
  return await listen(server);
}

async function listen(server) {
  server.listen(0, HOST);
  await once(server, "listening");
  return {
    server,
    port: server.address().port,
  };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

function matchesCriteria(message, criteria) {
  if (criteria.length === 0 || criteria.some((item) => item.toUpperCase() === "ALL")) {
    return true;
  }
  const headers = parseHeaders(message.raw);
  const searchableText = message.raw.toString("utf8").toLowerCase();

  for (let index = 0; index < criteria.length; index += 1) {
    const criterion = criteria[index].toUpperCase();
    if (criterion === "SUBJECT" && !contains(headers.subject, criteria[++index])) {
      return false;
    }
    if (criterion === "FROM" && !contains(headers.from, criteria[++index])) {
      return false;
    }
    if (criterion === "TO" && !contains(`${headers.to || ""} ${headers.cc || ""}`, criteria[++index])) {
      return false;
    }
    if (criterion === "BODY" && !contains(searchableText, criteria[++index])) {
      return false;
    }
    if (criterion === "TEXT" && !contains(searchableText, criteria[++index])) {
      return false;
    }
    if (criterion === "SEEN" && !message.flags.has("\\Seen")) {
      return false;
    }
    if (criterion === "UNSEEN" && message.flags.has("\\Seen")) {
      return false;
    }
    if (criterion === "FLAGGED" && !message.flags.has("\\Flagged")) {
      return false;
    }
    if (criterion === "UNFLAGGED" && message.flags.has("\\Flagged")) {
      return false;
    }
    if (criterion === "ANSWERED" && !message.flags.has("\\Answered")) {
      return false;
    }
    if (criterion === "UNANSWERED" && message.flags.has("\\Answered")) {
      return false;
    }
    if (criterion === "BEFORE" && !isBeforeImapDate(message.internalDate, criteria[++index])) {
      return false;
    }
    if (criterion === "SINCE" && !isSinceImapDate(message.internalDate, criteria[++index])) {
      return false;
    }
  }
  return true;
}

function contains(value, expected) {
  return String(value || "").toLowerCase().includes(String(expected || "").replace(/^"|"$/g, "").toLowerCase());
}

function parseHeaders(raw) {
  const headerText = headerPart(raw).toString("utf8").replace(/\r\n/g, "\n");
  const headers = {};
  let currentName = null;
  for (const line of headerText.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    if (/^[\t ]/.test(line) && currentName) {
      headers[currentName] = `${headers[currentName]} ${line.trim()}`;
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    currentName = line.slice(0, separator).toLowerCase();
    headers[currentName] = line.slice(separator + 1).trim();
  }
  return headers;
}

function findRawMessage(store, email, mailbox, subject) {
  return store.getMailbox(email, mailbox).messages.find((message) => parseHeaders(message.raw).subject === subject);
}

function headerPart(raw) {
  const crlfEnd = raw.indexOf(Buffer.from("\r\n\r\n"));
  if (crlfEnd !== -1) {
    return raw.subarray(0, crlfEnd + 4);
  }
  const lfEnd = raw.indexOf(Buffer.from("\n\n"));
  if (lfEnd !== -1) {
    return raw.subarray(0, lfEnd + 2);
  }
  return raw;
}

function isBeforeImapDate(date, imapDate) {
  const boundary = parseImapSearchDate(imapDate);
  return startOfUtcDay(date).getTime() < boundary.getTime();
}

function isSinceImapDate(date, imapDate) {
  const boundary = parseImapSearchDate(imapDate);
  return startOfUtcDay(date).getTime() >= boundary.getTime();
}

function parseImapSearchDate(value) {
  const match = String(value || "").match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/i);
  assert.ok(match, `fixture received unsupported IMAP date criterion: ${value}`);
  const months = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  return new Date(Date.UTC(Number(match[3]), months[match[2].toLowerCase()], Number(match[1])));
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function tokenizeImap(line) {
  const tokens = [];
  let token = "";
  let quoted = false;
  let escaping = false;

  for (const char of line) {
    if (escaping) {
      token += char;
      escaping = false;
      continue;
    }
    if (quoted && char === "\\") {
      escaping = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += char;
  }
  if (token) {
    tokens.push(token);
  }
  return tokens;
}

function stripQuotes(value) {
  return String(value || "").replace(/^"|"$/g, "");
}

function escapeQuoted(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function extractFlags(value) {
  return String(value || "")
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .map((flag) => flag.trim())
    .filter(Boolean);
}

function expandUidSet(uidSet) {
  return String(uidSet || "")
    .split(",")
    .flatMap((part) => {
      if (!part.includes(":")) {
        return [part];
      }
      const [start, end] = part.split(":").map(Number);
      const values = [];
      for (let uid = start; uid <= end; uid += 1) {
        values.push(String(uid));
      }
      return values;
    })
    .filter(Boolean);
}

function normalizeAddress(value) {
  const match = String(value || "").match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

function extractSmtpAddress(line) {
  const match = line.match(/<([^>]+)>/);
  return match ? normalizeAddress(match[1]) : null;
}

function canonicalMailboxName(account, requestedName) {
  const normalized = stripQuotes(requestedName || "INBOX");
  if (normalized.toUpperCase() === "INBOX") {
    return "INBOX";
  }
  for (const name of account.mailboxes.keys()) {
    if (name.toLowerCase() === normalized.toLowerCase()) {
      return name;
    }
  }
  return normalized;
}

function listMailboxFlags(name) {
  if (name === "INBOX") {
    return ["\\HasNoChildren"];
  }
  if (name === "Sent") {
    return ["\\HasNoChildren", "\\Sent"];
  }
  if (name === "Drafts") {
    return ["\\HasNoChildren", "\\Drafts"];
  }
  if (name === "Archive") {
    return ["\\HasNoChildren", "\\Archive"];
  }
  if (name === "Trash") {
    return ["\\HasNoChildren", "\\Trash"];
  }
  return ["\\HasNoChildren"];
}

function formatInternalDate(date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (value) => String(value).padStart(2, "0");
  return [
    `${pad(date.getUTCDate())}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`,
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
    "+0000",
  ].join(" ");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
