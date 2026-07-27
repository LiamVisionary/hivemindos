#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  cleanSyncthingApiKey,
  createSyncthingApiKeyResolver,
  defaultSyncthingApiKeyCachePath,
  defaultSyncthingConfigCandidates,
  extractSyncthingApiKey,
} from "./lib/syncthing-api-key.mjs";

assert.equal(cleanSyncthingApiKey(" abc\0 \n"), "abc");
assert.equal(extractSyncthingApiKey("<configuration><gui><apikey>secret-123</apikey></gui></configuration>"), "secret-123");
assert.equal(extractSyncthingApiKey("<configuration></configuration>"), "");
assert.equal(defaultSyncthingApiKeyCachePath("/Users/example"), "/Users/example/.hivemindos/syncthing-api-key");
assert.deepEqual(defaultSyncthingConfigCandidates("/Users/example"), [
  "/Users/example/Library/Application Support/Syncthing/config.xml",
  "/Users/example/.local/state/syncthing/config.xml",
  "/Users/example/.config/syncthing/config.xml",
]);

function memoryIo(files = {}) {
  const store = new Map(Object.entries(files));
  const calls = { read: [], write: [], mkdir: [], chmod: [] };
  return {
    calls,
    readFile: async (path) => {
      calls.read.push(path);
      if (!store.has(path)) throw new Error(`missing ${path}`);
      return store.get(path);
    },
    writeFile: async (path, value, options) => {
      calls.write.push({ path, value, options });
      store.set(path, value);
    },
    mkdir: async (path, options) => {
      calls.mkdir.push({ path, options });
    },
    chmod: async (path, mode) => {
      calls.chmod.push({ path, mode });
    },
  };
}

{
  const io = memoryIo();
  const readKey = createSyncthingApiKeyResolver({
    env: { SYNCTHING_API_KEY: "env-key" },
    cachePath: "/cache/key",
    configCandidates: ["/protected/config.xml"],
    ...io,
  });
  assert.equal(await readKey(), "env-key");
  assert.deepEqual(io.calls.read, [], "env key avoids all filesystem reads");
}

{
  const io = memoryIo({ "/cache/key": "cached-key\n" });
  const readKey = createSyncthingApiKeyResolver({
    env: {},
    cachePath: "/cache/key",
    configCandidates: ["/protected/config.xml"],
    ...io,
  });
  assert.equal(await readKey(), "cached-key");
  assert.deepEqual(io.calls.read, ["/cache/key"], "cache hit avoids Syncthing app-data config");
}

{
  const io = memoryIo({
    "/protected/config.xml": "<configuration><gui><apikey>migrated-key</apikey></gui></configuration>",
  });
  const readKey = createSyncthingApiKeyResolver({
    env: {},
    cachePath: "/cache/key",
    configCandidates: ["/protected/config.xml"],
    ...io,
  });
  assert.equal(await readKey(), "migrated-key");
  assert.deepEqual(io.calls.read, ["/cache/key", "/protected/config.xml"]);
  assert.deepEqual(io.calls.write, [{ path: "/cache/key", value: "migrated-key\n", options: { mode: 0o600 } }]);
  assert.deepEqual(io.calls.chmod, [{ path: "/cache/key", mode: 0o600 }]);

  assert.equal(await readKey(), "migrated-key");
  assert.deepEqual(io.calls.read, ["/cache/key", "/protected/config.xml"], "resolver memoizes the migrated key in-process");
}

console.log("syncthing api key cache guard passed");
