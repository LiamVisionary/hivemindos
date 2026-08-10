import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  createHermesBrowserPreviewEventWriter,
  isHermesBrowserToolName,
  resolveHermesBrowserPreview,
} = await import("./lib/hermes-browser-preview.mjs");
const { withRuntimeBrowserPreviewUrl } = await import(
  "../src/app/api/chat/agent-runtime/browser-preview.ts"
);
const { processLabelFromRuntimeEvent } = await import(
  "../src/features/dashboard/hooks/status-chat-input-helpers.ts"
);
const { processEventSignature } = await import(
  "../src/features/dashboard/hooks/status-chat-process-image-generation.ts"
);

assert.equal(isHermesBrowserToolName("browser_navigate"), true);
assert.equal(isHermesBrowserToolName("browser_vision"), true);
assert.equal(isHermesBrowserToolName("web_search"), false);

const testRoot = await mkdtemp(join(tmpdir(), "hivemind-browser-preview-"));
try {
  const hermesProject = join(testRoot, "hermes-agent");
  const browserBin = join(hermesProject, "node_modules", ".bin", "agent-browser");
  const sessionName = "h_preview_contract";
  const socketDirectory = join(testRoot, `agent-browser-${sessionName}`);
  await mkdir(join(hermesProject, "node_modules", ".bin"), { recursive: true });
  await writeFile(browserBin, "#!/bin/sh\n", "utf8");
  await chmod(browserBin, 0o700);
  await mkdir(socketDirectory, { recursive: true });
  await writeFile(join(socketDirectory, `${sessionName}.owner_pid`), "43210\n", "utf8");

  let observedCall = null;
  const preview = await resolveHermesBrowserPreview({
    ownerPid: 43210,
    hermesAgentProjectDir: hermesProject,
    socketRoot: testRoot,
    run: async (command, args, options) => {
      observedCall = { command, args, socketDirectory: options.env.AGENT_BROWSER_SOCKET_DIR };
      return {
        stdout: JSON.stringify({
          success: true,
          data: { connected: true, enabled: true, port: 54321 },
        }),
      };
    },
  });
  assert.deepEqual(preview, {
    path: "/app-proxy/54321",
    source: "agent-browser",
  });
  assert.deepEqual(observedCall, {
    command: browserBin,
    args: ["--session", sessionName, "--json", "stream", "status"],
    socketDirectory,
  });
} finally {
  await rm(testRoot, { force: true, recursive: true });
}

const writtenEvents = [];
let previewResolveCount = 0;
const previewWriter = createHermesBrowserPreviewEventWriter({
  canWrite: () => true,
  hermesAgentProjectDir: "/managed/hermes-agent",
  ownerPid: async () => 43210,
  resolvePreview: async (input) => {
    previewResolveCount += 1;
    assert.deepEqual(input, {
      ownerPid: 43210,
      hermesAgentProjectDir: "/managed/hermes-agent",
    });
    return { path: "/app-proxy/54321", source: "agent-browser" };
  },
  write: (event) => writtenEvents.push(event),
});
previewWriter.push({ type: "tool.completed", name: "browser_navigate" });
previewWriter.push({ type: "assistant.message", message: "done" });
await previewWriter.drain();
previewWriter.push({ type: "tool.completed", name: "browser_click" });
await previewWriter.drain();
assert.equal(previewResolveCount, 1, "later browser events should reuse the resolved stream");
assert.deepEqual(writtenEvents, [
  { type: "tool.completed", name: "browser_navigate" },
  { type: "assistant.message", message: "done" },
  {
    type: "tool.completed",
    name: "browser_navigate",
    browserPreview: { path: "/app-proxy/54321", source: "agent-browser" },
  },
  {
    type: "tool.completed",
    name: "browser_click",
    browserPreview: { path: "/app-proxy/54321", source: "agent-browser" },
  },
]);

const upstreamEvent = {
  type: "tool.completed",
  name: "browser_navigate",
  status: "completed",
  browserPreview: { path: "/app-proxy/54321", source: "agent-browser" },
};
const routedEvent = withRuntimeBrowserPreviewUrl(
  upstreamEvent,
  "http://fleet-node.test:8787/chat",
);
assert.deepEqual(routedEvent.browserPreview, {
  path: "/app-proxy/54321",
  source: "agent-browser",
  url: "http://fleet-node.test:8787/app-proxy/54321",
});
const invalidRoutedEvent = withRuntimeBrowserPreviewUrl(
  {
    ...upstreamEvent,
    browserPreview: {
      path: "/app-proxy/70000",
      url: "http://fleet-node.test:8787/app-proxy/1234",
    },
  },
  "http://127.0.0.1:8787/chat",
);
assert.equal(
  invalidRoutedEvent.browserPreview,
  undefined,
  "invalid preview paths must remove any runtime-supplied connectable URL",
);

const processEvent = processLabelFromRuntimeEvent(routedEvent);
assert.deepEqual(processEvent.browserPreview, {
  source: "agent-browser",
  url: "http://fleet-node.test:8787/app-proxy/54321",
});
assert.notEqual(
  processEventSignature([{ at: 1, label: "Ran browser_navigate", browserPreview: { url: "http://127.0.0.1:8787/app-proxy/1" } }]),
  processEventSignature([{ at: 1, label: "Ran browser_navigate", browserPreview: { url: "http://127.0.0.1:8787/app-proxy/2" } }]),
  "a newly resolved browser stream must invalidate the process-event render signature",
);

const collector = await readFile(join(process.cwd(), "scripts/agent-telemetry-collector.mjs"), "utf8");
const messageThread = await readFile(join(process.cwd(), "src/features/dashboard/views/chat/exchange/MessageThread.tsx"), "utf8");
const previewComponent = await readFile(join(process.cwd(), "src/features/dashboard/views/chat/BrowserLivePreview.tsx"), "utf8");
assert.match(collector, /createHermesBrowserPreviewEventWriter/);
assert.match(collector, /browserPreviewEvents\.push/);
assert.match(collector, /apiBrowserPreviewEvents\.push/);
assert.match(messageThread, /<BrowserLivePreview active=\{browserActive\}/);
assert.match(previewComponent, /setPointerCapture/);
assert.match(previewComponent, /new WebSocket\(socketUrl\)/);

console.log("browser live preview assertions passed");
