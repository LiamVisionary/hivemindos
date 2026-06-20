import { spawn } from "node:child_process";
import {
  createReadStream,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { connect, createServer as createNetServer } from "node:net";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

const nextEnvPath = fileURLToPath(new URL("../next-env.d.ts", import.meta.url));
const tsconfigPath = fileURLToPath(
  new URL("../tsconfig.json", import.meta.url),
);
const tauriNextRootDir = fileURLToPath(
  new URL("../.next-tauri/", import.meta.url),
);
const tauriDevServerInfoPath = fileURLToPath(
  new URL("../.next-tauri/dev-server.json", import.meta.url),
);
const loadingDir = fileURLToPath(
  new URL("../src-tauri/loading/", import.meta.url),
);
const loadingHtmlPath = fileURLToPath(
  new URL("../src-tauri/loading/index.html", import.meta.url),
);
const loadingIconPath = fileURLToPath(
  new URL("../src-tauri/loading/icon-192.png", import.meta.url),
);
const loadingBeeLottiePath = fileURLToPath(
  new URL("../public/animations/Honey bee.lottie", import.meta.url),
);
const dotLottieRuntimePath = fileURLToPath(
  new URL(
    "../node_modules/@lottiefiles/dotlottie-web/dist/index.js",
    import.meta.url,
  ),
);
const dotLottieWasmPath = fileURLToPath(
  new URL(
    "../node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm",
    import.meta.url,
  ),
);
const loadingAssetPaths = new Map([
  ["Honey bee.lottie", loadingBeeLottiePath],
  ["dotlottie.js", dotLottieRuntimePath],
  ["dotlottie-player.wasm", dotLottieWasmPath],
]);
const upstreamHost = "localhost";
const proxyBindHost = process.env.HIVEMINDOS_TAURI_PROXY_BIND_HOST || "0.0.0.0";
const browserHost = "localhost";

function readPort(value, fallback, name) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(
      `Invalid ${name} value "${value}". Expected a TCP port from 1 to 65535.`,
    );
    process.exit(1);
  }
  return port;
}

function isPortAvailable(port, host = upstreamHost) {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findAvailablePort(startPort) {
  for (
    let port = startPort;
    port < startPort + 25 && port <= 65535;
    port += 1
  ) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(
    `No available Tauri Next.js backend port found from ${startPort} to ${Math.min(startPort + 24, 65535)}.`,
  );
}

const proxyPort = readPort(process.env.PORT, "5021", "PORT");
const requestedNextPort = readPort(
  process.env.HIVEMINDOS_TAURI_NEXT_PORT,
  String(proxyPort + 100),
  "HIVEMINDOS_TAURI_NEXT_PORT",
);

if (!(await isPortAvailable(proxyPort, proxyBindHost))) {
  console.error(
    `Tauri loading proxy port ${browserHost}:${proxyPort} is already in use. Stop the existing Tauri dev shell, then run pnpm tauri:dev again.`,
  );
  process.exit(1);
}

let nextPort;
try {
  nextPort = await findAvailablePort(requestedNextPort);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const tauriNextDistDir = `.next-tauri/dev-${nextPort}`;
const tauriNextDir = fileURLToPath(
  new URL(`../${tauriNextDistDir}/`, import.meta.url),
);

if (nextPort !== requestedNextPort) {
  console.warn(
    `Tauri Next.js backend port ${requestedNextPort} is already in use; using ${nextPort} with ${tauriNextDistDir}.`,
  );
}

function restoreNextEnv() {
  try {
    const current = readFileSync(nextEnvPath, "utf8");
    const restored = current.replace(
      /import "\.\/\.next-tauri(?:\/dev-\d+)?\/dev\/types\/routes\.d\.ts";/g,
      'import "./.next/dev/types/routes.d.ts";',
    );
    if (restored !== current) writeFileSync(nextEnvPath, restored);
  } catch {
    // Best-effort cleanup for Next.js' generated type reference.
  }
}

function restoreTsconfig() {
  try {
    const current = readFileSync(tsconfigPath, "utf8");
    const config = JSON.parse(current);
    if (!Array.isArray(config.include)) return;

    const include = config.include.filter((entry) => {
      return (
        typeof entry !== "string" ||
        !/^\.next-tauri\/dev-\d+\/(?:dev\/)?types\/\*\*\/\*\.ts$/.test(entry)
      );
    });
    if (include.length === config.include.length) return;

    config.include = include;
    writeFileSync(tsconfigPath, `${JSON.stringify(config, null, 2)}\n`);
  } catch {
    // Best-effort cleanup for Next.js' generated TypeScript config paths.
  }
}

function restoreGeneratedTypeReferences() {
  restoreNextEnv();
  restoreTsconfig();
}

function writeDevServerInfo() {
  mkdirSync(tauriNextRootDir, { recursive: true });
  writeFileSync(
    tauriDevServerInfoPath,
    JSON.stringify(
      {
        backendUrl: `http://${upstreamHost}:${nextPort}`,
        bindHost: proxyBindHost,
        dashboardPort: proxyPort,
        dashboardUrl: `http://${browserHost}:${proxyPort}`,
        nextPort,
        proxyPort,
        proxyUrl: `http://${browserHost}:${proxyPort}`,
      },
      null,
      2,
    ) + "\n",
  );
}

function contentType(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".lottie")) return "application/octet-stream";
  return "application/octet-stream";
}

function sendFile(response, path, status = 200) {
  response.writeHead(status, {
    "Content-Type": contentType(path),
    "Cache-Control": "no-store",
  });
  createReadStream(path).pipe(response);
}

const devRecoveryScript = String.raw`
<script data-hivemindos-tauri-dev-recovery>
(function () {
  if (window.__HIVEMINDOS_TAURI_DEV_RECOVERY__) return;
  window.__HIVEMINDOS_TAURI_DEV_RECOVERY__ = true;

  var readyWasDown = false;
  var routeLoadingSince = 0;
  var reloading = false;
  var lastReloadAt = 0;
  var reloadCooldownMs = 20000;
  var routeLoadingTimeoutMs = 12000;

  function forceReload(reason, ignoreCooldown) {
    if (reloading || (!ignoreCooldown && Date.now() - lastReloadAt < reloadCooldownMs)) return;
    reloading = true;
    lastReloadAt = Date.now();
    window.location.reload();
  }

  function checkReady() {
    var staticLoading = document.querySelector("[data-hivemindos-static-loading='true']");
    var scope = staticLoading ? "route" : "backend";
    fetch("/__hivemindos_dev_ready?scope=" + scope + "&ts=" + Date.now(), { cache: "no-store" })
      .then(function (response) {
        if (response.ok) {
          if (staticLoading) forceReload("route became ready", true);
          else if (readyWasDown) forceReload("dev server recovered", false);
          return;
        }
        readyWasDown = true;
      })
      .catch(function () {
        readyWasDown = true;
      });
  }

  function checkRouteLoading() {
    var loading = document.querySelector("[data-hivemindos-route-loading='true']");
    if (!loading) {
      routeLoadingSince = 0;
      return;
    }
    if (!routeLoadingSince) routeLoadingSince = Date.now();
    if (Date.now() - routeLoadingSince > routeLoadingTimeoutMs) forceReload("route loading timeout");
  }

  function maybeReloadForChunkFailure(value) {
    var message = String(value && (value.message || value.reason || value) || "");
    if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message)) {
      forceReload("chunk load failure");
    }
  }

  window.addEventListener("error", function (event) {
    maybeReloadForChunkFailure(event && (event.error || event.message));
  });
  window.addEventListener("unhandledrejection", function (event) {
    maybeReloadForChunkFailure(event && event.reason);
  });

  checkReady();
  checkRouteLoading();
  window.setInterval(checkReady, 1000);
  window.setInterval(checkRouteLoading, 1000);
})();
</script>`;

function injectDevRecoveryScript(html) {
  if (html.includes("data-hivemindos-tauri-dev-recovery")) return html;
  if (html.includes("</body>"))
    return html.replace("</body>", `${devRecoveryScript}</body>`);
  return `${html}${devRecoveryScript}`;
}

function sendLoading(response) {
  const html = injectDevRecoveryScript(readFileSync(loadingHtmlPath, "utf8"));
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

function isDevReadyPath(url) {
  return (
    url === "/__hivemindos_dev_ready" ||
    Boolean(url?.startsWith("/__hivemindos_dev_ready?"))
  );
}

function devReadyScope(url) {
  try {
    return new URL(url ?? "", "http://localhost").searchParams.get("scope") ===
      "route"
      ? "route"
      : "backend";
  } catch {
    return "backend";
  }
}

function checkBackendReady(response) {
  let settled = false;
  const finish = (status) => {
    if (settled || response.headersSent) return;
    settled = true;
    response.writeHead(status, { "Cache-Control": "no-store" });
    response.end();
  };
  const socket = connect(nextPort, upstreamHost, () => {
    socket.destroy();
    finish(204);
  });
  socket.setTimeout(650, () => {
    socket.destroy();
    finish(503);
  });
  socket.on("error", () => finish(503));
}

function checkRouteReady(response) {
  let settled = false;
  const finish = (status) => {
    if (settled || response.headersSent) return;
    settled = true;
    response.writeHead(status, { "Cache-Control": "no-store" });
    response.end();
  };
  const readinessRequest = httpRequest(
    { hostname: upstreamHost, port: nextPort, path: "/", method: "HEAD" },
    (readinessResponse) => {
      finish(
        readinessResponse.statusCode && readinessResponse.statusCode < 500
          ? 204
          : 503,
      );
      readinessResponse.resume();
    },
  );
  readinessRequest.setTimeout(2_500, () => {
    readinessRequest.destroy();
    finish(503);
  });
  readinessRequest.on("error", () => finish(503));
  readinessRequest.end();
}

function proxyTimeoutForRequest(clientRequest) {
  if (clientRequest.url?.startsWith("/api/chat/agent-runtime"))
    return 11 * 60_000;
  if (clientRequest.url?.startsWith("/api/chat/image-generation"))
    return 4 * 60_000;
  // Fleet updates run a remote update plus a verification poll (route maxDuration 360s).
  if (clientRequest.url?.startsWith("/api/fleet/update")) return 7 * 60_000;
  if (clientRequest.url?.startsWith("/api/")) return 60_000;
  if (clientRequest.headers.accept?.includes("text/html")) return 15_000;
  return 2_500;
}

function apiFallbackMessage(clientRequest, proxyTimeoutMs, reason) {
  const path = clientRequest.url || "/";
  const seconds = Math.max(1, Math.round(proxyTimeoutMs / 1000));
  const action =
    reason === "timeout"
      ? `timed out after ${seconds}s`
      : "lost its connection to the Next dev server";
  return `HivemindOS dev proxy ${action} while waiting for ${path}. The request may still be blocked behind compilation, a restarted dev server, or a slow connected app. Retry after the dashboard settles.`;
}

function sendApiFallback(
  clientRequest,
  clientResponse,
  proxyTimeoutMs,
  reason,
) {
  const status = reason === "timeout" ? 504 : 503;
  const message = apiFallbackMessage(clientRequest, proxyTimeoutMs, reason);
  clientResponse.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  clientResponse.end(
    JSON.stringify({
      ok: false,
      error: message,
      code:
        reason === "timeout" ? "DEV_PROXY_TIMEOUT" : "DEV_PROXY_UNAVAILABLE",
      path: clientRequest.url || "/",
      timeoutMs: proxyTimeoutMs,
    }),
  );
}

function proxyHttp(clientRequest, clientResponse) {
  let handled = false;
  const proxyTimeoutMs = proxyTimeoutForRequest(clientRequest);
  const useFallback = (reason = "unavailable") => {
    if (handled || clientResponse.headersSent) return;
    handled = true;
    if (isDevReadyPath(clientRequest.url)) {
      clientResponse.writeHead(503, { "Cache-Control": "no-store" });
      clientResponse.end("warming");
      return;
    }
    if (clientRequest.headers.accept?.includes("text/html")) {
      sendLoading(clientResponse);
      return;
    }
    if (clientRequest.url?.startsWith("/api/")) {
      sendApiFallback(clientRequest, clientResponse, proxyTimeoutMs, reason);
      return;
    }
    clientResponse.writeHead(503, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
    clientResponse.end(
      apiFallbackMessage(clientRequest, proxyTimeoutMs, reason),
    );
  };

  const proxyRequest = httpRequest(
    {
      hostname: upstreamHost,
      port: nextPort,
      method: clientRequest.method,
      path: clientRequest.url,
      headers: {
        ...clientRequest.headers,
        host: `${upstreamHost}:${nextPort}`,
      },
    },
    (proxyResponse) => {
      handled = true;
      clientResponse.writeHead(
        proxyResponse.statusCode ?? 502,
        proxyResponse.headers,
      );
      proxyResponse.pipe(clientResponse);
    },
  );

  proxyRequest.setTimeout(proxyTimeoutMs, () => {
    proxyRequest.destroy();
    useFallback("timeout");
  });
  proxyRequest.on("error", () => useFallback("unavailable"));
  clientRequest.on("error", () => proxyRequest.destroy());
  clientResponse.on("error", () => proxyRequest.destroy());

  clientRequest.pipe(proxyRequest);
}

const proxyServer = createServer((request, response) => {
  if (isDevReadyPath(request.url)) {
    if (devReadyScope(request.url) === "route") {
      checkRouteReady(response);
    } else {
      checkBackendReady(response);
    }
    return;
  }

  if (request.url === "/icon-192.png") {
    sendFile(response, loadingIconPath);
    return;
  }

  if (request.url && request.url.startsWith("/loading/")) {
    const rawFileName = request.url.slice("/loading/".length).split("?")[0];
    let fileName = rawFileName;
    try {
      fileName = decodeURIComponent(rawFileName);
    } catch {
      fileName = rawFileName;
    }
    const mappedAssetPath = loadingAssetPaths.get(fileName);
    if (mappedAssetPath) {
      sendFile(response, mappedAssetPath);
      return;
    }
    if (
      !fileName.includes("/") &&
      !fileName.includes("\\") &&
      extname(fileName)
    ) {
      sendFile(
        response,
        fileURLToPath(new URL(fileName, `file://${loadingDir}`)),
      );
      return;
    }
  }

  proxyHttp(request, response);
});

proxyServer.on("upgrade", (request, socket, head) => {
  const upstream = connect(nextPort, upstreamHost, () => {
    upstream.write(
      `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`,
    );
    for (const [key, value] of Object.entries(request.headers)) {
      if (key.toLowerCase() === "host") continue;
      upstream.write(
        `${key}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`,
      );
    }
    upstream.write(`host: ${upstreamHost}:${nextPort}\r\n\r\n`);
    upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
});

rmSync(tauriNextDir, { force: true, recursive: true });
writeDevServerInfo();

const DEV_SERVER_RESPAWN_WINDOW_MS = 2 * 60_000;
const DEV_SERVER_RESPAWN_BASE_DELAY_MS = 1_000;
const DEV_SERVER_RESPAWN_MAX_DELAY_MS = 30_000;
let child = null;
let stopping = false;
let devServerRespawnTimer = null;
let devServerExitTimestamps = [];

function devServerEnv() {
  return {
    ...process.env,
    PORT: String(nextPort),
    HIVEMINDOS_DASHBOARD_PORT: String(proxyPort),
    HIVEMINDOS_DASHBOARD_URL: `http://${browserHost}:${proxyPort}`,
    HIVEMINDOS_DASHBOARD_HOST: upstreamHost,
    HIVEMINDOS_TAURI_DEV: "1",
    HIVEMINDOS_TAURI_NEXT_DIST_DIR: tauriNextDistDir,
  };
}

function spawnDevServer() {
  if (stopping) return;
  child = spawn(process.execPath, ["scripts/dev-server.mjs"], {
    stdio: "inherit",
    env: devServerEnv(),
  });
  child.on("exit", handleDevServerExit);
  child.on("error", handleDevServerError);
}

function scheduleDevServerRespawn(reason) {
  if (stopping || devServerRespawnTimer) return;
  const now = Date.now();
  devServerExitTimestamps = [...devServerExitTimestamps, now]
    .filter((at) => now - at < DEV_SERVER_RESPAWN_WINDOW_MS);
  const delay = Math.min(
    DEV_SERVER_RESPAWN_MAX_DELAY_MS,
    DEV_SERVER_RESPAWN_BASE_DELAY_MS * (2 ** Math.max(0, devServerExitTimestamps.length - 1)),
  );
  console.warn(
    `HivemindOS Tauri dev server ${reason}; keeping proxy ${browserHost}:${proxyPort} alive and restarting backend in ${Math.round(delay / 1000)}s.`,
  );
  devServerRespawnTimer = setTimeout(() => {
    devServerRespawnTimer = null;
    spawnDevServer();
  }, delay);
  devServerRespawnTimer.unref?.();
}

function handleDevServerExit(code, signal) {
  child = null;
  if (stopping) return;
  scheduleDevServerRespawn(signal ? `exited from ${signal}` : `exited with status ${code ?? 0}`);
}

function handleDevServerError(error) {
  child = null;
  if (stopping) return;
  console.warn("HivemindOS Tauri dev server could not start.", error);
  scheduleDevServerRespawn("failed to start");
}

const voiceWorkerEnabled = process.env.HIVEMINDOS_VOICE_WORKER !== "0";
const voiceWorker = voiceWorkerEnabled
  ? spawn(
      process.execPath,
      ["scripts/hivemindos-call-agent-worker.mjs", "dev"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          HIVEMINDOS_TAURI_DEV: "1",
          HIVEMINDOS_DASHBOARD_PORT: String(proxyPort),
          HIVEMINDOS_DASHBOARD_URL: `http://${browserHost}:${proxyPort}`,
          LIVEKIT_AGENT_NAME:
            process.env.LIVEKIT_AGENT_NAME || "hivemindos-call-agent",
          LIVEKIT_WORKER_PORT: process.env.LIVEKIT_WORKER_PORT || "8386",
        },
      },
    )
  : null;

function stopChildren(signal = "SIGTERM") {
  stopping = true;
  if (devServerRespawnTimer) {
    clearTimeout(devServerRespawnTimer);
    devServerRespawnTimer = null;
  }
  if (child && !child.killed) child.kill(signal);
  if (voiceWorker && !voiceWorker.killed) voiceWorker.kill(signal);
}

proxyServer.on("error", (error) => {
  stopChildren("SIGTERM");
  restoreGeneratedTypeReferences();
  console.error(error);
  process.exit(1);
});

proxyServer.listen(proxyPort, proxyBindHost, () => {
  console.log(
    `HivemindOS Tauri loading proxy listening on http://${browserHost}:${proxyPort} and ${proxyBindHost}:${proxyPort} -> Next ${nextPort}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    proxyServer.close();
    stopChildren(signal);
    restoreGeneratedTypeReferences();
  });
}

spawnDevServer();

voiceWorker?.on("exit", (code) => {
  if (code && code !== 0) {
    console.warn(
      `HivemindOS call agent worker exited with status ${code}. Next/Tauri dev is still running.`,
    );
  }
});

voiceWorker?.on("error", (error) => {
  console.warn(
    "HivemindOS call agent worker could not start. Next/Tauri dev is still running.",
  );
  console.warn(error);
});
