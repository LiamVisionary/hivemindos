#!/usr/bin/env node
// Video-app selection guard (src/lib/services/chat/video-generation.ts).
// Locks the 2026-07-10 fix: the `generate_video` router must NOT treat an
// image-only app (a Z-Image/ComfyUI control surface with a bare `/api/generate`
// route) as a video backend. Without a genuine video signal — a "video"
// serviceKind, a video-specific route, or a video-specific name/description —
// selectVideoApp returns null so the dispatcher surfaces the honest
// "No connected video generation app…" instead of wasting a run on an image app.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/lib/services/chat/video-generation.ts", import.meta.url),
  "utf8",
);

// Strip module imports (the scoring functions we test are pure aside from two
// app-preference helpers, which we stub) and re-expose the internals.
const stripped = source
  .replace(/^import[^;]*;/gm, "")
  .replace(/\bexport\s+/g, "") +
  "\n;globalThis.__videoRouting = { selectVideoApp, appScore, videoRouteScore };";

const compiled = ts.transpileModule(stripped, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const context = vm.createContext({
  URL,
  encodeURIComponent,
  decodeURIComponent,
  // The scoring path calls appPreferenceScore -> appPreferenceFor; with no
  // preferences it returns 0. usageNoteAffinity is never reached here.
  appPreferenceFor: () => null,
  usageNoteAffinity: () => 0,
});
vm.runInContext(compiled, context, { filename: "video-generation.ts" });
const { selectVideoApp, appScore, videoRouteScore } = context.__videoRouting;

const VIDEO_PROMPT = { origin: "", prompt: "make a video of this bee flying" };

// The exact culprit: image control surface with a bare /api/generate route.
const zImageStudio = {
  id: "host:8788:zimage",
  name: "Z-Image Studio",
  description: "Next.js control surface for Z-Image and ComfyUI",
  machineName: "Liams Macbook Pro Nyc",
  serviceKind: "api",
  apiBaseUrl: "http://localhost:8788",
  apiRoutes: [
    { method: "POST", path: "/api/generate", summary: "Generate", category: "API" },
    { method: "GET", path: "/api/health", summary: "Health", category: "Core" },
  ],
};

// A real video app via an explicit video route.
const videoByRoute = {
  id: "host:9000:vid",
  name: "Motion Studio",
  description: "Rendering service",
  serviceKind: "api",
  apiBaseUrl: "http://localhost:9000",
  apiRoutes: [
    { method: "POST", path: "/api/image-to-video", summary: "Animate an image", category: "Video" },
  ],
};

// A real video app via serviceKind, even with only a bare /generate route.
const videoByKind = {
  id: "host:9001:vid",
  name: "Studio",
  serviceKind: "video",
  apiBaseUrl: "http://localhost:9001",
  apiRoutes: [{ method: "POST", path: "/api/generate", summary: "Generate", category: "API" }],
};

// A real video app via a video-specific name.
const videoByName = {
  id: "host:9002:vid",
  name: "Runway Video Generation",
  serviceKind: "api",
  apiBaseUrl: "http://localhost:9002",
  apiRoutes: [{ method: "POST", path: "/api/generate", summary: "Generate", category: "API" }],
};

// --- videoRouteScore: bare image /generate is not a video route ---
assert.equal(
  videoRouteScore({ method: "POST", path: "/api/generate", summary: "Generate" }),
  0,
  "a bare /api/generate route carries no video signal",
);
assert.ok(
  videoRouteScore({ method: "POST", path: "/api/image-to-video", summary: "Animate" }) > 0,
  "an image-to-video route is a video route",
);
assert.ok(
  videoRouteScore({ method: "POST", path: "/api/generate-video", summary: "Generate video" }) > 0,
  "a generate-video route is a video route",
);
assert.equal(
  videoRouteScore({ method: "GET", path: "/api/videos", summary: "List videos" }),
  0,
  "a GET (non-POST) route never scores",
);

// --- appScore: image-only app is gated out; real video apps score positive ---
assert.equal(appScore(zImageStudio, VIDEO_PROMPT, []), 0, "image-only Z-Image/ComfyUI app is not a video candidate");
assert.ok(appScore(videoByRoute, VIDEO_PROMPT, []) > 0, "app with a video route is a video candidate");
assert.ok(appScore(videoByKind, VIDEO_PROMPT, []) > 0, "app with serviceKind=video is a video candidate");
assert.ok(appScore(videoByName, VIDEO_PROMPT, []) > 0, "app with a video-specific name is a video candidate");

// --- selectVideoApp: the whole point — no video app among image apps => null ---
assert.equal(
  selectVideoApp([zImageStudio], VIDEO_PROMPT, []),
  null,
  "an image-only fleet yields no video app (honest no-app instead of a wasted run)",
);

// Mixed fleet: the real video app wins over the image app.
const winner = selectVideoApp([zImageStudio, videoByRoute], VIDEO_PROMPT, []);
assert.ok(winner, "a real video app is selected when present");
assert.equal(winner.id, videoByRoute.id, "the video app beats the image app");

// Explicit app pin is always honored, even for an image app (caller chose it).
const pinned = selectVideoApp([zImageStudio], { ...VIDEO_PROMPT, appId: zImageStudio.id }, []);
assert.ok(pinned, "an explicit appId pin is honored");
assert.equal(pinned.id, zImageStudio.id, "the pinned app is selected regardless of the video gate");

console.log("video-app-routing: OK");
