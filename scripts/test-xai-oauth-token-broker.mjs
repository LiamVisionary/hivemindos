#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = new URL("..", import.meta.url).pathname;
const broker = join(root, "scripts", "xai-oauth-token-broker");
const tempRoot = await mkdtemp(join(tmpdir(), "hmos-xai-oauth-broker-"));
const authStorePath = join(tempRoot, ".hivemindos", "oauth", "xai.json");
const priorHome = process.env.HOME;
process.env.HOME = tempRoot;
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const tokenStore = await import("../src/lib/services/xai-oauth-token-store.ts");

assert.equal(tokenStore.nativeXaiOAuthStorePath(), authStorePath);
assert.equal((await tokenStore.selectedXaiOAuthAuthority()).source, "hivemindos");
const optionalHermesHome = join(tempRoot, ".hermes", "profiles", "queen");
const optionalHermesAuthority = {
  source: "hermes",
  storePath: join(optionalHermesHome, "auth.json"),
  hermesHome: optionalHermesHome,
};
await tokenStore.selectXaiOAuthAuthority(optionalHermesAuthority);
assert.deepEqual(await tokenStore.selectedXaiOAuthAuthority(), optionalHermesAuthority);
await assert.rejects(
  tokenStore.selectXaiOAuthAuthority({
    source: "hermes",
    storePath: join(tempRoot, "outside-hermes", "auth.json"),
    hermesHome: join(tempRoot, "outside-hermes"),
  }),
  /invalid xAI OAuth authority path/,
);
await tokenStore.selectXaiOAuthAuthority({
  source: "hivemindos",
  storePath: authStorePath,
  hermesHome: null,
});

function jwtWithExpiry(exp) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp })}.signature`;
}

let refreshRequests = 0;
const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/oauth2/token") {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    refreshRequests += 1;
    const params = new URLSearchParams(body);
    assert.equal(params.get("grant_type"), "refresh_token");
    if (params.get("refresh_token") === "revoked-refresh") {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_grant", error_description: "Refresh token has been revoked" }));
      return;
    }
    assert.equal(params.get("refresh_token"), "single-use-refresh-1");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      access_token: jwtWithExpiry(Math.floor(Date.now() / 1000) + 3600),
      refresh_token: "single-use-refresh-2",
      expires_in: 3600,
      token_type: "Bearer",
    }));
  });
});

await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const address = server.address();
assert.ok(address && typeof address === "object");
const tokenEndpoint = `http://127.0.0.1:${address.port}/oauth2/token`;

const env = {
  ...process.env,
  HOME: tempRoot,
  HIVEMINDOS_XAI_OAUTH_TEST_MODE: "1",
};
delete env.HERMES_HOME;
delete env.HIVEMINDOS_XAI_OAUTH_STORE;

async function runBroker(action, input = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("python3", [broker, action], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Broker exited with ${code}`));
        return;
      }
      resolvePromise(JSON.parse(stdout));
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

try {
  await runBroker("store", {
    tokens: {
      access_token: jwtWithExpiry(Math.floor(Date.now() / 1000) - 60),
      refresh_token: "single-use-refresh-1",
      expires_in: 1,
      token_type: "Bearer",
    },
    discovery: {
      authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
      token_endpoint: tokenEndpoint,
    },
    redirectUri: "http://127.0.0.1:56121/callback",
  });

  const [first, second] = await Promise.all([
    runBroker("resolve", { refreshSkewSeconds: 60 }),
    runBroker("resolve", { refreshSkewSeconds: 60 }),
  ]);

  assert.equal(refreshRequests, 1, "concurrent callers must spend a single-use refresh token only once");
  assert.equal(first.accessToken, second.accessToken, "both callers should receive the one rotated access token");
  assert.equal(first.tokenType, "Bearer");
  assert.ok(first.expiresAt > Date.now());

  const authStore = JSON.parse(await readFile(authStorePath, "utf8"));
  const stored = authStore.providers["xai-oauth"];
  assert.equal(stored.tokens.refresh_token, "single-use-refresh-2");
  assert.equal(stored.last_auth_error, undefined);
  await assert.rejects(access(join(tempRoot, ".hermes", "auth.json")), { code: "ENOENT" });

  const status = await runBroker("status");
  assert.equal(status.credentialsPresent, true);
  assert.equal(status.usable, true);
  assert.equal(status.needsReconnect, false);
  const nativeModuleUrl = new URL("../src/lib/services/xai-oauth.ts", import.meta.url);
  nativeModuleUrl.searchParams.set("test", "native-no-hermes");
  const nativeOAuth = await import(nativeModuleUrl);
  assert.equal(
    (await nativeOAuth.getXaiOAuthAccess()).accessToken,
    first.accessToken,
    "the real app accessor should use the native HivemindOS store without Hermes",
  );

  await runBroker("store", {
    tokens: {
      access_token: jwtWithExpiry(Math.floor(Date.now() / 1000) - 60),
      refresh_token: "revoked-refresh",
      expires_in: 1,
      token_type: "Bearer",
    },
    discovery: {
      authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
      token_endpoint: tokenEndpoint,
    },
    redirectUri: "http://127.0.0.1:56121/callback",
  });

  await assert.rejects(
    runBroker("resolve", { refreshSkewSeconds: 60 }),
    /Refresh token has been revoked\. Reconnect xAI OAuth\./,
  );
  assert.equal(refreshRequests, 2, "a terminal refresh failure should make one network attempt");
  const failedStatus = await runBroker("status");
  assert.equal(failedStatus.usable, false);
  assert.equal(failedStatus.needsReconnect, true);

  await assert.rejects(
    runBroker("resolve", { refreshSkewSeconds: 60 }),
    /Reconnect xAI OAuth/,
  );
  assert.equal(refreshRequests, 2, "quarantined revoked credentials should fail locally on later requests");

  const optionalAccessToken = jwtWithExpiry(Math.floor(Date.now() / 1000) + 3600);
  await tokenStore.storeXaiOAuthTokens(
    {
      access_token: optionalAccessToken,
      refresh_token: "independent-hermes-refresh",
      expires_in: 3600,
      token_type: "Bearer",
    },
    {
      authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
      token_endpoint: "https://auth.x.ai/oauth2/token",
    },
    "http://127.0.0.1:56121/callback",
    undefined,
    optionalHermesAuthority.storePath,
  );
  await tokenStore.selectXaiOAuthAuthority(optionalHermesAuthority);
  const hermesModuleUrl = new URL("../src/lib/services/xai-oauth.ts", import.meta.url);
  hermesModuleUrl.searchParams.set("test", "optional-hermes");
  const optionalHermesOAuth = await import(hermesModuleUrl);
  const selectedAccess = await optionalHermesOAuth.getXaiOAuthAccess();
  assert.equal(selectedAccess.accessToken, optionalAccessToken, "HivemindOS should use an explicitly selected Hermes session in place");
  assert.equal(
    JSON.parse(await readFile(optionalHermesAuthority.storePath, "utf8")).providers["xai-oauth"].tokens.refresh_token,
    "independent-hermes-refresh",
    "using Hermes in place must not copy or rotate its refresh token",
  );
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
  await rm(tempRoot, { recursive: true, force: true });
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
}

console.log("xAI OAuth token broker rotation checks passed");
