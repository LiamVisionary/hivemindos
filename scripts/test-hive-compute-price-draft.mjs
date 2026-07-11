import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const helperUrl = new URL("../src/components/fleet/hive-compute-price-draft.ts", import.meta.url);
assert.equal(existsSync(helperUrl), true, "Custom pricing needs a backspace-safe draft parser");

const { parseHiveComputePriceDraft } = await import(helperUrl.href);

assert.equal(parseHiveComputePriceDraft("", { min: 0.01, max: 20 }), null, "an empty draft must stay empty while the user is editing");
assert.equal(parseHiveComputePriceDraft(".", { min: 0.01, max: 20 }), null, "an incomplete decimal must not be coerced to the minimum");
assert.equal(parseHiveComputePriceDraft("0.35", { min: 0.01, max: 20 }), 0.35);
assert.equal(parseHiveComputePriceDraft("-2", { min: 0.01, max: 20 }), 0.01);
assert.equal(parseHiveComputePriceDraft("50", { min: 0.01, max: 20 }), 20);

console.log("Hive Compute custom-price draft tests passed.");
