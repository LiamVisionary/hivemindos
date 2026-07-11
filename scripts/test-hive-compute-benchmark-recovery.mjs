import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const helperUrl = new URL("../src/components/fleet/hive-compute-benchmark-recovery.ts", import.meta.url);
assert.equal(existsSync(helperUrl), true, "Hive Compute needs a benchmark timeout recovery helper");

const {
  isHiveComputeBenchmarkProxyTimeout,
  waitForHiveComputeBenchmarkCompletion,
} = await import(helperUrl.href);

assert.equal(isHiveComputeBenchmarkProxyTimeout({ code: "DEV_PROXY_TIMEOUT" }), true);
assert.equal(isHiveComputeBenchmarkProxyTimeout({ code: "DEV_PROXY_UNAVAILABLE" }), false);

const snapshots = [{ complete: false }, { complete: true }];
const recovered = await waitForHiveComputeBenchmarkCompletion({
  poll: async () => snapshots.shift(),
  isComplete: (snapshot) => snapshot?.complete === true,
  wait: async () => undefined,
  timeoutMs: 5_000,
});
assert.deepEqual(recovered, { complete: true }, "recovery should keep polling until the persisted benchmark is complete");

let now = 0;
await assert.rejects(
  () => waitForHiveComputeBenchmarkCompletion({
    poll: async () => ({ complete: false }),
    isComplete: () => false,
    wait: async () => undefined,
    now: () => {
      now += 1_000;
      return now;
    },
    timeoutMs: 500,
  }),
  /still running/i,
  "recovery must end with an actionable error instead of polling forever",
);

console.log("Hive Compute benchmark timeout recovery tests passed.");
