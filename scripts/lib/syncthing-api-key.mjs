import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function defaultSyncthingApiKeyCachePath(home = homedir()) {
  return join(home, ".hivemindos", "syncthing-api-key");
}

export function defaultSyncthingConfigCandidates(home = homedir()) {
  return [
    join(home, "Library", "Application Support", "Syncthing", "config.xml"),
    join(home, ".local", "state", "syncthing", "config.xml"),
    join(home, ".config", "syncthing", "config.xml"),
  ];
}

export function cleanSyncthingApiKey(value) {
  return String(value || "")
    .replace(/\0/g, "")
    .trim();
}

export function extractSyncthingApiKey(configXml) {
  const match = String(configXml || "").match(/<apikey>([^<]+)<\/apikey>/i);
  return cleanSyncthingApiKey(match?.[1] || "");
}

async function writeKeyCache(cachePath, key, io) {
  const clean = cleanSyncthingApiKey(key);
  if (!clean) return false;
  await io.mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
  await io.writeFile(cachePath, `${clean}\n`, { mode: 0o600 });
  await io.chmod(cachePath, 0o600).catch(() => undefined);
  return true;
}

export function createSyncthingApiKeyResolver(options = {}) {
  const env = options.env || process.env;
  const home = options.home || homedir();
  const cachePath = options.cachePath || defaultSyncthingApiKeyCachePath(home);
  const configCandidates =
    options.configCandidates || defaultSyncthingConfigCandidates(home);
  const io = {
    readFile: options.readFile || readFile,
    writeFile: options.writeFile || writeFile,
    mkdir: options.mkdir || mkdir,
    chmod: options.chmod || chmod,
  };
  let cachedPromise = null;

  return async function readSyncthingApiKey() {
    if (cachedPromise) return cachedPromise;
    cachedPromise = (async () => {
      const fromEnv = cleanSyncthingApiKey(env.SYNCTHING_API_KEY);
      if (fromEnv) return fromEnv;

      const fromCache = cleanSyncthingApiKey(
        await io.readFile(cachePath, "utf8").catch(() => ""),
      );
      if (fromCache) return fromCache;

      for (const path of configCandidates) {
        const key = extractSyncthingApiKey(
          await io.readFile(path, "utf8").catch(() => ""),
        );
        if (!key) continue;
        await writeKeyCache(cachePath, key, io).catch(() => undefined);
        return key;
      }
      return "";
    })();
    return cachedPromise;
  };
}
