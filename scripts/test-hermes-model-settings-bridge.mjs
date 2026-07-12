#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  hermesModelSelectionFromPayload,
  hermesProfileName,
  readHermesModelSelection,
  setHermesModelAssignment,
} from "./lib/hermes-model-settings.mjs";

const selection = hermesModelSelectionFromPayload({
  provider: "openrouter",
  model: "anthropic/claude-sonnet-4.6",
  providers: [
    {
      slug: "openrouter",
      name: "OpenRouter",
      models: ["anthropic/claude-sonnet-4.6", { id: "openai/gpt-5.4", name: "GPT-5.4" }],
      total_models: 2,
      is_current: true,
    },
    { slug: "unconfigured", name: "Not ready", models: ["nope"], authenticated: false },
  ],
});

assert.deepEqual(selection, {
  provider: "openrouter",
  model: "anthropic/claude-sonnet-4.6",
  providers: [
    {
      slug: "openrouter",
      name: "OpenRouter",
      models: [
        { id: "anthropic/claude-sonnet-4.6" },
        { id: "openai/gpt-5.4", name: "GPT-5.4" },
      ],
      totalModels: 2,
      isCurrent: true,
    },
  ],
});

assert.equal(
  hermesProfileName("/home/liam/.hermes/profiles/research-bee", "/home/liam/.hermes"),
  "research-bee",
);
assert.equal(hermesProfileName("/home/liam/.hermes", "/home/liam/.hermes"), "");

const calls = [];
const execFileAsync = async (command, args, options) => {
  calls.push({ command, args, options });
  return {
    stdout: JSON.stringify({
      provider: "openai-codex",
      model: "gpt-5.5",
      providers: [{ slug: "openai-codex", name: "OpenAI Codex", models: ["gpt-5.5"] }],
    }),
  };
};
const live = await readHermesModelSelection({
  hermesHome: "/home/liam/.hermes/profiles/worker",
  projectDir: "/home/liam/.hermes/hermes-agent",
  pythonPath: "/home/liam/.hermes/hermes-agent/venv/bin/python",
  execFileAsync,
});
assert.equal(live?.model, "gpt-5.5");
assert.equal(calls[0].options.env.HERMES_HOME, "/home/liam/.hermes/profiles/worker");
assert.equal(calls[0].options.env.PYTHONPATH, "/home/liam/.hermes/hermes-agent");
assert.match(calls[0].args[1], /build_models_payload/);

await setHermesModelAssignment({
  hermesHome: "/home/liam/.hermes/profiles/worker",
  projectDir: "/home/liam/.hermes/hermes-agent",
  pythonPath: "/home/liam/.hermes/hermes-agent/venv/bin/python",
  provider: "openrouter",
  model: "anthropic/claude-sonnet-4.6",
  execFileAsync,
});
assert.match(calls[1].args[1], /save_config/);
assert.match(calls[1].args[1], /_apply_main_model_assignment/);
assert.equal(calls[1].options.env.HERMES_HOME, "/home/liam/.hermes/profiles/worker");

console.log("hermes model settings bridge regression passed");
