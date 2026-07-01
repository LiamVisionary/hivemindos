#!/usr/bin/env node
// Unit tests for the ClawBank REST client, onboarding helpers, and tool-policy classifier.
// Mocks global fetch; no network, no live ClawBank token required.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

// A ClawBank token in process.env satisfies hiveEnvValue() without a file read.
process.env.CLAWBANK_TOKEN = "test-clawbank-token";
delete process.env.CLAWBANK_API_URL;
delete process.env.CLAWBANK_MCP_URL;

const {
  clawbankFetch,
  clawbankMe,
  clawbankSendUsdc,
  clawbankSpotSwap,
  clawbankErrorMessage,
  clawbankErrorCode,
  isReadOnlyClawbankTool,
  CLAWBANK_CONFIRM,
  CLAWBANK_DEFAULT_API_URL,
} = await import("../src/lib/services/clawbank/index.ts");
const { normalizeClawBankLoginCode } = await import("../src/features/dashboard/clawbank-login-code.ts");

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// --- fetch mock -----------------------------------------------------------
let lastRequest = null;
function mockFetch(responder) {
  globalThis.fetch = async (url, init = {}) => {
    lastRequest = { url: String(url), init };
    const { status = 200, body } = responder({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (body == null ? "" : JSON.stringify(body)),
      headers: new Map(),
    };
  };
}

// --- success envelope -----------------------------------------------------
mockFetch(() => ({ status: 200, body: { ok: true, data: { hello: "world" } } }));
{
  const result = await clawbankFetch("/api/v1/ping");
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { hello: "world" });
  assert.equal(result.status, 200);
  assert.match(lastRequest.url, /^https:\/\/app\.clawbank\.co\/api\/v1\/ping/);
  assert.equal(lastRequest.init.headers.Authorization, "Bearer test-clawbank-token");
  assert.equal(CLAWBANK_DEFAULT_API_URL, "https://app.clawbank.co");
  ok("success envelope -> { ok, data } with bearer auth + default base URL");
}

// --- error envelope -------------------------------------------------------
mockFetch(() => ({ status: 422, body: { ok: false, error: { code: "bridge_customer_required", message: "Complete KYC first." } } }));
{
  const result = await clawbankFetch("/api/v1/money/balance");
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(result.error, "Complete KYC first.");
  assert.equal(result.errorCode, "bridge_customer_required");
  ok("error envelope -> normalized { ok:false, error, errorCode }");
}

// --- missing credential ---------------------------------------------------
{
  delete process.env.CLAWBANK_TOKEN;
  const result = await clawbankFetch("/api/v1/me");
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "missing_credential");
  assert.equal(result.status, 0);
  process.env.CLAWBANK_TOKEN = "test-clawbank-token";
  ok("missing credential -> { ok:false, errorCode:'missing_credential' } without a fetch");
}

// --- typed: me normalization ---------------------------------------------
mockFetch(() => ({
  status: 200,
  body: {
    ok: true,
    data: {
      id: 123,
      email: "agent@example.com",
      bridge_customer_configured: false,
      kyc_approved: false,
      trading_enabled: true,
      wallet: { address: "0xabc", chain: "base", provisioned: true },
    },
  },
}));
{
  const result = await clawbankMe();
  assert.equal(result.ok, true);
  assert.equal(result.data.tradingEnabled, true);
  assert.equal(result.data.kycApproved, false);
  assert.equal(result.data.wallet.address, "0xabc");
  assert.equal(result.data.wallet.provisioned, true);
  ok("clawbankMe maps snake_case readiness flags");
}

// --- typed: send_usdc body shape -----------------------------------------
mockFetch(() => ({ status: 200, body: { ok: true, data: { tx: "0xdead" } } }));
{
  await clawbankSendUsdc({ toAddress: "0xrecipient", amount: 5 });
  const sent = JSON.parse(lastRequest.init.body);
  assert.deepEqual(sent, { to_address: "0xrecipient", amount: "5" });
  assert.equal(lastRequest.init.method, "POST");
  assert.match(lastRequest.url, /\/api\/v1\/self_custody\/send_usdc$/);
  ok("clawbankSendUsdc posts { to_address, amount } to the documented path");
}

// --- typed: spot swap body shape -----------------------------------------
mockFetch(() => ({ status: 200, body: { ok: true, data: {} } }));
{
  await clawbankSpotSwap({ baseToken: "AERO", side: "buy", amountUsdc: 10, maxSlippageBps: 50 });
  const sent = JSON.parse(lastRequest.init.body);
  assert.deepEqual(sent, { base_token: "AERO", side: "buy", amount_usdc: "10", max_slippage_bps: 50 });
  ok("clawbankSpotSwap posts { base_token, side, amount_usdc, max_slippage_bps }");
}

// --- error helpers --------------------------------------------------------
{
  assert.equal(clawbankErrorMessage({ error: "flat string" }, 400), "flat string");
  assert.equal(clawbankErrorMessage({}, 401), "ClawBank rejected the credential (unauthorized).");
  assert.equal(clawbankErrorCode({ error: { code: "rate_limited" } }, 429), "rate_limited");
  assert.equal(clawbankErrorCode({}, 500), "http_500");
  ok("error message/code extraction probes envelope shapes + falls back by status");
}

// --- onboarding helper: preserve URL-safe email codes ----------------------
{
  const urlSafeCode = " LE-aBc_DEF-123_ghi \n";
  assert.equal(normalizeClawBankLoginCode(urlSafeCode), "LE-aBc_DEF-123_ghi");
  assert.equal(normalizeClawBankLoginCode("123 456"), "123456");
  ok("normalizeClawBankLoginCode preserves URL-safe punctuation and removes paste whitespace");
}

// --- tool-policy: read vs write classification ----------------------------
{
  for (const readTool of ["get_me", "list_wallets", "get_trading_report", "clawbank_formation_guide", "inspect_formation_payload_schema", "get_balance"]) {
    assert.equal(isReadOnlyClawbankTool(readTool), true, `${readTool} should be read-only`);
  }
  for (const writeTool of ["send_usdc_on_base", "create_usdc_transfer", "start_formation_checkout", "execute_spot_swap", "set_coms_handle", "send_money", "create_offramp_address", "totally_unknown_tool"]) {
    assert.equal(isReadOnlyClawbankTool(writeTool), false, `${writeTool} should default to write/gated`);
  }
  ok("isReadOnlyClawbankTool: known reads pass, writes + unknowns default to gated");
}

// --- confirmation constants are the expected literals ---------------------
{
  assert.equal(CLAWBANK_CONFIRM.SEND_USDC, "CLAWBANK_SEND_USDC");
  assert.equal(CLAWBANK_CONFIRM.SWAP, "CONFIRM_CLAWBANK_SWAP");
  assert.equal(CLAWBANK_CONFIRM.MONEY_TRANSFER, "CONFIRM_CLAWBANK_TRANSFER");
  assert.equal(CLAWBANK_CONFIRM.OFFRAMP, "CONFIRM_CLAWBANK_OFFRAMP");
  assert.equal(CLAWBANK_CONFIRM.FORMATION, "CONFIRM_CLAWBANK_FORMATION");
  assert.equal(CLAWBANK_CONFIRM.CALL, "CONFIRM_CLAWBANK_CALL");
  ok("confirmation tokens match the documented literals");
}

console.log(`\nclawbank-client: ${passed} checks passed`);
