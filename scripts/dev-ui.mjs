#!/usr/bin/env node
// `pnpm dev:ui` — fast browser-based UI/dashboard dev.
//
// The Tauri dev app renders in macOS WKWebView (the only engine Tauri can use on
// macOS) plus a transparent-window compositing tax, and it recompiles the native
// Rust shell on every launch. That makes it far slower than a browser for
// iterating on the dashboard UI — same dev server, same JS, but a much heavier
// runtime. So for UI work, skip the native shell entirely: this serves the Next
// dev server and opens it in your default browser (Chrome/Blink = fast HMR + real
// devtools). Reserve `pnpm tauri:dev` for testing native/Tauri behavior.
//
// Consistent with AGENTS.md "Dev Server Ownership": if a HivemindOS dev server is
// already running, this REUSES it (just opens the browser) instead of spawning
// another.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request } from "node:http";

const host = "127.0.0.1";

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

// A HivemindOS dev server answers "/" with an HTTP response (200/3xx/401-auth).
function serverAnswering(port) {
  return new Promise((resolve) => {
    const probe = request({ hostname: "localhost", port, path: "/", method: "HEAD" }, (response) => {
      response.resume();
      resolve(typeof response.statusCode === "number");
    });
    probe.setTimeout(1_000, () => {
      probe.destroy();
      resolve(false);
    });
    probe.on("error", () => resolve(false));
    probe.end();
  });
}

async function findFreePort(start) {
  for (let port = start; port < start + 30; port += 1) {
    if (await portFree(port)) return port;
  }
  throw new Error(`No free port found from ${start}.`);
}

function openBrowser(url) {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  console.log(`\n  ▶ HivemindOS UI dev (browser, no Tauri): ${url}\n`);
  spawn(opener, args, { stdio: "ignore", detached: true }).unref();
}

// 1) Reuse an already-running dev server (managed 5020 or the Tauri proxy 5021).
for (const existing of [5021, 5020]) {
  if (!(await portFree(existing)) && (await serverAnswering(existing))) {
    openBrowser(`http://localhost:${existing}`);
    process.exit(0);
  }
}

// 2) Otherwise start a Tauri-free Next dev server (no Rust build, no WKWebView)
//    on a free port away from 5020/5021, then open the browser once it answers.
const port = await findFreePort(Number(process.env.PORT) || 5030);
const url = `http://localhost:${port}`;

const child = spawn(process.execPath, ["scripts/dev-server.mjs", "-p", String(port), "-H", host], {
  stdio: "inherit",
  env: { ...process.env, PORT: String(port) },
});

(async () => {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (await serverAnswering(port)) {
      openBrowser(url);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.warn(`Dev server did not answer on ${url} within 2 min; open it manually.`);
})();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (!child.killed) child.kill(signal);
    process.exit(0);
  });
}
child.on("exit", (code) => process.exit(code ?? 0));
