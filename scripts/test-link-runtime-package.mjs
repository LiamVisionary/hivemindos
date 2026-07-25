import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = join(projectRoot, "src-tauri", "link-runtime");
const nodePath = join(runtimeRoot, process.platform === "win32" ? "node.exe" : "node");
const collectorPath = join(runtimeRoot, "scripts", "agent-telemetry-collector.mjs");
const linkPath = join(runtimeRoot, process.platform === "win32" ? "hivemind-linkd.exe" : "hivemind-linkd");

for (const required of [nodePath, collectorPath, linkPath, join(runtimeRoot, "runtime-manifest.json")]) {
  assert.ok(existsSync(required), `packaged Link runtime is missing ${required}`);
}
assert.ok(existsSync(join(runtimeRoot, "node_modules", "bonjour-service")), "packaged collector should retain fleet discovery without an npm install");
assert.ok(!existsSync(join(runtimeRoot, "setup.ps1")), "Link runtime must not include the Complete Hub installer");
const packagedFiles = await readdir(runtimeRoot, { recursive: true });
assert.ok(!packagedFiles.some((path) => path.endsWith(".py")), "Link runtime must not ship or invoke Python helpers");
for (const licensePath of packagedFiles.filter((path) => path.startsWith("licenses/") || path.startsWith("licenses\\"))) {
  const license = await stat(join(runtimeRoot, licensePath));
  if (license.isFile()) {
    assert.ok(license.mode & 0o200, `packaged license must be writable for repeatable Tauri builds: ${licensePath}`);
  }
}
const runtimeManifest = JSON.parse(await readFile(join(runtimeRoot, "runtime-manifest.json"), "utf8"));
assert.ok(runtimeManifest.licensedGoModules > 0, "packaged Link binary should include its Go dependency notices");
assert.ok(existsSync(join(runtimeRoot, "licenses", "Node.js-LICENSE")), "packaged Node runtime should include its license");

const probe = createServer();
await new Promise((resolveListen, rejectListen) => {
  probe.once("error", rejectListen);
  probe.listen(0, "127.0.0.1", resolveListen);
});
const address = probe.address();
assert.ok(address && typeof address === "object", "could not reserve a collector test port");
const port = address.port;
await new Promise((resolveClose) => probe.close(resolveClose));

const testHome = await mkdtemp(join(tmpdir(), "hivemind-link-runtime-test-"));
let output = "";
const startedAt = Date.now();
const child = spawn(nodePath, [collectorPath], {
  cwd: testHome,
  env: {
    ...process.env,
    HOME: testHome,
    USERPROFILE: testHome,
    AGENT_TELEMETRY_HOST: "127.0.0.1",
    AGENT_TELEMETRY_PORT: String(port),
    HIVE_COLLECTOR_ONLY: "true",
    HIVEMINDOS_APP_DIR: runtimeRoot,
    HIVEMINDOS_MDNS_DISABLE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const childExit = new Promise((resolveExit) => child.once("exit", resolveExit));
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-12_000);
  });
}

try {
  let health;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  assert.equal(child.exitCode, null, `packaged collector exited before health check:\n${output}`);
  assert.equal(health?.ok, true, `packaged collector did not become healthy:\n${output}`);
  assert.equal(health?.mode, "collector-only", "packaged collector must retain restricted mode");
  assert.equal(resolve(health?.version?.appDir || ""), runtimeRoot, "packaged collector must use its bundled app root");
  console.log(`HivemindOS Link packaged runtime booted successfully in ${Date.now() - startedAt}ms.`);
} finally {
  if (child.exitCode === null) child.kill();
  await Promise.race([
    childExit,
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
  await rm(testHome, { recursive: true, force: true });
}
