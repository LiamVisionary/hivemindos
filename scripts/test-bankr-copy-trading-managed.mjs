#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-bankr-copy-vault-"));
process.env.HOME = tempHome;

const serviceSource = await readFile(new URL("../src/lib/services/trading/bankr-copy-trading.ts", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../src/components/trade/ManagedBankrCopyTradingPanel.tsx", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../src/app/api/trading/bankr-copy/route.ts", import.meta.url), "utf8");
const localCopyEngineSource = await readFile(new URL("../src/lib/services/copy-trading/engine.ts", import.meta.url), "utf8");
const smartEnvInputSource = await readFile(new URL("../src/features/env/SharedHiveEnvCredentialInput.tsx", import.meta.url), "utf8");
const smartEnvCssSource = await readFile(new URL("../src/features/env/hive-env-honey.module.css", import.meta.url), "utf8");
assert.match(serviceSource, /\/v1\/subscriptions\/recover/);
assert.match(serviceSource, /storeBankrCopyRecovery/);
assert.match(serviceSource, /do not pay again/);
assert.match(serviceSource, /\/v1\/monitors/);
assert.match(serviceSource, /startBankrCopyTradingMonitor/);
assert.doesNotMatch(serviceSource, /executeX402Fetch|PAY_X402|paymentWalletId/);
assert.match(panelSource, /managedExecutionAvailable/);
assert.match(panelSource, /\$1 minimum \+ \{dashboard\?\.feePercent/, "the hosted badge must state the rolling minimum and percentage");
assert.match(panelSource, /useState<SetupStep>\(1\)/, "setup must start on step one");
assert.match(panelSource, /setupStep === 1/, "wallet setup must be shown only on step one");
assert.match(panelSource, /setupStep === 2/, "risk setup must be shown only on step two");
assert.match(panelSource, /setupStep === 3/, "review and start must be shown only on step three");
assert.match(panelSource, /Step \{setupStep\} of 3/, "wizard must expose its current progress");
assert.match(panelSource, />Continue</, "wizard must have an explicit forward action");
assert.match(panelSource, />Back</, "wizard must let users return without losing their entries");
assert.match(panelSource, /SharedHiveEnvCredentialInput/, "Bankr setup must use the shared smart env selector");
assert.doesNotMatch(panelSource, /Verify key/, "provider verification belongs in the shared mode-aware credential action");
assert.match(panelSource, /type BankrWalletPath = "existing" \| "create";/, "wallet setup must model existing and new-user paths independently from the backend connection kind");
assert.match(panelSource, /Create wallet with Bankr/, "new users must have a working self-serve Bankr signup action when partner provisioning is unavailable");
assert.match(panelSource, /Create it directly with Bankr, then connect the new Wallet API key here\./, "the new-user path must explain how setup continues after Bankr creates the wallet");
assert.doesNotMatch(panelSource, /Waiting for Bankr partner access\./, "new-user setup must not dead-end on unavailable partner provisioning");
assert.match(panelSource, /paperTrialComplete/, "legacy direct-fee monitors must retain their original paper gate");
assert.match(panelSource, /BANKR_COPY_TRADING_RISK_ACKNOWLEDGEMENT/, "live controls must require the exact loss acknowledgement");
assert.match(panelSource, /BANKR_COPY_TRADING_FEE_ACKNOWLEDGEMENT/, "live controls must submit the exact direct-fee acknowledgement");
assert.match(panelSource, /riskAcknowledged/, "new live monitors must require separate risk consent");
assert.match(panelSource, /feeAcknowledged/, "new live monitors must require separate fee consent");
assert.match(panelSource, /Pay \$1 & start live/, "new monitors must activate live with the disclosed usage payment");
assert.match(panelSource, /baseUsdcBalance/, "setup must display the verified Bankr wallet's Base USDC balance");
assert.match(panelSource, /credited toward fees/, "the rolling minimum must be disclosed as fee credit rather than an additive fee");
assert.match(panelSource, /Uncapped/, "the percentage fee must be disclosed as uncapped");
assert.match(panelSource, /Bankr sponsors Base gas/, "funding guidance must not ask for unnecessary Base ETH");
assert.doesNotMatch(panelSource, /Pay with x402|Pay the x402 subscription|first paid period|Start paper trial/);
assert.match(panelSource, /Paper test complete/, "the UI must not offer an unlimited free-paper resume loop");
assert.doesNotMatch(panelSource, /One eligible paper event is free within|days run free in paper mode/, "new setup must not impose the legacy paper wait");
assert.match(panelSource, /activationIdempotencyKey/, "monitor start retries must reuse a stable idempotency key");
assert.match(panelSource, /action: "update"/, "subscription controls must expose hosted mode and risk updates");
assert.match(routeSource, /"update"/, "the authenticated local route must accept subscription updates");
assert.match(serviceSource, /riskAcknowledgement/, "hosted subscription patches must forward the exact live-risk acknowledgement");
assert.match(serviceSource, /feeAcknowledgement/, "hosted monitor patches must forward direct-fee consent");
assert.match(serviceSource, /riskAcknowledgement: input\.riskAcknowledgement \|\| ""/, "the server adapter must not invent live consent");
assert.match(serviceSource, /feeAcknowledgement: input\.feeAcknowledgement \|\| ""/, "the server adapter must not invent commercial consent");
assert.doesNotMatch(serviceSource, /companyTaskId/, "copy trading is user-level wallet work and must never attach company task context");
assert.doesNotMatch(localCopyEngineSource, /companyTaskId|spend-governance|getCompanyForAgent/, "the in-app copy trader must never infer company restrictions either");
assert.match(routeSource, /apiKeyEnv/, "Bankr actions must accept a server-side shared env reference");
assert.match(routeSource, /resolveBankrCopyApiKey/, "Bankr actions must resolve shared env values server-side");
assert.match(routeSource, /writeSharedHiveEnvValue/, "verified manual Bankr keys must save through hive-env-add");
assert.match(smartEnvInputSource, /keysOnly=1|loadSharedHiveEnvKeys/, "the selector must load env names without loading secrets");
assert.match(smartEnvInputSource, /Pencil/, "the selector must expose the segmented manual-edit action");
assert.match(smartEnvInputSource, /Search shared env variables/, "the selector must provide searchable env-name discovery");
assert.match(smartEnvInputSource, /saveSharedHiveEnvValue/, "providers without custom verification must use the standard shared env save path");
assert.match(
  smartEnvInputSource,
  /const actionLabel = mode === "existing" \? continueLabel : saveLabel/,
  "an existing env selection must Continue while a new manual value must Save",
);
assert.match(
  smartEnvInputSource,
  /const busyLabel = mode === "existing" \? "Continuing…" : "Saving…"/,
  "the in-progress label must preserve the existing-versus-new distinction",
);
assert.match(
  smartEnvCssSource,
  /--smart-credential-height:\s*38px/,
  "the shared credential row must use the compact control height",
);
assert.match(
  smartEnvCssSource,
  /\.smartCredentialRow\s*\{[^}]*align-items:\s*center/s,
  "the primary action must not stretch taller than the credential control",
);
assert.match(
  smartEnvCssSource,
  /\.smartCredential \.smartSecretField\s*\{[^}]*border-radius:\s*calc\(var\(--he-radius-sm\) - 1px\)\s+0\s+0\s+calc\(var\(--he-radius-sm\) - 1px\)/s,
  "the manual input must win over consumer input styles and join the pencil segment flatly",
);

const {
  BANKR_COPY_TRADING_VAULT_PATH,
  getBankrCopyCredential,
  listBankrCopyCredentials,
  listBankrCopyRecoveries,
  removeBankrCopyCredential,
  removeBankrCopyRecovery,
  storeBankrCopyCredential,
  storeBankrCopyRecovery,
} = await import("../src/lib/services/trading/bankr-copy-trading-vault.ts");

const first = fixture("sub_one", "0x1111111111111111111111111111111111111111");
const second = fixture("sub_two", "0x2222222222222222222222222222222222222222");
const firstToken = "ct_access_first_secret";
const secondToken = "ct_access_second_secret";

try {
  await Promise.all([
    storeBankrCopyCredential({ subscription: first, accessToken: firstToken }),
    storeBankrCopyCredential({ subscription: second, accessToken: secondToken }),
  ]);

  const records = await listBankrCopyCredentials();
  assert.equal(records.length, 2, "concurrent writes must retain both subscriptions");
  assert.equal((await getBankrCopyCredential(first.id))?.accessToken, firstToken);
  assert.equal((await getBankrCopyCredential(second.id))?.subscription.targetWallet, second.targetWallet);

  const persisted = await readFile(BANKR_COPY_TRADING_VAULT_PATH, "utf8");
  assert.doesNotMatch(persisted, new RegExp(firstToken));
  assert.doesNotMatch(persisted, new RegExp(secondToken));
  assert.equal((await stat(BANKR_COPY_TRADING_VAULT_PATH)).mode & 0o777, 0o600);

  await removeBankrCopyCredential(first.id);
  assert.equal(await getBankrCopyCredential(first.id), null);
  assert.equal((await listBankrCopyCredentials()).length, 1);

  const receiptId = `copy-trading-x402:0x${"c".repeat(64)}`;
  const recoveryToken = "v1.encrypted.server.recovery-token";
  await storeBankrCopyRecovery({ receiptId, recoveryToken });
  assert.deepEqual(await listBankrCopyRecoveries(), [{ receiptId, recoveryToken }]);
  assert.doesNotMatch(await readFile(BANKR_COPY_TRADING_VAULT_PATH, "utf8"), new RegExp(recoveryToken));
  await removeBankrCopyRecovery(receiptId);
  assert.deepEqual(await listBankrCopyRecoveries(), []);

  const tampered = JSON.parse(await readFile(BANKR_COPY_TRADING_VAULT_PATH, "utf8"));
  tampered.records[second.id].encryptedAccessToken = "AAAA";
  await writeFile(BANKR_COPY_TRADING_VAULT_PATH, JSON.stringify(tampered), { mode: 0o600 });
  await assert.rejects(
    listBankrCopyCredentials(),
    /authenticate|Unsupported state/i,
    "tampered ciphertext must fail closed",
  );

  console.log("Managed Bankr copy-trading credential vault checks passed.");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

function fixture(id, targetWallet) {
  return {
    id,
    targetWallet,
    bankrWallet: "0x3333333333333333333333333333333333333333",
    bankrConnectionKind: "existing",
    executionProvider: "bankr-managed",
    status: "active",
    mode: "paper",
    billingModel: "bankr-per-trade",
    billing: {
      feePolicyVersion: "2026-07-16-bankr-direct-v1",
      feeBps: 50,
      feePercent: 0.5,
      minimumFeeUsd: 0.02,
      maximumFeeUsd: 0.5,
    },
    maxTradeUsd: 5,
    maxDailyUsd: 25,
    scalePercent: 20,
    maxSlippageBps: 100,
    paperTrialEndsAt: "2026-07-23T00:00:00.000Z",
    expiresAt: "2026-07-23T00:00:00.000Z",
    renews: false,
  };
}
