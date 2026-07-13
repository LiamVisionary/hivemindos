#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
const claude = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
const endpoint = "https://hivemindos-paid-agent-gateway.hivemindos.workers.dev/api/commercial/catalog";

for (const [name, source] of [["AGENTS.md", agents], ["CLAUDE.md", claude]]) {
  assert.ok(source.includes(endpoint), `${name} must name the canonical commercial catalog`);
  assert.match(source, /\?service=<service-id>/, `${name} must document focused service queries`);
  assert.match(source, /pricing[\s\S]*free (?:quota|allowance)[\s\S]*discount[\s\S]*cost[\s\S]*margin/i,
    `${name} must require catalog lookup for commercial decisions`);
  assert.match(source, /update[\s\S]*(?:same change|whenever)[\s\S]*(?:catalog|owning service)/i,
    `${name} must require catalog maintenance alongside commercial changes`);
  assert.match(source, /missing[\s\S]*(?:do not infer|never infer|must not infer)/i,
    `${name} must preserve honest accounting gaps`);
}

console.log("commercial-catalog-discipline: agent instructions require canonical live accounting lookup and maintenance");
