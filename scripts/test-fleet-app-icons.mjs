import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const APP_PORT = 7777;
const PLAIN_APP_PORT = 7778;
const COLLECTOR_PORT_RANGE = Array.from(
  { length: 24 },
  (_, index) => 8787 + index,
);

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#f59e0b"/></svg>`;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function listenOnFirstFreePort(server, ports) {
  return new Promise((resolve, reject) => {
    const tryPort = (index) => {
      if (index >= ports.length) {
        reject(new Error("No free collector port in range"));
        return;
      }
      const onError = (error) => {
        if (error.code === "EADDRINUSE") {
          server.removeListener("error", onError);
          tryPort(index + 1);
          return;
        }
        reject(error);
      };
      server.once("error", onError);
      server.listen(ports[index], "127.0.0.1", () => {
        server.removeListener("error", onError);
        resolve(ports[index]);
      });
    };
    tryPort(0);
  });
}

function startMockCollector() {
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const collectorPort = server.address().port;
    if (path === "/apps") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          apps: [
            {
              id: "icon-app",
              name: "Icon App",
              scheme: "http",
              port: APP_PORT,
              path: "/",
              statusCode: 200,
              contentType: "text/html",
              interactive: true,
              proxyUrl: `http://127.0.0.1:${collectorPort}/app-proxy/${APP_PORT}/`,
            },
            {
              id: "plain-app",
              name: "Plain App",
              scheme: "http",
              port: PLAIN_APP_PORT,
              path: "/",
              statusCode: 200,
              contentType: "text/html",
              interactive: true,
              proxyUrl: `http://127.0.0.1:${collectorPort}/app-proxy/${PLAIN_APP_PORT}/`,
            },
          ],
        }),
      );
      return;
    }
    if (path === `/app-proxy/${APP_PORT}/`) {
      response.writeHead(200, { "Content-Type": "text/html" });
      // href before rel on purpose: the favicon link parser must not depend on attribute order
      response.end(
        `<!doctype html><html><head><title>Icon App</title><link href="./favicon.svg" rel="icon" type="image/svg+xml"></head><body>icon app</body></html>`,
      );
      return;
    }
    if (path === `/app-proxy/${APP_PORT}/favicon.svg`) {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end(FAVICON_SVG);
      return;
    }
    if (path === `/app-proxy/${PLAIN_APP_PORT}/`) {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        `<!doctype html><html><head><title>Plain App</title></head><body>no favicon here</body></html>`,
      );
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
  });
  return listenOnFirstFreePort(server, COLLECTOR_PORT_RANGE).then((port) => ({
    server,
    port,
  }));
}

// The spawned dashboard's API auth gate (src/proxy.ts) 401s tokenless /api
// requests. Give the child deterministic throwaway credentials (explicit
// process env beats .env.local in Next) and send the matching device token.
const THROWAWAY_AUTH_SECRET = "throwaway-fleet-app-icons-secret-not-a-real-credential";
const THROWAWAY_DEVICE_TOKEN = "throwaway-fleet-app-icons-device-token";
const dashboardHeaders = { "x-hivemindos-device-token": THROWAWAY_DEVICE_TOKEN };

async function waitForDashboard(dashboard, baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (dashboard.exitCode !== null) {
      throw new Error(
        "next dev exited early — if another dev server is already running for this project, stop it or run this test later (Next allows one dev server per project)",
      );
    }
    try {
      const response = await fetch(
        `${baseUrl}/api/fleet/app-icon?url=not-a-url`,
        {
          cache: "no-store",
          headers: dashboardHeaders,
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (response.status === 400) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`Dashboard did not become ready: ${lastError}`);
}

const { server: collector, port: collectorPort } = await startMockCollector();
console.log(`Mock collector listening on 127.0.0.1:${collectorPort}`);

const dashPort = await freePort();
const tempHome = mkdtempSync(join(tmpdir(), "fleet-app-icons-home-"));
const dashboard = spawn(
  join(root, "node_modules", ".bin", "next"),
  ["dev", "-p", String(dashPort), "-H", "127.0.0.1"],
  {
    cwd: root,
    env: {
      ...process.env,
      HOME: tempHome,
      HIVEMIND_LINK_APP_PEERS: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      HIVEMINDOS_DASHBOARD_AUTH_SECRET: THROWAWAY_AUTH_SECRET,
      HIVEMINDOS_DASHBOARD_DEVICE_TOKEN: THROWAWAY_DEVICE_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
dashboard.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`));
dashboard.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));

const cleanup = () => {
  dashboard.kill("SIGTERM");
  collector.close();
};
process.on("exit", cleanup);

const baseUrl = `http://127.0.0.1:${dashPort}`;

try {
  await waitForDashboard(dashboard, baseUrl, 180_000);
  console.log(`Dashboard ready at ${baseUrl}`);

  const response = await fetch(`${baseUrl}/api/fleet/apps?refresh=1&wait=1`, {
    cache: "no-store",
    headers: dashboardHeaders,
    signal: AbortSignal.timeout(120_000),
  });
  assert.equal(
    response.ok,
    true,
    `/api/fleet/apps returned ${response.status}`,
  );
  const payload = await response.json();

  const iconApp = payload.apps.find((app) => app.name === "Icon App");
  assert.ok(
    iconApp,
    `Icon App should be discovered; got ${payload.apps.map((app) => app.name).join(", ")}`,
  );
  assert.ok(iconApp.iconUrl, "Icon App should have an iconUrl");
  assert.ok(
    iconApp.iconUrl.startsWith("/api/fleet/app-icon?url="),
    `iconUrl should go through the dashboard proxy, got ${iconApp.iconUrl}`,
  );
  const upstreamIconUrl = decodeURIComponent(iconApp.iconUrl.split("url=")[1]);
  assert.equal(
    upstreamIconUrl,
    `http://127.0.0.1:${collectorPort}/app-proxy/${APP_PORT}/favicon.svg`,
    "relative favicon href must resolve against the app's proxied base path",
  );

  const iconResponse = await fetch(`${baseUrl}${iconApp.iconUrl}`, {
    cache: "no-store",
    headers: dashboardHeaders,
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(
    iconResponse.ok,
    true,
    `icon proxy returned ${iconResponse.status}`,
  );
  assert.ok(
    (iconResponse.headers.get("content-type") || "").startsWith("image/svg"),
    "icon proxy should serve the svg",
  );
  const body = await iconResponse.text();
  assert.ok(body.includes("<svg"), "icon proxy body should be the favicon svg");

  const plainApp = payload.apps.find((app) => app.name === "Plain App");
  assert.ok(plainApp, "Plain App should be discovered");
  assert.equal(
    plainApp.iconUrl,
    undefined,
    "Plain App has no favicon anywhere, so initials fallback applies",
  );

  console.log("Fleet app icons e2e passed.");
} finally {
  cleanup();
}
