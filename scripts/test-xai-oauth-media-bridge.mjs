#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("../src/lib/services/xai-oauth-media.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/xai-oauth/media/route.ts", import.meta.url), "utf8");

assert.match(service, /getXaiOAuthAccess/, "media requests must reuse the canonical xAI OAuth broker");
assert.match(service, /grok-imagine-image-quality/, "image generation must use the current xAI model default");
assert.match(service, /grok-imagine-video/, "video generation must use the current xAI model default");
assert.match(service, /\/images\/generations/, "image generation endpoint is missing");
assert.match(service, /\/videos\/generations/, "video generation endpoint is missing");
assert.match(service, /\/videos\/\$\{/, "video polling endpoint is missing");
assert.doesNotMatch(service, /XAI_OAUTH_ACCESS_TOKEN/, "the bridge must not bypass the token broker");
assert.match(route, /xaiOAuthMediaRequest/, "the authenticated route must delegate to the bounded service");
assert.match(route, /NextResponse\.json/, "the route must return a typed JSON result");

console.log("xAI OAuth media bridge contract ok");
