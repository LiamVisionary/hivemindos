import { spawn } from "node:child_process";
import { createReadStream, rmSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

const nextEnvPath = fileURLToPath(new URL("../next-env.d.ts", import.meta.url));
const tauriNextDir = fileURLToPath(new URL("../.next-tauri", import.meta.url));
const loadingDir = fileURLToPath(new URL("../src-tauri/loading/", import.meta.url));
const loadingHtmlPath = fileURLToPath(new URL("../src-tauri/loading/index.html", import.meta.url));
const loadingIconPath = fileURLToPath(new URL("../src-tauri/loading/icon-192.png", import.meta.url));
const proxyPort = Number(process.env.PORT || "5021");
const nextPort = Number(process.env.HIVEMINDOS_TAURI_NEXT_PORT || proxyPort + 100);
const host = "127.0.0.1";

function restoreNextEnv() {
  try {
    const current = readFileSync(nextEnvPath, "utf8");
    const restored = current.replace(
      'import "./.next-tauri/dev/types/routes.d.ts";',
      'import "./.next/dev/types/routes.d.ts";',
    );
    if (restored !== current) writeFileSync(nextEnvPath, restored);
  } catch {
    // Best-effort cleanup for Next.js' generated type reference.
  }
}

function contentType(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

function sendFile(response, path, status = 200) {
  response.writeHead(status, {
    "Content-Type": contentType(path),
    "Cache-Control": "no-store",
  });
  createReadStream(path).pipe(response);
}

function sendLoading(response) {
  const html = readFileSync(loadingHtmlPath, "utf8").replace(
    "</body>",
    '<script>setInterval(function(){fetch("/__hivemindos_dev_ready",{cache:"no-store"}).then(function(response){if(response.ok) location.reload();}).catch(function(){});},500);</script></body>',
  );
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

function proxyHttp(clientRequest, clientResponse) {
  let handled = false;
  const useFallback = () => {
    if (handled || clientResponse.headersSent) return;
    handled = true;
    if (clientRequest.url === "/__hivemindos_dev_ready") {
      clientResponse.writeHead(503, { "Cache-Control": "no-store" });
      clientResponse.end("warming");
      return;
    }
    if (clientRequest.headers.accept?.includes("text/html")) {
      sendLoading(clientResponse);
      return;
    }
    clientResponse.writeHead(503, { "Cache-Control": "no-store" });
    clientResponse.end("HivemindOS dev server is warming up.");
  };

  const proxyRequest = httpRequest(
    {
      hostname: host,
      port: nextPort,
      method: clientRequest.method,
      path: clientRequest.url,
      headers: {
        ...clientRequest.headers,
        host: `${host}:${nextPort}`,
      },
    },
    (proxyResponse) => {
      handled = true;
      clientResponse.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
      proxyResponse.pipe(clientResponse);
    },
  );

  proxyRequest.setTimeout(650, () => {
    proxyRequest.destroy();
    useFallback();
  });
  proxyRequest.on("error", useFallback);

  clientRequest.pipe(proxyRequest);
}

const proxyServer = createServer((request, response) => {
  if (request.url === "/__hivemindos_dev_ready") {
    const readinessRequest = httpRequest({ hostname: host, port: nextPort, path: "/", method: "HEAD" }, (readinessResponse) => {
      response.writeHead(readinessResponse.statusCode && readinessResponse.statusCode < 500 ? 204 : 503, {
        "Cache-Control": "no-store",
      });
      response.end();
      readinessResponse.resume();
    });
    readinessRequest.setTimeout(650, () => {
      readinessRequest.destroy();
      response.writeHead(503, { "Cache-Control": "no-store" });
      response.end();
    });
    readinessRequest.on("error", () => {
      if (response.headersSent) return;
      response.writeHead(503, { "Cache-Control": "no-store" });
      response.end();
    });
    readinessRequest.end();
    return;
  }

  if (request.url === "/icon-192.png") {
    sendFile(response, loadingIconPath);
    return;
  }

  if (request.url && request.url.startsWith("/loading/")) {
    const fileName = request.url.slice("/loading/".length).split("?")[0];
    if (!fileName.includes("/") && extname(fileName)) {
      sendFile(response, fileURLToPath(new URL(fileName, `file://${loadingDir}`)));
      return;
    }
  }

  proxyHttp(request, response);
});

proxyServer.on("upgrade", (request, socket, head) => {
  const upstream = connect(nextPort, host, () => {
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`);
    for (const [key, value] of Object.entries(request.headers)) {
      if (key.toLowerCase() === "host") continue;
      upstream.write(`${key}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`);
    }
    upstream.write(`host: ${host}:${nextPort}\r\n\r\n`);
    upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
});

rmSync(tauriNextDir, { force: true, recursive: true });

const child = spawn(process.execPath, ["scripts/dev-server.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(nextPort),
    HIVEMINDOS_TAURI_DEV: "1",
  },
});

proxyServer.listen(proxyPort, host, () => {
  console.log(`HivemindOS Tauri loading proxy listening on http://${host}:${proxyPort} -> Next ${nextPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    proxyServer.close();
    child.kill(signal);
  });
}

child.on("exit", (code) => {
  proxyServer.close();
  restoreNextEnv();
  process.exit(code ?? 0);
});
