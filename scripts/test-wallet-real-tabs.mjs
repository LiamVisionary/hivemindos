#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dataSource = readFileSync(join(root, "src/components/wallets-drop-in/wallet-data.ts"), "utf8");
const viewSource = readFileSync(join(root, "src/components/wallets-drop-in/WalletsView.tsx"), "utf8");
const rewardActionsSource = readFileSync(join(root, "src/components/wallets-drop-in/WalletRewardsActions.tsx"), "utf8");
const panelSource = readFileSync(join(root, "src/features/dashboard/views/WalletPanel.tsx"), "utf8");
const walletControllerSource = readFileSync(join(root, "src/features/dashboard/hooks/use-wallet-files-controller.tsx"), "utf8");
const nativePersonalWalletsSource = readFileSync(join(root, "src/lib/native/personal-wallets.ts"), "utf8");
const nativeObsidianSource = readFileSync(join(root, "src-tauri/src/obsidian.rs"), "utf8");
const activityRouteSource = readFileSync(join(root, "src/app/api/wallet/activity/route.ts"), "utf8");
const dashboardSource = readFileSync(join(root, "src/features/dashboard/DashboardApp.tsx"), "utf8");
const walletLedgerSource = readFileSync(join(root, "src/lib/services/obsidian/wallet-ledger.ts"), "utf8");

assert.match(dataSource, /export const FR_USAGE_SERIES(?:: [A-Za-z]+\[\])? = \[\];/);
assert.match(dataSource, /export const FR_HONEY_LEDGER(?:: [A-Za-z]+\[\])? = \[\];/);
assert.match(dataSource, /export const FR_LEDGER(?:: [A-Za-z]+\[\])? = \[\];/);
assert.match(dataSource, /export const FR_MACHINES(?:: [A-Za-z]+\[\])? = \[\];/);
assert.match(dataSource, /export const FR_MY_WALLETS(?:: [A-Za-z]+\[\])? = \[\];/);
assert.match(dataSource, /export const FR_WALLET_META(?:: Record<[^>]+>)? = \{\};/);
assert.match(dataSource, /status: "unknown", models: 0, route: "Not checked"/);
assert.match(dataSource, /FR_LEDGER\.splice\(0, FR_LEDGER\.length, \.\.\.\(Array\.isArray\(data\.activityLedger\)/);
assert.match(dataSource, /FR_USAGE_SERIES\.splice\(0, FR_USAGE_SERIES\.length, \.\.\.\(Array\.isArray\(data\.usageSeries\)/);
assert.match(dataSource, /FR_USAGE_ROWS\.splice\(0, FR_USAGE_ROWS\.length, \.\.\.\(Array\.isArray\(data\.usageRows\)/);
assert.match(dataSource, /FR_HONEY_LEDGER\.splice\(0, FR_HONEY_LEDGER\.length, \.\.\.\(Array\.isArray\(data\.honeyLedger\)/);
assert.match(dataSource, /FR_HONEY_BY_AGENT\.splice\(0, FR_HONEY_BY_AGENT\.length, \.\.\.\(Array\.isArray\(data\.honeyByAgent\)/);
assert.match(dataSource, /if \(amt < 1\) return amt\.toLocaleString\(undefined, \{ maximumFractionDigits: 6 \}\)/);
assert.match(dataSource, /Object\.assign\(rail, override\)/);
assert.match(dataSource, /Object\.assign\(FR_USEPOD, data\.usePod\)/);
assert.doesNotMatch(dataSource, /Hermes-α|MiroShark-sim|Main Treasury|upk_7f|pod-8Fq2|Healthy · 142|142 models/);

assert.match(viewSource, /No wallet payment activity has been recorded yet\./);
assert.match(viewSource, /No runtime usage has been recorded yet\./);
assert.match(viewSource, /No Honey ledger events have been recorded yet\./);
assert.match(viewSource, /Math\.max\(1, \.\.\.FR_USAGE_SERIES\.map/);
assert.match(viewSource, /Math\.max\(1, \.\.\.byAgent\.map/);
assert.match(viewSource, /const statusLabel = String\(u\.status \|\| "unknown"\)/);
assert.doesNotMatch(viewSource, /Status<\/span><strong style=\{\{ color: "var\(--live\)" \}\}>Ready/);
assert.match(viewSource, /alignItems: "flex-start", gap: 22/);

assert.match(panelSource, /fetch\("\/api\/wallet\/activity\?limit=100"/);
assert.match(panelSource, /fetch\("\/api\/honey-ledger"/);
// The native-then-HTTP read now lives inside the personal-wallets module; the
// panel consumes it through the fetchPersonalWalletRecords wrapper.
assert.match(panelSource, /import \{ fetchPersonalWalletRecords \} from "@\/lib\/native\/personal-wallets"/);
assert.match(nativePersonalWalletsSource, /readNativePersonalWallets\(\{ vaultPath \}\)/);
assert.match(nativePersonalWalletsSource, /fetch\(`\/api\/wallet\/personal/);
assert.match(nativePersonalWalletsSource, /nativeWallets \? mergePersonalWalletRecords\(nativeWallets, httpWallets\) : httpWallets/);
assert.match(panelSource, /buildActivityLedger\(walletActivity, agents\)/);
assert.match(panelSource, /buildUsageRows\(props\?\.runtimeUsage, honeyLedger, agents\)/);
assert.match(panelSource, /buildHoneyLedgerRows\(honeyLedger, agents\)/);
assert.match(panelSource, /const refreshRuntimeUsageRef = useRef\(refreshRuntimeUsage\)/);
assert.match(panelSource, /refreshRuntimeUsageRef\.current = refreshRuntimeUsage/);
assert.match(panelSource, /refreshRuntimeUsageRef\.current\?\.\(\)/);
assert.doesNotMatch(panelSource, /void refreshRuntimeUsage\?\.\(\)/);
assert.doesNotMatch(panelSource, /\}, \[activeView, refreshRuntimeUsage\]\);/);
assert.match(panelSource, /const runtimeDataSource = useMemo/);
assert.doesNotMatch(panelSource, /buildDropInRuntimeData\(props, personalWallets/);
assert.match(panelSource, /mergePersonalWalletSources\(personalWallets, effectiveWalletsByAgent\)/);
assert.match(panelSource, /refreshPersonalWalletBalances/);
assert.match(panelSource, /PERSONAL_WALLET_TOKEN_REFRESH_MS/);
assert.match(walletControllerSource, /totalValueUsd/);
assert.match(walletControllerSource, /Balance refreshed: \$\$\{currentBalanceUsd\.toFixed\(2\)\} total/);
assert.match(walletLedgerSource, /\["tokens", record\.wallet\.tokens\]/);
assert.match(walletLedgerSource, /tokens: parseWalletTokens\(fm\.tokens\)/);
assert.match(panelSource, /loadWalletActivity\(\)/);
assert.match(panelSource, /loadHoneyLedger\(\)/);
assert.match(panelSource, /function hasHiveEnvKey/);
assert.match(panelSource, /function buildRailRuntimeOverrides/);
assert.match(panelSource, /function buildUsePodRuntimeData/);
assert.match(panelSource, /railOverrides: buildRailRuntimeOverrides\(props, agents, railEnabledOverrides\)/);
assert.match(panelSource, /usePod: buildUsePodRuntimeData\(props, agents\)/);
assert.match(panelSource, /credentialPresent/);

assert.match(dashboardSource, /honeyStats, hiveEnv, hydrated/);
assert.match(viewSource, /const appliedRuntimeDataRef = React\.useRef(?:<[^>]+>)?\(null\)/);
assert.match(viewSource, /appliedRuntimeDataRef\.current !== runtimeData/);
assert.match(viewSource, /appliedRuntimeDataRef\.current = runtimeData/);

assert.match(nativePersonalWalletsSource, /isTauriDesktopRuntime\(\)/);
assert.match(nativePersonalWalletsSource, /invoke<NativePersonalWalletsPayload>\("obsidian_personal_wallets"/);
assert.doesNotMatch(nativePersonalWalletsSource, /nativePrivateFilesystemAccessGranted/);
assert.doesNotMatch(nativePersonalWalletsSource, /allowPrivateFilesystem/);
assert.match(nativeObsidianSource, /pub fn obsidian_personal_wallets\(vault_path: Option<String>\)/);
assert.match(nativeObsidianSource, /fn split_json_objects/);
assert.match(nativeObsidianSource, /fn wallet_tokens_field/);
assert.match(nativeObsidianSource, /"tokens": wallet_tokens_field\(&fm, "tokens"\)/);
assert.doesNotMatch(nativeObsidianSource, /allow_private_filesystem/);

// Scan every drop-in component: modals/sheets consume actions too (e.g.
// CreateImportWalletModal, WalletSecretExportSheet).
const { readdirSync } = await import("node:fs");
const dropInDir = join(root, "src/components/wallets-drop-in");
const dropInSources = readdirSync(dropInDir)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(join(dropInDir, name), "utf8"))
  .join("\n");
const actionRefs = new Set([...dropInSources.matchAll(/actions\?\.([a-zA-Z0-9_]+)/g)].map((match) => match[1]));
const walletActionsBody = panelSource.match(/const walletActions = useMemo\(\(\) => \(\{([\s\S]*?)\n\s*\}\), \[/)?.[1] ?? "";
const providedActions = new Set([...walletActionsBody.matchAll(/\n\s*([a-zA-Z0-9_]+)\s*:/g)].map((match) => match[1]));
const dataProps = new Set(["bankrRecipientAddress", "bankrRewards", "formatHiveAmount", "walletVaultBackup"]);
// Keys of nested result objects inside the memo body that the line-based
// extractor picks up but that are not actions (e.g. the fund-result field).
const nestedResultFields = new Set(["recipientBalanceUsd"]);
assert.deepEqual([...actionRefs].filter((name) => !providedActions.has(name) && !dataProps.has(name)).sort(), []);
assert.deepEqual([...providedActions].filter((name) => !actionRefs.has(name) && !nestedResultFields.has(name)).sort(), []);

assert.match(activityRouteSource, /readSpendLedger/);
assert.match(activityRouteSource, /requireAuth/);
assert.match(activityRouteSource, /sort\(\(left, right\) => Number\(right\.createdAtMs/);

console.log("Wallet tab real-data wiring tests passed.");
