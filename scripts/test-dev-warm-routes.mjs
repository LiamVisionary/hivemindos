import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const source = readFileSync(new URL("./dev-server.mjs", import.meta.url), "utf8");

assert.match(
  source,
  /warmRoutes\.push\(\s*"\/stake",\s*"\/api\/chat\/agent-runtime",\s*"\/api\/chat\/image-generation",\s*"\/api\/queen-bee\/chat",\s*"\/api\/queen-bee\/voice",/s,
  "Default dev warm routes should keep the Stake page warm before heavy chat APIs, including Queen text chat.",
);

assert.match(
  source,
  /method:\s*route\.startsWith\("\/api\/"\)\s*\?\s*"OPTIONS"\s*:\s*"HEAD"/,
  "Dev warmer should use HEAD for page routes because Next pages reject OPTIONS.",
);

assert.match(
  source,
  /if \(!response\.ok\) allOk = false;/,
  "Dev warmer should not treat failed warm-up responses as compiled routes.",
);

assert.match(
  source,
  /HIVEMINDOS_DEV_WARM_ROUTES/,
  "Dev warm routes should remain configurable through HIVEMINDOS_DEV_WARM_ROUTES.",
);

console.log("Dev warm routes keep the Stake page hot and use the correct warm-up method.");
