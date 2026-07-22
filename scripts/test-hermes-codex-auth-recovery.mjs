#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  hermesAgentUsesCodex,
  repairHermesCodexAuth,
} from "./lib/hermes-codex-auth-recovery.mjs";

const execFileAsync = promisify(execFile);
const defaultHermesHome = process.env.HERMES_HOME || join(homedir(), ".hermes");
const projectDir = join(defaultHermesHome, "hermes-agent");
const pythonPath =
  process.env.HERMES_PYTHON || join(projectDir, "venv", "bin", "python");

function jwtWithExpiry(expiry) {
  const payload = Buffer.from(JSON.stringify({ exp: expiry })).toString("base64url");
  return `header.${payload}.signature`;
}

function authStore(accessToken, refreshToken) {
  return {
    version: 1,
    providers: {
      "openai-codex": {
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
        auth_mode: "chatgpt",
      },
    },
  };
}

function expiredPoolAuthStore(accessToken) {
  return {
    version: 1,
    providers: {},
    credential_pool: {
      "openai-codex": [
        {
          id: "expired-profile-entry",
          source: "manual:device_code",
          auth_type: "oauth",
          access_token: accessToken,
          refresh_token: "dead-profile-refresh-token",
          last_status: "ok",
        },
      ],
    },
  };
}

assert.equal(hermesAgentUsesCodex({ provider: "openai-codex" }), true);
assert.equal(hermesAgentUsesCodex({ provider: "openrouter" }), false);

const testRoot = await mkdtemp(join(tmpdir(), "hivemindos-hermes-codex-recovery-"));
try {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const codexHome = join(testRoot, "codex");
  await mkdir(codexHome, { recursive: true });
  const cliAccessToken = jwtWithExpiry(nowSeconds + 3_600);
  await writeFile(
    join(codexHome, "auth.json"),
    JSON.stringify({
      tokens: {
        access_token: cliAccessToken,
        refresh_token: "cli-refresh-token",
      },
    }),
  );

  const expiredProfileHome = join(testRoot, "expired-profile");
  await mkdir(expiredProfileHome, { recursive: true });
  await writeFile(
    join(expiredProfileHome, "auth.json"),
    JSON.stringify(expiredPoolAuthStore(jwtWithExpiry(nowSeconds - 60))),
  );
  const repaired = await repairHermesCodexAuth({
    hermesHome: expiredProfileHome,
    projectDir,
    pythonPath,
    execFileAsync,
    env: { ...process.env, CODEX_HOME: codexHome },
  });
  assert.equal(repaired.status, "repaired");
  assert.equal(repaired.source, "codex-cli");
  const repairedStore = JSON.parse(
    await readFile(join(expiredProfileHome, "auth.json"), "utf8"),
  );
  assert.equal(
    repairedStore.providers["openai-codex"].tokens.access_token,
    cliAccessToken,
  );

  const healthyProfileHome = join(testRoot, "healthy-profile");
  await mkdir(healthyProfileHome, { recursive: true });
  const healthyAccessToken = jwtWithExpiry(nowSeconds + 7_200);
  await writeFile(
    join(healthyProfileHome, "auth.json"),
    JSON.stringify(authStore(healthyAccessToken, "healthy-profile-refresh-token")),
  );
  const healthy = await repairHermesCodexAuth({
    hermesHome: healthyProfileHome,
    projectDir,
    pythonPath,
    execFileAsync,
    env: { ...process.env, CODEX_HOME: codexHome },
  });
  assert.equal(healthy.status, "healthy");
  const untouchedStore = JSON.parse(
    await readFile(join(healthyProfileHome, "auth.json"), "utf8"),
  );
  assert.equal(
    untouchedStore.providers["openai-codex"].tokens.access_token,
    healthyAccessToken,
  );

  const missingCliHome = join(testRoot, "missing-cli-profile");
  await mkdir(missingCliHome, { recursive: true });
  await writeFile(
    join(missingCliHome, "auth.json"),
    JSON.stringify(expiredPoolAuthStore(jwtWithExpiry(nowSeconds - 60))),
  );
  const unavailable = await repairHermesCodexAuth({
    hermesHome: missingCliHome,
    projectDir,
    pythonPath,
    execFileAsync,
    env: { ...process.env, CODEX_HOME: join(testRoot, "missing-codex-home") },
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.reason, "codex_cli_login_unavailable");
} finally {
  await rm(testRoot, { recursive: true, force: true });
}

const collectorSource = await readFile(
  new URL("./agent-telemetry-collector.mjs", import.meta.url),
  "utf8",
);
assert.match(
  collectorSource,
  /await repairHermesCodexAuthBeforeChat\(agent, hermesHome\)/g,
);
assert.equal(
  collectorSource.match(/await repairHermesCodexAuthBeforeChat\(agent, hermesHome\)/g)?.length,
  2,
  "both streaming and non-streaming Hermes chat paths must run the preflight",
);

console.log("Hermes Codex auth recovery regression passed");
