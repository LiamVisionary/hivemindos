#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const slides = await import("../src/lib/services/integrations/google-slides.ts");
const actions = await import("../src/lib/services/hive-actions/integrations/google-slides.ts");
const { toMcpTool } = await import("../src/lib/services/hive-actions/mcp-export.ts");

const calls = [];
const fetchImpl = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify({ ok: true, revisionId: "rev-2" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
const dependencies = {
  mintAccessToken: async () => "test-access-token",
  fetchImpl,
};

await slides.readGoogleSlides(
  slides.googleSlidesReadSchema.parse({ action: "list", search: "Founder’s deck", pageSize: 10 }),
  dependencies,
);
assert.match(calls[0].url, /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/);
const driveQuery = new URL(calls[0].url).searchParams.get("q") ?? "";
assert.match(driveQuery, /application\/vnd\.google-apps\.presentation/);
assert.match(driveQuery, /name contains 'Founder’s deck'/);
assert.equal(calls[0].init.headers.Authorization, "Bearer test-access-token");

await slides.readGoogleSlides(
  slides.googleSlidesReadSchema.parse({ action: "get", presentationId: "deck_123456789" }),
  dependencies,
);
assert.equal(calls[1].url, "https://slides.googleapis.com/v1/presentations/deck_123456789");

await assert.rejects(
  slides.editGoogleSlides(slides.googleSlidesEditSchema.parse({ action: "create", title: "New deck" }), dependencies),
  /CONFIRM_GOOGLE_SLIDES_EDIT/,
);
assert.equal(calls.length, 2, "unconfirmed writes must fail before an API call");

await slides.editGoogleSlides(
  slides.googleSlidesEditSchema.parse({
    action: "replace-all-text",
    presentationId: "deck_123456789",
    replacements: [{ find: "Q2", replace: "Q3", pageObjectIds: ["slide_one"] }],
    requiredRevisionId: "rev-1",
    confirmation: slides.GOOGLE_SLIDES_EDIT_CONFIRMATION,
  }),
  dependencies,
);
assert.equal(calls[2].url, "https://slides.googleapis.com/v1/presentations/deck_123456789:batchUpdate");
assert.deepEqual(JSON.parse(calls[2].init.body), {
  requests: [{
    replaceAllText: {
      containsText: { text: "Q2", matchCase: false },
      replaceText: "Q3",
      pageObjectIds: ["slide_one"],
    },
  }],
  writeControl: { requiredRevisionId: "rev-1" },
});

const readTool = toMcpTool(actions.googleSlidesReadAction);
assert.equal(readTool.name, "google_slides_read");
assert.equal(readTool.annotations.readOnlyHint, true);
assert.equal(readTool.annotations.destructiveHint, false);

const editTool = toMcpTool(actions.googleSlidesEditAction);
assert.equal(editTool.name, "google_slides_edit");
assert.equal(editTool.annotations.readOnlyHint, false);
assert.equal(editTool.annotations.destructiveHint, true);
assert.equal(editTool.annotations["hivemindos/risk"], "high");
assert.equal(editTool.annotations["hivemindos/confirmation"].token, "CONFIRM_GOOGLE_SLIDES_EDIT");

const oauth = read("src/lib/services/integrations/google-oauth.ts");
const manifest = read("src/lib/services/integrations/connector-manifests.ts");
const route = read("src/app/api/integrations/google/slides/route.ts");
const mcp = read("scripts/hivemind-mcp");
assert.match(oauth, /https:\/\/www\.googleapis\.com\/auth\/presentations/);
assert.match(manifest, /id: "edit-google-slides"/);
assert.match(route, /requireAuth\(request\)/);
assert.match(route, /requiresConfirmation: true/);
assert.match(mcp, /name === "google_slides_read"/);
assert.match(mcp, /name === "google_slides_edit"/);
assert.match(mcp, /\/api\/integrations\/google\/slides/);
assert.match(mcp, /CONFIRM_GOOGLE_SLIDES_EDIT/);

const server = spawn(process.execPath, ["scripts/hivemind-mcp"], {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
server.stderr.on("data", (chunk) => { stderr += String(chunk); });
try {
  await mcpRequest(server, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const listed = await mcpRequest(server, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const toolNames = new Set(listed.tools.map((tool) => tool.name));
  assert.ok(toolNames.has("google_slides_read"), "the real Hivemind MCP must advertise google_slides_read");
  assert.ok(toolNames.has("google_slides_edit"), "the real Hivemind MCP must advertise google_slides_edit");
  await assert.rejects(
    mcpRequest(server, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "google_slides_edit", arguments: { action: "create", title: "Unconfirmed" } },
    }),
    /requires confirmation CONFIRM_GOOGLE_SLIDES_EDIT/,
    "the real MCP process must reject an unconfirmed Slides write before contacting the app",
  );
} catch (error) {
  if (stderr.trim()) error.message = `${error.message}\nMCP stderr:\n${stderr}`;
  throw error;
} finally {
  server.kill();
}

console.log("Google Slides MCP read/edit, OAuth scope, and confirmation policy tests passed.");

function mcpRequest(child, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${message.method}`)), 5_000);
    let buffer = "";
    const onData = (chunk) => {
      buffer += String(chunk);
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.id !== message.id) continue;
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        if (parsed.error) reject(new Error(parsed.error.message));
        else resolve(parsed.result);
      }
    };
    child.stdout.on("data", onData);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}
