#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const oauth = readFileSync(new URL("../src/lib/services/openai-oauth.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/lib/services/openai-oauth-media.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/openai-oauth/media/route.ts", import.meta.url), "utf8");

assert.match(oauth, /openAiOAuthResponsesRequest/, "OAuth Responses transport must be shared by chat and media");
assert.match(service, /openAiOAuthResponsesRequest/, "media must reuse the canonical OAuth transport");
assert.match(service, /gpt-image-2/, "the current GPT Image model is missing");
assert.match(service, /image_generation/, "the Codex Responses image tool is missing");
assert.match(service, /allowed_tools/, "image tool selection must be required");
assert.doesNotMatch(service, /OPENAI_OAUTH_ACCESS_TOKEN/, "the bridge must not bypass the token broker");
assert.match(route, /openAiOAuthMediaRequest/, "the route must delegate to the bounded service");
assert.match(route, /okJson/, "the route must use the canonical API response envelope");

console.log("OpenAI OAuth media bridge contract ok");
