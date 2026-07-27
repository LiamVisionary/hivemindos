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
  "\n;globalThis.__videoRouting = { selectVideoApp, appScore, videoRouteScore, withMcpVideoProviders, rewriteStudioMediaUrl, firstVideoUrlInJson, mcpJobId, videoDimsFromImage, requestedVideoDurationSeconds, videoFrameCount };";

const compiled = ts.transpileModule(stripped, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

// Per-app overlay stub: tests set entries before scoring to exercise the
// capabilities/mcpVideo video signals.
const overlayPrefs = new Map();
const context = vm.createContext({
  URL,
  Buffer,
  encodeURIComponent,
  decodeURIComponent,
  join: (...parts) => parts.filter(Boolean).join("/"),
  homedir: () => "/tmp",
  appPreferenceFor: (app) => overlayPrefs.get(app?.id) ?? null,
  usageNoteAffinity: () => 0,
});
vm.runInContext(compiled, context, { filename: "video-generation.ts" });
const { selectVideoApp, appScore, videoRouteScore, withMcpVideoProviders, rewriteStudioMediaUrl, firstVideoUrlInJson, mcpJobId, videoDimsFromImage, requestedVideoDurationSeconds, videoFrameCount } = context.__videoRouting;

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

// --- MCP video overlay: a HivemindOS-side declaration makes an app a video app ---
// An otherwise-image gateway (no video name/route/kind) becomes selectable when
// the app-preferences overlay declares it via capabilities or an mcpVideo descriptor.
const studioGateway = {
  id: "nyc:8788:mediastudio",
  name: "Media Studio",
  description: "Next.js control surface for Z-Image and ComfyUI",
  serviceKind: "api",
  apiBaseUrl: "http://localhost:8788",
  apiRoutes: [{ method: "POST", path: "/api/generate", summary: "Generate", category: "API" }],
};
assert.equal(appScore(studioGateway, VIDEO_PROMPT, []), 0, "no overlay => image gateway is not a video app");
overlayPrefs.set(studioGateway.id, { appId: studioGateway.id, capabilities: ["video", "image-to-video"] });
assert.ok(appScore(studioGateway, VIDEO_PROMPT, []) > 0, "capabilities:[video] overlay makes it a video app");
overlayPrefs.set(studioGateway.id, { appId: studioGateway.id, mcpVideo: { url: "https://h.ts.net:8789/mcp" } });
assert.ok(appScore(studioGateway, VIDEO_PROMPT, []) > 0, "an mcpVideo overlay makes it a video app");
overlayPrefs.clear();

// --- withMcpVideoProviders: overlay-declared MCP app is a candidate even if discovery missed it ---
const mcpPref = { appId: "nyc:8788:mediastudio", appName: "Media Studio", mcpVideo: { url: "https://h.ts.net:8789/mcp", uploadBase: "http://100.x:8788" } };
const virtualized = withMcpVideoProviders([], [mcpPref]);
assert.equal(virtualized.length, 1, "an mcpVideo overlay yields a virtual candidate when nothing is discovered");
assert.equal(virtualized[0].serviceKind, "video", "the virtual candidate is a video app");
assert.equal(virtualized[0].apiBaseUrl, "http://100.x:8788", "virtual candidate uses the overlay uploadBase");
// Deduped by host:port when a real app at the same port is already discovered.
const deduped = withMcpVideoProviders([{ id: "nyc:8788:realhash", name: "node API on 8788", serviceKind: "api", apiBaseUrl: "http://x/app-proxy/8788" }], [mcpPref]);
assert.equal(deduped.length, 1, "no duplicate virtual candidate when the app is already discovered at that host:port");
assert.equal(deduped[0].name, "Media Studio", "the HivemindOS overlay supplies the user-facing MCP app name");
assert.equal(deduped[0].serviceKind, "video", "the HivemindOS overlay supplies the video service kind");

// --- rewriteStudioMediaUrl: localhost output URL heals to the reachable base; tailnet URL is left alone ---
assert.equal(
  rewriteStudioMediaUrl("http://127.0.0.1:8788/image/x.mp4?token=abc", "http://100.122.0.5:8788"),
  "http://100.122.0.5:8788/image/x.mp4?token=abc",
  "a 127.0.0.1 media URL is rewritten to the reachable upload base host",
);
assert.equal(
  rewriteStudioMediaUrl("https://h.ts.net:8789/image/x.mp4?token=abc", "http://100.122.0.5:8788"),
  "https://h.ts.net:8789/image/x.mp4?token=abc",
  "an already-tailnet media URL is left untouched (so post-extension tailnet URLs just work)",
);

// --- firstVideoUrlInJson + mcpJobId: parse the MCP tool result shapes ---
assert.equal(
  firstVideoUrlInJson({ job: { outputs: ["http://127.0.0.1:8788/image/clip_97f.mp4?token=z"] } }),
  "http://127.0.0.1:8788/image/clip_97f.mp4?token=z",
  "a video URL is found anywhere in the job payload",
);
assert.equal(firstVideoUrlInJson({ status: "running" }), "", "no video URL yet => empty");
assert.equal(mcpJobId({ job: { id: "abc123" } }), "abc123", "job id from job.id");
assert.equal(mcpJobId({ submission: { prompt_id: "p9" } }), "p9", "job id falls back to submission.prompt_id");

// --- videoDimsFromImage: derives video size from the image, clamped to /32 ---
function fakePng(w, h) {
  const b = Buffer.alloc(24);
  b[0] = 0x89; b[1] = 0x50; b.write("IHDR", 12, "ascii"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
assert.deepEqual({ ...videoDimsFromImage(fakePng(1024, 1024)) }, { width: 1024, height: 1024 }, "square image => square video dims");
const wide = videoDimsFromImage(fakePng(1920, 1080));
assert.equal(wide.width % 32, 0, "derived width is divisible by 32");
assert.ok(wide.width <= 1024 && wide.height <= 1024, "dims are clamped to the max");
assert.deepEqual({ ...videoDimsFromImage(Buffer.from("not an image")) }, { width: 768, height: 768 }, "unparseable image => safe default dims");

// --- requested duration: natural-language seconds drive the MCP frame count ---
assert.equal(requestedVideoDurationSeconds("generate a 10 second video"), 10, "full-word seconds are parsed");
assert.equal(requestedVideoDurationSeconds("make this a 6s video"), 6, "compact seconds are parsed");
assert.equal(requestedVideoDurationSeconds("create a video of the bee flying"), 4, "unspecified duration keeps the four-second default");
assert.equal(requestedVideoDurationSeconds("make a 45 second video"), 30, "duration is capped at the MCP's 721-frame maximum");
assert.equal(videoFrameCount(10, 24), 241, "ten seconds at 24 fps uses the inclusive terminal frame");
assert.equal(videoFrameCount(30, 24), 721, "thirty seconds maps to the MCP maximum");

console.log("video-app-routing: OK");
