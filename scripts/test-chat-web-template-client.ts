import assert from "node:assert/strict";

import { APP_BUILDER_CONFIRMATIONS } from "../src/lib/services/app-builder/contract";
import { initializeWebTemplateProject } from "../src/lib/services/app-builder/web-template-client";
import { WEB_TEMPLATE_CATALOG } from "../src/lib/services/app-builder/web-template-catalog";

type RecordedEvent =
  | { kind: "asset"; url: string }
  | { kind: "app-builder"; body: Record<string, unknown> };

const events: RecordedEvent[] = [];
let project: Record<string, unknown> | undefined;

const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("/app-builder-templates/scroll-world/")) {
    events.push({ kind: "asset", url });
    return new Response(`reviewed source for ${url}`, { status: 200 });
  }
  assert.equal(url, "/api/app-builder");
  const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
  events.push({ kind: "app-builder", body });
  if (body.action === "create") {
    project = {
      id: "local_scroll_world",
      name: body.name,
      directory: body.directory,
      templateId: body.templateId,
      status: "stopped",
      dependenciesReady: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return Response.json({
    ok: true,
    data: body.action === "create" || body.action === "status" ? { project } : {},
  });
}) as typeof fetch;

const initialized = await initializeWebTemplateProject({
  templateId: "scroll-world",
  chatStorageKey: "agent-1::thread-1",
  baseDirectory: "/tmp/hivemindos-web-template-test",
  machine: { key: "this-mac", name: "This Mac" },
  fetchImpl,
});

assert.equal(initialized.project.id, "local_scroll_world");
const appBuilderEvents = events.filter((event): event is Extract<RecordedEvent, { kind: "app-builder" }> => event.kind === "app-builder");
const assetEvents = events.filter((event): event is Extract<RecordedEvent, { kind: "asset" }> => event.kind === "asset");
assert.equal(assetEvents.length, WEB_TEMPLATE_CATALOG[0].files.length);
assert.equal(events.slice(0, assetEvents.length).every((event) => event.kind === "asset"), true, "all assets load before the first mutation");
assert.equal(appBuilderEvents[0].body.action, "create");
assert.equal(appBuilderEvents[0].body.confirmation, APP_BUILDER_CONFIRMATIONS.createProject);
assert.equal(appBuilderEvents[0].body.templateId, "static");
assert.match(String(appBuilderEvents[0].body.directory), /^\/tmp\/hivemindos-web-template-test\/scratchpad\/scroll-world-[a-f0-9]{8}$/);

const writes = appBuilderEvents.filter((event) => event.body.action === "files_write");
assert.equal(writes.length, WEB_TEMPLATE_CATALOG[0].files.length);
assert.deepEqual(
  writes.map((event) => event.body.path),
  WEB_TEMPLATE_CATALOG[0].files.map((file) => file.path),
);
assert.equal(
  writes.every((event) => event.body.confirmation === APP_BUILDER_CONFIRMATIONS.writeFile),
  true,
);
assert.equal(appBuilderEvents.at(-1)?.body.action, "status");

console.log("chat web-template client initializes the reviewed App Builder project through the canonical mutation path");
