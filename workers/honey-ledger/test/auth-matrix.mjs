// Regression matrix for the honey-ledger auth boundary (see the 2026-06-22 security
// report). Asserts that every state-mutating endpoint rejects unauthenticated /
// unsigned / tampered / replayed / stale requests BEFORE touching D1, and that
// privileged routes fail CLOSED when their secret is unconfigured.
//
// Run: node test/auth-matrix.mjs   (from workers/honey-ledger)
//
// These assertions all resolve in the auth layer, which returns before any DB write,
// so they do not require a migrated local D1. Full positive-path E2E (mint -> exchange
// -> claim -> replay) needs a migrated D1 and is exercised by the remote/manual flow.

import { createHmac } from "node:crypto";
import process from "node:process";
import { unstable_dev } from "wrangler";

const SECRET = "test-ledger-secret";
const ADMIN = "test-admin-token";

const hmac = (canonical, secret = SECRET) => createHmac("sha256", secret).update(canonical).digest("hex");
const commandSig = (action, { workspaceId = "", agentId = "", recipientAddress = "", eventId = "", timestamp = "" }, secret) =>
  hmac([action, workspaceId, agentId, recipientAddress, eventId, timestamp].join("."), secret);

let passed = 0;
let failed = 0;
const checks = [];
function expect(name, actual, predicate, detail) {
  const ok = predicate(actual);
  checks.push({ name, ok, actual, detail });
  if (ok) passed += 1; else failed += 1;
}

async function postJson(worker, path, body, headers = {}) {
  const res = await worker.fetch(`http://x${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, error: data?.error ?? "", data };
}

async function main() {
  // Secret configured (so observations/commands fail with 401, not the 503 misconfig
  // path). Admin token deliberately UNSET to exercise fail-closed on /pool-events.
  const worker = await unstable_dev("src/index.ts", {
    local: true,
    experimental: { disableExperimentalWarning: true },
    vars: {
      HONEY_LEDGER_SECRET: SECRET,
      HIVE_TOKEN_ADDRESS: "0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3",
      HONEY_REWARD_BANKR_API_KEY: "bk_test_treasury",
    },
  });

  try {
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const ws = "ws_test_workspace";
    const recip = "0x1111111111111111111111111111111111111111";
    const attacker = "0x2222222222222222222222222222222222222222";

    // 1. /observations unsigned -> 401 (free-mint faucet closed)
    let r = await postJson(worker, "/observations", {
      eventId: "evt-obs-1", workspaceId: ws, agentId: "a1", model: "m",
      source: "observed-runtime-usage", tokensUsed: 1000, timestamp: now,
    });
    expect("/observations unsigned -> 401", r, (x) => x.status === 401, r.error);

    // 2. /exchange with no signature -> 401
    r = await postJson(worker, "/exchange", { workspaceId: ws });
    expect("/exchange unsigned -> 401", r, (x) => x.status === 401, r.error);

    // 3. /return-to-honey with no signature -> 401
    r = await postJson(worker, "/return-to-honey", { workspaceId: ws });
    expect("/return-to-honey unsigned -> 401", r, (x) => x.status === 401, r.error);

    // 4. /claim-bankr-hive with no signature -> 401
    r = await postJson(worker, "/claim-bankr-hive", { workspaceId: ws, recipientAddress: recip });
    expect("/claim-bankr-hive unsigned -> 401", r, (x) => x.status === 401, r.error);

    // 5. /exchange with a WRONG signature -> 401 "Invalid command signature"
    r = await postJson(worker, "/exchange", {
      workspaceId: ws, eventId: "evt-x-bad", timestamp: now, signature: "deadbeef",
    });
    expect("/exchange bad signature -> 401", r, (x) => x.status === 401 && /signature/i.test(x.error), r.error);

    // 6. /exchange validly signed but STALE timestamp -> 401 (replay window)
    r = await postJson(worker, "/exchange", {
      workspaceId: ws, eventId: "evt-x-stale", timestamp: stale,
      signature: commandSig("exchange", { workspaceId: ws, eventId: "evt-x-stale", timestamp: stale }),
    });
    expect("/exchange stale timestamp -> 401", r, (x) => x.status === 401 && /window|timestamp/i.test(x.error), r.error);

    // 7. /claim signed for recip but body swapped to attacker address -> 401 (recipient bound)
    r = await postJson(worker, "/claim-bankr-hive", {
      workspaceId: ws, eventId: "evt-claim-swap", timestamp: now, recipientAddress: attacker,
      signature: commandSig("claim-bankr-hive", { workspaceId: ws, recipientAddress: recip, eventId: "evt-claim-swap", timestamp: now }),
    });
    expect("/claim tampered recipient -> 401", r, (x) => x.status === 401 && /signature/i.test(x.error), r.error);

    // 8. /pool-events with NO admin token configured -> 503 fail closed
    r = await postJson(worker, "/pool-events", { hiveAmount: 100 });
    expect("/pool-events fail-closed -> 503", r, (x) => x.status === 503, r.error);

    // 9. /exchange with a CORRECT fresh signature -> auth layer passes (not 401/503).
    //    (Downstream may 500 on the un-migrated local D1; we only assert auth passed.)
    r = await postJson(worker, "/exchange", {
      workspaceId: ws, eventId: "evt-x-ok", timestamp: now,
      signature: commandSig("exchange", { workspaceId: ws, eventId: "evt-x-ok", timestamp: now }),
    });
    expect("/exchange valid signature passes auth", r, (x) => x.status !== 401 && x.status !== 503, `${r.status} ${r.error}`);

    // 10. /ledger capability read needs no token, only a workspaceId -> 400 (not 401)
    const ledgerRes = await worker.fetch("http://x/ledger");
    expect("/ledger no workspaceId -> 400 (not auth-gated)", { status: ledgerRes.status }, (x) => x.status === 400, String(ledgerRes.status));
  } finally {
    await worker.stop();
  }

  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.ok ? "" : `   <- got: ${c.detail}`}`);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
