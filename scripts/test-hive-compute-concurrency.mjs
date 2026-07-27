import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const helperUrl = new URL("../src/components/fleet/hive-compute-concurrency.ts", import.meta.url);
assert.equal(existsSync(helperUrl), true, "Hive Compute needs a tested concurrency-cap transition helper");

const { concurrencyAfterAdvertisedModelChange } = await import(helperUrl.href);

assert.equal(concurrencyAfterAdvertisedModelChange(1, 1, 2), 2, "1/1 should become 2/2 when a model is added");
assert.equal(concurrencyAfterAdvertisedModelChange(2, 2, 3), 3, "2/2 should become 3/3 when a model is added");
assert.equal(concurrencyAfterAdvertisedModelChange(1, 2, 3), 1, "a user-selected 1/2 should remain 1/3 when a model is added");
assert.equal(concurrencyAfterAdvertisedModelChange(3, 3, 2), 2, "removing a model from 3/3 should clamp to 2/2");
assert.equal(concurrencyAfterAdvertisedModelChange(2, 3, 2), 2, "removing a model from 2/3 should preserve two concurrent jobs");
assert.equal(concurrencyAfterAdvertisedModelChange(1, 1, 0), 1, "zero advertised models must retain the valid minimum concurrency");

console.log("Hive Compute concurrency transition tests passed.");
