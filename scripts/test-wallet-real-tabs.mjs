#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dataSource = readFileSync(join(root, "src/components/wallets-drop-in/wallet-data.ts"), "utf8");
const viewSource = readFileSync(join(root, "src/components/wallets-drop-in/WalletsView.tsx"), "utf8");
const rewardActionsSource = readFileSync(join(root, "src/components/wallets-drop-in/WalletRewardsActions.tsx"), "utf8");
const panelSource = readFileSync(join(root, "src/features/dashboard/views/WalletPanel.tsx"), "utf8");
const nativePersonalWalletsSource = readFileSync(join(root, "src/lib/native/personal-wallets.ts"), "utf8");
const nativeObsidianSource = readFileSync(join(root, "src-tauri/src/obsidian.rs"), "utf8");
const activityRouteSource = readFileSync(join(root, "src/app/api/wallet/activity/route.ts"), "utf8");
const dashboardSource = readFileSync(join(root, "src/features/dashboard/DashboardApp.tsx"), "utf8");

assert.match(dataSource, /export const FR_USAGE_SERIES = \[\];/);
assert.match(dataSource, /export const FR_HONEY_LEDGER = \[\];/);
assert.match(dataSource, /export const FR_LEDGER = \[\];/);
assert.match(dataSource, /export const FR_MACHINES = \[\];/);
assert.match(dataSource, /export const FR_MY_WALLETS = \[\];/);
assert.match(dataSource, /export const FR_WALLET_META = \{\};/);
assert.match(dataSource, /status: "unknown", models: 0, route: "Not checked"/);
assert.match(dataSource, /FR_LEDGER\.splice\(0, FR_LEDGER\.length, \.\.\.\(Array\.isArray\(data\.activityLedger\)/);
assert.match(dataSource, /FR_USAGE_SERIES\.splice\(0, FR_USAGE_SERIES\.length, \.\.\.\(Array\.isArray\(data\.usageSeries\)/);
assert.match(dataSource, /FR_USAGE_ROWS\.splice\(0, FR_USAGE_ROWS\.length, \.\.\.\(Array\.isArray\(data\.usageRows\)/);
assert.match(dataSource, /FR_HONEY_LEDGER\.splice\(0, FR_HONEY_LEDGER\.length, \.\.\.\(Array\.isArray\(data\.honeyLedger\)/);
assert.match(dataSource, /FR_HONEY_BY_AGENT\.splice\(0, FR_HONEY_BY_AGENT\.length, \.\.\.\(Array\.isArray\(data\.honeyByAgent\)/);
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

assert.match(panelSource, /fetch\("\/api\/wallet\/activity\?limit=100"/);
assert.match(panelSource, /fetch\("\/api\/honey-ledger"/);
assert.match(panelSource, /import \{ readNativePersonalWallets \} from "@\/lib\/native\/personal-wallets"/);
assert.match(panelSource, /readNativePersonalWallets\(\{ vaultPath \}\)[\s\S]*fetch\(`\/api\/wallet\/personal/);
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
assert.match(panelSource, /loadWalletActivity\(\)/);
assert.match(panelSource, /loadHoneyLedger\(\)/);
assert.match(panelSource, /function hasHiveEnvKey/);
assert.match(panelSource, /function buildRailRuntimeOverrides/);
assert.match(panelSource, /function buildUsePodRuntimeData/);
assert.match(panelSource, /railOverrides: buildRailRuntimeOverrides\(props, agents, railEnabledOverrides\)/);
assert.match(panelSource, /usePod: buildUsePodRuntimeData\(props, agents\)/);
assert.match(panelSource, /credentialPresent/);

assert.match(dashboardSource, /honeyStats, hiveEnv, hydrated/);
assert.match(viewSource, /const appliedRuntimeDataRef = React\.useRef\(null\)/);
assert.match(viewSource, /appliedRuntimeDataRef\.current !== runtimeData/);
assert.match(viewSource, /appliedRuntimeDataRef\.current = runtimeData/);

assert.match(nativePersonalWalletsSource, /isTauriDesktopRuntime\(\)/);
assert.match(nativePersonalWalletsSource, /invoke<NativePersonalWalletsPayload>\("obsidian_personal_wallets"/);
assert.doesNotMatch(nativePersonalWalletsSource, /nativePrivateFilesystemAccessGranted/);
assert.doesNotMatch(nativePersonalWalletsSource, /allowPrivateFilesystem/);
assert.match(nativeObsidianSource, /pub fn obsidian_personal_wallets\(vault_path: Option<String>\)/);
assert.match(nativeObsidianSource, /fn split_json_objects/);
assert.doesNotMatch(nativeObsidianSource, /allow_private_filesystem/);

const actionRefs = new Set([...`${viewSource}\n${rewardActionsSource}`.matchAll(/actions\?\.([a-zA-Z0-9_]+)/g)].map((match) => match[1]));
const walletActionsBody = panelSource.match(/const walletActions = useMemo\(\(\) => \(\{([\s\S]*?)\n\s*\}\), \[/)?.[1] ?? "";
const providedActions = new Set([...walletActionsBody.matchAll(/\n\s*([a-zA-Z0-9_]+)\s*:/g)].map((match) => match[1]));
const dataProps = new Set(["bankrRecipientAddress", "bankrRewards", "formatHiveAmount", "walletVaultBackup"]);
assert.deepEqual([...actionRefs].filter((name) => !providedActions.has(name) && !dataProps.has(name)).sort(), []);
assert.deepEqual([...providedActions].filter((name) => !actionRefs.has(name)).sort(), []);

assert.match(activityRouteSource, /readSpendLedger/);
assert.match(activityRouteSource, /requireAuth/);
assert.match(activityRouteSource, /sort\(\(left, right\) => Number\(right\.createdAtMs/);

console.log("Wallet tab real-data wiring tests passed.");
