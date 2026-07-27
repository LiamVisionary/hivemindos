#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildOpenAiOAuthResponsesInput } from "../src/lib/services/openai-oauth-payload.ts";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const input = buildOpenAiOAuthResponsesInput([
  { role: "system", content: "Plan from the reference." },
  { role: "user", content: "Earlier text-only turn" },
  { role: "assistant", content: "Understood." },
  { role: "user", content: "What is visible in the image?" },
], [image]);

assert.equal(input.length, 3);
assert.deepEqual(input[0].content, [{ type: "input_text", text: "Earlier text-only turn" }]);
assert.deepEqual(input[1].content, [{ type: "output_text", text: "Understood." }]);
assert.deepEqual(input[2].content, [
  { type: "input_text", text: "What is visible in the image?" },
  { type: "input_image", image_url: image, detail: "auto" },
]);

const oauthService = readFileSync("src/lib/services/openai-oauth.ts", "utf8");
const contentStudioService = readFileSync("src/lib/services/local-app-content-studio.ts", "utf8");
const modelOptionsService = readFileSync("src/lib/services/chat/thread-title-model-options.ts", "utf8");
assert.match(oauthService, /buildOpenAiOAuthResponsesInput\(messages, options\.images\)/);
assert.match(contentStudioService, /runOpenAiOAuthChatTurn[\s\S]*images,/);
assert.doesNotMatch(contentStudioService, /this ChatGPT OAuth route is text-only/);
assert.match(modelOptionsService, /auth: "oauth"[\s\S]*vision: true/);

console.log("OpenAI OAuth multimodal payload checks passed.");
