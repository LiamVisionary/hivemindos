#!/usr/bin/env node
// Hermetic protocol-level tests for the MarkItDown sidecar client against a
// scripted fake sidecar: a request timeout must reject only that request,
// and the child is restarted only when it is actually wedged (no output of
// any kind during the timed-out request's window).
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.platform === "win32") {
  console.log("MarkItDown sidecar client test skipped on Windows (shebang sidecar fixture).");
  process.exit(0);
}

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const root = await mkdtemp(join(tmpdir(), "hivemind-markitdown-client-"));
const spawnLog = join(root, "spawns.log");
const fakeBinary = join(root, "fake-sidecar.mjs");
await writeFile(fakeBinary, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import readline from "node:readline";

appendFileSync(process.env.SIDECAR_SPAWN_LOG, \`\${process.pid}\\n\`);
process.stdout.write(\`\${JSON.stringify({ type: "ready", ok: true, converterVersion: "test-docs-1" })}\\n\`);
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  const name = basename(request.path);
  // hang-* and slow-* requests are never answered; hang-* scenarios also
  // produce no other output, so the client should treat the child as wedged.
  if (name.startsWith("hang") || name.startsWith("slow")) return;
  process.stdout.write(\`\${JSON.stringify({ id: request.id, ok: true, markdown: \`converted:\${name}\`, converterVersion: "test-docs-1" })}\\n\`);
});
`, "utf8");
await chmod(fakeBinary, 0o755);

const {
  convertWithMarkItDownSidecar,
  shutdownMarkItDownSidecar,
} = await import("../src/lib/services/markitdown-sidecar-client.ts");

const environment = { ...process.env, SIDECAR_SPAWN_LOG: spawnLog };
const convert = (name, timeoutMs) => convertWithMarkItDownSidecar({
  binaries: [fakeBinary],
  expectedVersion: "test-docs-1",
  environment,
  filePath: join(root, name),
  timeoutMs,
});
const spawnCount = async () => (await readFile(spawnLog, "utf8")).split("\n").filter(Boolean).length;

try {
  // One slow request times out while another completes on the same child:
  // only the slow request may fail, and the child must keep serving.
  const slowRequest = convert("slow-a.txt", 700);
  const fastRequest = convert("fast-a.txt", 5_000);
  assert.equal((await fastRequest).markdown, "converted:fast-a.txt");
  await assert.rejects(slowRequest, /timed out after 700 ms/);
  assert.equal((await convert("fast-b.txt", 5_000)).markdown, "converted:fast-b.txt",
    "the child must survive a single-request timeout");
  assert.equal(await spawnCount(), 1,
    "a request timeout with a live child must not restart the sidecar");

  // A child that produces no output at all during the timed-out request's
  // window is wedged: every pending request rejects and the next conversion
  // gets a fresh child.
  const wedgedA = convert("hang-a.txt", 600);
  const wedgedB = convert("hang-b.txt", 5_000);
  await assert.rejects(wedgedA, /timed out after 600 ms/);
  await assert.rejects(wedgedB, /timed out after 600 ms/,
    "a wedged shutdown rejects the other in-flight requests too");
  assert.equal((await convert("fast-c.txt", 5_000)).markdown, "converted:fast-c.txt");
  assert.equal(await spawnCount(), 2, "a wedged child is replaced by a fresh spawn");

  console.log("MarkItDown sidecar client timeout-isolation tests passed.");
} finally {
  shutdownMarkItDownSidecar();
  await rm(root, { recursive: true, force: true });
}
