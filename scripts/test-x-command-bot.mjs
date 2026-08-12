import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const driver = source("src/lib/services/x-command/x-command-driver.ts");
const route = source("src/app/api/integrations/x-command/route.ts");
const vault = source("src/lib/services/x-command/x-command-device-vault.ts");
const client = source("src/lib/services/x-command/x-command-client.ts");
const instrumentation = source("src/instrumentation.ts");
const panel = source("src/features/integrations/XCommandBotPanel.tsx");
const integrations = source("src/features/integrations/IntegrationsView.tsx");
const policy = source("src/lib/services/x-command/x-command-wallet-policy.ts");
const execution = source("src/lib/services/x-command/x-command-trade-executor.ts");

assert.match(route, /requireAuth\(request\)/, "the local X command API must require app authentication");
assert.match(driver, /toolChoice:\s*"none"/, "read-only X analysis must disable Queen tool calls");
assert.match(driver, /suppressWalletIntents:\s*true/, "the X lane must suppress wallet intents");
assert.match(driver, /This lane is read-only/, "the Queen must receive an explicit read-only boundary");
assert.match(driver, /job\.intent/, "the local Queen receives the typed post or token analysis intent");
assert.match(driver, /financial advice/, "token analysis keeps an explicit financial-safety instruction");
assert.match(driver, /readXCommandDevice\(\)/, "the driver must use the paired local device credential");
assert.match(driver, /job\.kind === "trade\.execute"/, "typed trade jobs must use the local trade executor instead of the Queen");
assert.match(driver, /executeXCommandTrade/, "the paired local bridge must own X trade execution");
assert.match(driver, /tradeExecutionEnabled/, "a device without an enabled local bot-wallet policy must not claim trade jobs");
assert.match(driver, /X_TRADE_JOB_MAX_AGE_MS/, "the local signer must reject stale trade jobs even if a hosted queue regresses");

assert.match(vault, /aes-256-gcm/, "the paired device credential must be encrypted at rest");
assert.match(vault, /mode:\s*0o600/, "the credential vault and key must be owner-only");
assert.match(client, /https:\/\/hivemindos-x-command-gateway\.hivemindos\.workers\.dev/, "the official gateway must be the default");
assert.match(instrumentation, /action:\s*"start-driver"/, "the local Queen bridge must resume with HivemindOS");

assert.match(panel, /Maximum automatic paid command/, "the setup UI must expose a per-command spend cap");
assert.match(panel, /Set \$0 to disable paid commands/, "the setup UI must explain the zero-spend control");
assert.match(panel, /Enable X commands for every connected identity/, "the setup UI must authorize every connected identity together");
assert.match(panel, /stop<\/code> disables only the identity/, "the setup UI must document identity-scoped opt-out");
assert.doesNotMatch(panel, /<select[^>]*value=\{connectionId\}/, "the setup UI must not make connected identities mutually exclusive");
assert.match(panel, /Uses this hosted balance and the shared command limit/, "each connected identity must show its shared policy");
assert.doesNotMatch(route, /connectionId:\s*body\.connectionId/, "the desktop must not submit one selected identity as the account policy");
assert.match(panel, /what do you think about this post\?/, "the primary examples must include reply-context post analysis");
assert.match(panel, /buy \$5 of ETH/, "the primary examples must include an executable token order");
assert.match(panel, /buy \$5 of AAPL/, "the primary examples must include an executable stock order");
assert.doesNotMatch(panel, /ask queen what are my current priorities/i, "the UI must not headline the old infrastructure-style Queen syntax");
assert.doesNotMatch(panel, /<code>\{botName\} status<\/code>/, "status must not occupy a primary command example");
assert.match(panel, /HivemindOSBot wallet/, "the X Bot UI must expose its dedicated acting wallet");
assert.match(panel, /WalletSelectModal/, "the dedicated X wallet button must open the established wallet selector modal");
assert.match(panel, /Hosted credit balance/, "the X Bot UI must show the authoritative hosted balance in place");
assert.match(panel, /Connect managed X account/, "managed X OAuth must be directly reachable from the X Bot tab");
assert.match(policy, /x-command-wallet-policy\.json/, "the one-time wallet authorization must persist outside browser storage");
assert.match(policy, /dailyTradeLimitUsd/, "the authorization must bind a rolling daily trade limit");
assert.match(policy, /duplicate/, "the local receipt ledger must make repeated device jobs idempotent");
assert.match(policy, /expectedPolicyRevision/, "a quote must remain bound to the exact wallet-policy revision that authorized it");
assert.match(execution, /getWalletSecret\(account\.walletId\)/, "the local signer must be resolved authoritatively from the selected wallet id");
assert.match(execution, /SWAP_CONFIRMATION/, "the X-specific executor may reuse the proven automatic swap rail without weakening manual routes");
assert.doesNotMatch(execution, /fetch\([^\n]*hivemindos-x-command-gateway/, "the local executor must never send a wallet secret to the hosted Worker");
assert.match(integrations, /<XCommandBotPanel/, "the X command bot must be reachable from Integrations");

console.log("test-x-command-bot: one-time wallet authorization, local execution, OAuth, and balance UX contracts are present");
