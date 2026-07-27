#!/usr/bin/env node
// Hermetic: Fleet's Open Chat guard should allow the free HivemindOS Scout
// model even when the agent wallet is off, while paid HivemindOS routes still
// require a funded wallet or credits.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  fleetAgentNeedsModelSetup,
  isHivemindosModelsProvider,
} = await import("../src/features/dashboard/agent-chat-readiness.ts");

const baseAgent = {
  provider: "openai-codex",
  model: "gpt-5.5-codex",
  balance: "off",
};

assert.equal(fleetAgentNeedsModelSetup(baseAgent), false, "generic configured models should open chat");
assert.equal(fleetAgentNeedsModelSetup({ ...baseAgent, model: "" }), true, "generic blank models still need setup");
assert.equal(
  fleetAgentNeedsModelSetup(
    { ...baseAgent, provider: "lm-studio", model: "" },
    { provider: "lm-studio", model: "local/qwen", providers: [] },
  ),
  false,
  "a live runtime model selection should satisfy the Fleet chat gate",
);

assert.equal(isHivemindosModelsProvider("hivemindos-models"), true);
assert.equal(isHivemindosModelsProvider("HivemindOS"), true);
assert.equal(isHivemindosModelsProvider("openrouter"), false);

assert.equal(
  fleetAgentNeedsModelSetup({
    provider: "hivemindos-models",
    model: "hivemindos/swarm-sovereign-scout",
    balance: "off",
  }),
  false,
  "free Scout must not require a funded wallet",
);

assert.equal(
  fleetAgentNeedsModelSetup({
    provider: "hivemindos-models",
    model: "",
    balance: "off",
  }),
  false,
  "blank HivemindOS model falls back to the free Scout default",
);

assert.equal(
  fleetAgentNeedsModelSetup({
    provider: "hivemindos-models",
    model: "hivemindos/auto",
    balance: "off",
  }),
  true,
  "paid HivemindOS routes still need funding",
);

assert.equal(
  fleetAgentNeedsModelSetup({
    provider: "hivemindos-models",
    model: "hivemindos/auto",
    balance: "healthy",
  }),
  false,
  "paid HivemindOS routes can open when funded",
);

console.log("PASS test-agent-chat-readiness");
