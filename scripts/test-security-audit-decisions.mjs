#!/usr/bin/env node
// Hermetic coverage for the durable audit log, the decision corpus, and secret
// scoping/redaction.
//
// The properties that matter:
//   - the audit trail is append-only and survives (nothing here deletes)
//   - a captured decision NEVER persists a secret value verbatim
//   - secret scoping is deny-by-default for credentials that move money
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const home = await mkdtemp(join(tmpdir(), "hivemind-audit-"));
process.env.HOME = home;
process.env.USERPROFILE = home;

const audit = await import("../src/lib/services/security/audit-log.ts");
const decisions = await import("../src/lib/services/security/decision-capture.ts");
const scope = await import("../src/lib/services/security/secret-scope.ts");

// ---------------------------------------------------------------- redaction
{
  const secrets = { API: "sk-abcdef1234567890", SHORT: "xy", LONG: "supersecretvalue-0001" };
  const text = "calling with sk-abcdef1234567890 and supersecretvalue-0001 for xy";
  const out = scope.redactSecretValues(text, secrets);
  assert.equal(out.includes("sk-abcdef1234567890"), false, "long secret masked");
  assert.equal(out.includes("supersecretvalue-0001"), false, "second secret masked");
  assert.ok(out.includes("xy"), "values under the length floor are left alone");
  assert.equal(scope.redactSecretValues("", secrets), "", "empty text is safe");
  assert.equal(scope.redactSecretValues("nothing here", {}), "nothing here", "no secrets is a no-op");

  // A value containing another must not be left partially recoverable.
  const nested = scope.redactSecretValues("token=abcdefgh12345 and abcdefgh", {
    A: "abcdefgh",
    B: "abcdefgh12345",
  });
  assert.equal(nested.includes("abcdefgh12345"), false, "longest-first masking");

  // Regex metacharacters in a secret must not break the matcher.
  assert.equal(
    scope.redactSecretValues("v=a+b(c)*d?e", { K: "a+b(c)*d?e" }),
    "v=[redacted]",
    "special characters are escaped, not interpreted",
  );

  assert.deepEqual(
    scope.redactRecord({ note: "key sk-abcdef1234567890", count: 3 }, secrets),
    { note: "key [redacted]", count: 3 },
    "records redact strings and leave non-strings alone",
  );
}

// ------------------------------------------------------------- secret scope
{
  const values = {
    SEARCH_API_KEY: "search-value-123456",
    WALLET_PRIVATE_KEY: "wallet-value-123456",
    STRIPE_SECRET_KEY: "stripe-value-123456",
    OPENAI_API_KEY: "openai-value-123456",
  };
  for (const sensitive of ["WALLET_PRIVATE_KEY", "STRIPE_SECRET_KEY"]) {
    assert.ok(scope.isSensitiveSecretKey(sensitive), `${sensitive} is sensitive`);
  }
  assert.equal(scope.isSensitiveSecretKey("SEARCH_API_KEY"), false);

  const standard = scope.scopeSharedEnvForAgent(values);
  assert.ok(standard.SEARCH_API_KEY, "ordinary keys resolve by default");
  assert.equal(standard.WALLET_PRIVATE_KEY, undefined, "money keys are deny-by-default");
  assert.equal(standard.STRIPE_SECRET_KEY, undefined);

  const granted = scope.scopeSharedEnvForAgent(values, { allowKeys: ["WALLET_PRIVATE_KEY"] });
  assert.ok(granted.WALLET_PRIVATE_KEY, "a sensitive key resolves only when named explicitly");
  assert.equal(granted.STRIPE_SECRET_KEY, undefined, "naming one does not unlock the rest");

  // Deny beats an explicit allow — a revocation must not be overridable.
  const denied = scope.scopeSharedEnvForAgent(values, {
    allowKeys: ["WALLET_PRIVATE_KEY"],
    denyKeys: ["WALLET_PRIVATE_KEY"],
  });
  assert.equal(denied.WALLET_PRIVATE_KEY, undefined, "deny wins over allow");

  const readOnly = scope.scopeSharedEnvForAgent(values, { allowNonSensitiveByDefault: false });
  assert.deepEqual(readOnly, {}, "a read-only agent resolves nothing by default");
}

// -------------------------------------------------------------- audit log
{
  assert.deepEqual(await audit.queryAuditRecords(), [], "empty before anything is written");

  const principal = {
    principalId: "agent:ceo-1",
    displayName: "CEO",
    kind: "runtime-agent",
    source: "runtime",
    workspaceId: "default",
    claims: ["connectors:read"],
  };
  await audit.appendAuditRecord({
    type: "tool.denied",
    principal,
    decision: { status: "deny", reason: "missing claims" },
    target: "wallet.send-usdc",
  });
  await audit.appendAuditRecord({
    type: "tool.allowed",
    principal,
    decision: { status: "allow", reason: "ok" },
    target: "web.search",
  });

  const all = await audit.queryAuditRecords();
  assert.equal(all.length, 2);
  assert.equal(all[0].target, "web.search", "newest first");
  assert.equal(all[0].principalId, "agent:ceo-1");
  assert.equal(all[0].principalKind, "runtime-agent");

  const denials = await audit.queryAuditRecords({ outcome: "deny" });
  assert.equal(denials.length, 1, "filterable by outcome — 'what was refused' is the question asked most");
  assert.equal(denials[0].target, "wallet.send-usdc");

  assert.equal((await audit.queryAuditRecords({ principalId: "agent:other" })).length, 0);

  // Append-only: a second write must not disturb the first.
  await audit.appendAuditRecord({ type: "tool.allowed", principal, target: "web.fetch" });
  assert.equal((await audit.queryAuditRecords()).length, 3, "records accumulate");
}

// ------------------------------------------------------- decision capture
{
  assert.deepEqual(await decisions.queryDecisions(), []);

  const captured = await decisions.captureDecision({
    sourceKind: "interaction",
    sourceId: "t_1",
    companyId: "c_webs",
    subject: "Send the outreach email?",
    question: "Ready to send to 12 prospects.",
    outcome: "yes, send it",
    actor: "liam",
  });
  assert.ok(captured);
  assert.equal(captured.sourceKind, "interaction");
  assert.equal(captured.companyId, "c_webs");

  assert.equal(await decisions.captureDecision({ sourceKind: "bogus", sourceId: "x", outcome: "y" }), null);
  assert.equal(await decisions.captureDecision({ sourceKind: "approval", sourceId: "  ", outcome: "y" }), null);

  await decisions.captureDecision({
    sourceKind: "approval",
    sourceId: "p_1",
    companyId: "c_webs",
    subject: "Send the outreach email?",
    outcome: "yes, send it",
  });
  await decisions.captureDecision({
    sourceKind: "approval",
    sourceId: "p_2",
    subject: "Publish the pricing page?",
    outcome: "no, hold",
  });

  const all = await decisions.queryDecisions();
  assert.equal(all.length, 3);
  assert.equal((await decisions.queryDecisions({ sourceKind: "approval" })).length, 2);
  assert.equal((await decisions.queryDecisions({ companyId: "c_webs" })).length, 2);

  // Pattern summary is a REVIEW aid — it reports counts and consistency and
  // decides nothing on its own.
  const patterns = decisions.summarizeDecisionPatterns(all);
  const outreach = patterns.find((entry) => entry.subject.startsWith("Send the outreach"));
  assert.equal(outreach.count, 2, "the same question asked twice is grouped");
  assert.equal(outreach.topOutcome, "yes, send it");
  assert.equal(outreach.consistency, 1, "answered the same way both times");

  // Long text is clamped so one pasted document cannot bloat the corpus.
  const long = await decisions.captureDecision({
    sourceKind: "interaction",
    sourceId: "t_long",
    question: "q".repeat(9000),
    outcome: "ok",
  });
  assert.ok(long.question.length <= 4001, "question is clamped");
}

// -------------------------------- a captured decision must not store a secret
{
  // The real leak path: an operator pastes a credential into a Needs You answer
  // and it persists verbatim in an append-only corpus forever. Exercise the
  // ACTUAL wiring by pointing the shared-env reader at a real file, not just the
  // masking primitive — the primitive being correct is worthless if capture
  // never calls it.
  const secret = "sk-live-supersecret-value-999";
  const envFile = join(home, "hive.env");
  await writeFile(envFile, `LIVE_KEY=${secret}\n`, "utf8");
  process.env.HIVE_ENV_FILE = envFile;

  const captured = await decisions.captureDecision({
    sourceKind: "interaction",
    sourceId: "t_secret",
    subject: "use this key",
    question: `the key is ${secret}`,
    outcome: `confirmed ${secret}`,
    context: { note: `also ${secret}` },
  });

  assert.equal(captured.question.includes(secret), false, "question is redacted by capture itself");
  assert.equal(captured.outcome.includes(secret), false, "outcome is redacted by capture itself");
  assert.equal(String(captured.context.note).includes(secret), false, "context strings are redacted too");
  assert.ok(captured.question.includes("[redacted]"), "the masking marker is present");

  // And, decisively, it must not be on disk.
  const raw = await readFile(decisions.decisionsLogPath(), "utf8");
  assert.ok(raw.includes("t_secret"), "the decision was persisted");
  assert.equal(raw.includes(secret), false, "the credential never reaches the append-only log");

  delete process.env.HIVE_ENV_FILE;
}

console.log("Security audit, decision capture, and secret scope tests passed.");
