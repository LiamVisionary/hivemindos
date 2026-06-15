#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS,
  HIVE_STAKING_TIERS,
  hiveStakingContractAddress,
  hiveTierForStakedHive,
  hiveTierForStakedRaw,
  scaleHiveAmount,
  isHiveEvmAddress,
} = await import("../src/lib/services/hive-staking.ts");

let passed = 0;
function check(label, condition) {
  assert.ok(condition, label);
  passed += 1;
}

check("tier table starts with holder", HIVE_STAKING_TIERS[0].id === "holder");
check("tier table ends with visionary", HIVE_STAKING_TIERS.at(-1).id === "visionary");
check("below holder has no tier", hiveTierForStakedHive(999_999n) === null);
check("holder threshold resolves holder", hiveTierForStakedHive(1_000_000n)?.id === "holder");
check("supporter threshold resolves supporter", hiveTierForStakedHive(10_000_000n)?.id === "supporter");
check("builder threshold resolves builder", hiveTierForStakedHive(50_000_000n)?.id === "builder");
check("curator threshold resolves curator", hiveTierForStakedHive(100_000_000n)?.id === "curator");
check("operator threshold resolves operator", hiveTierForStakedHive(250_000_000n)?.id === "operator");
check("visionary threshold resolves visionary", hiveTierForStakedHive(1_000_000_000n)?.id === "visionary");
check("higher values keep highest tier", hiveTierForStakedHive(5_000_000_000n)?.id === "visionary");

check("18 decimal raw holder resolves holder", hiveTierForStakedRaw(scaleHiveAmount(1_000_000n, 18), 18)?.id === "holder");
check("6 decimal raw supporter resolves supporter", hiveTierForStakedRaw(scaleHiveAmount(10_000_000n, 6), 6)?.id === "supporter");
check("pending/raw below threshold resolves null", hiveTierForStakedRaw(scaleHiveAmount(1_000_000n, 18) - 1n, 18) === null);
check("valid evm address accepted", isHiveEvmAddress("0x0000000000000000000000000000000000000001"));
check("invalid evm address rejected", !isHiveEvmAddress("0x123"));
check("public Base staking vault default is configured", hiveStakingContractAddress() === DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS);

let threw = false;
try {
  scaleHiveAmount(1n, -1);
} catch {
  threw = true;
}
check("invalid decimals throw", threw);

console.log(`ok: ${passed} HIVE staking assertions passed`);
