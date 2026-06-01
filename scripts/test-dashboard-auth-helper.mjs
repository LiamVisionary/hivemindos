import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dir = await mkdtemp(join(tmpdir(), "hivemindos-dashboard-auth-"));
const envFile = join(dir, ".env.local");

try {
  await writeFile(envFile, "EXISTING=value\nHIVEMINDOS_DASHBOARD_DEVICE_TOKEN=old-token\n", "utf8");

  const reset = run("reset-token");
  assert.equal(reset.status, 0, reset.stderr);
  let text = await readFile(envFile, "utf8");
  assert.match(text, /^EXISTING=value$/m);
  assert.match(text, /^HIVEMINDOS_DASHBOARD_DEVICE_TOKEN=[a-f0-9]{64}$/m);
  if (process.platform !== "win32") {
    assert.equal((await stat(envFile)).mode & 0o777, 0o600);
  }

  const rotate = run("rotate-secret");
  assert.equal(rotate.status, 0, rotate.stderr);
  text = await readFile(envFile, "utf8");
  assert.match(text, /^HIVEMINDOS_DASHBOARD_AUTH_SECRET=[a-f0-9]{64}$/m);
  if (process.platform !== "win32") {
    assert.equal((await stat(envFile)).mode & 0o777, 0o600);
  }

  const status = run("status");
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /HIVEMINDOS_DASHBOARD_AUTH_SECRET: present/);
  assert.match(status.stdout, /HIVEMINDOS_DASHBOARD_DEVICE_TOKEN: present/);
  console.log("Dashboard auth helper checks passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}

function run(command) {
  return spawnSync(process.execPath, ["scripts/dashboard-auth.mjs", command, "--env-file", envFile], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
