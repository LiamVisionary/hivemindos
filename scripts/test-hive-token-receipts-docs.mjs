import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), "utf8");
const receipts = read("docs/for-investors/hive-token-receipts.md");

assert.match(receipts, /0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3/);
assert.match(receipts, /zero creator premint/i);
assert.match(receipts, /same wallet receives 95%[\s\S]*centralized fee right/i);
assert.match(receipts, /NoOpMigrator[\s\S]*always reverts migration/i);
assert.match(receipts, /2% yearly inflation parameter/i);
assert.match(receipts, /17\.986%/);
assert.match(receipts, /not a smart-contract audit or financial advice/i);
assert.doesNotMatch(receipts, /guaranteed return|guaranteed price/i);
assert.match(read("docs/for-investors/index.md"), /HIVE Token Receipts/);
assert.match(read("docs/for-investors/ai-context.txt"), /Every public Markdown page under docs\/for-investors/);

console.log("HIVE token receipt documentation checks passed.");
