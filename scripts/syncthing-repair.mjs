import { mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

function findFolderIndex(folders, input, deps) {
  const requestedFolderId = input.folderId ? deps.safeFolderId(input.folderId) : "";
  const targetPath = input.path ? deps.expandHome(String(input.path).trim()) : "";
  if (requestedFolderId) {
    const byId = folders.findIndex((folder) => folder?.id === requestedFolderId);
    if (byId >= 0) return byId;
  }
  if (targetPath) return folders.findIndex((folder) => deps.folderMatchesPath(folder, targetPath));
  return folders.length === 1 ? 0 : -1;
}

function folderDeviceIds(folder, myID, peerDeviceID) {
  const ids = new Set();
  for (const device of Array.isArray(folder?.devices) ? folder.devices : []) {
    const deviceID = String(device?.deviceID || "").trim();
    if (deviceID) ids.add(deviceID);
  }
  if (myID) ids.add(myID);
  if (peerDeviceID) ids.add(peerDeviceID);
  return ids;
}

function mapByDeviceId(devices) {
  return new Map((Array.isArray(devices) ? devices : [])
    .map((device) => [String(device?.deviceID || "").trim(), device])
    .filter(([deviceID]) => deviceID));
}

function mergeDevice(existing, defaults, peer) {
  const device = {
    ...defaults,
    ...existing,
    deviceID: peer.deviceID,
    name: peer.name || existing?.name || defaults?.name || peer.deviceID.slice(0, 7),
    addresses: Array.isArray(peer.addresses) && peer.addresses.length ? peer.addresses : existing?.addresses || ["dynamic"],
    paused: false,
    introducer: false,
    autoAcceptFolders: false,
  };
  delete device._editing;
  return device;
}

function repairFolder(folder, deviceIds, input, deps, actions) {
  if (folder.paused) {
    folder.paused = false;
    actions.push("resumed folder");
  }
  if (folder.type !== "sendreceive") {
    folder.type = "sendreceive";
    actions.push("restored send/receive mode");
  }
  if (folder.fsWatcherEnabled !== true) {
    folder.fsWatcherEnabled = true;
    actions.push("enabled file watcher");
  }
  if (!Number.isFinite(Number(folder.rescanIntervalS)) || Number(folder.rescanIntervalS) <= 0 || Number(folder.rescanIntervalS) > 60) {
    folder.rescanIntervalS = 30;
    actions.push("tightened rescan interval");
  }

  const folderDevicesById = mapByDeviceId(folder.devices);
  for (const deviceID of deviceIds) {
    if (folderDevicesById.has(deviceID)) continue;
    folderDevicesById.set(deviceID, { deviceID });
    actions.push(`re-shared folder with ${deviceID.slice(0, 7)}`);
  }
  folder.devices = Array.from(folderDevicesById.values());
  return deps.expandHome(String(input.path || "").trim());
}

function repairDevices(config, deviceDefaults, deviceIds, input, myID, actions) {
  const peerDeviceID = String(input.peerDeviceID || "").trim();
  const devicesById = mapByDeviceId(config.devices);
  for (const deviceID of deviceIds) {
    const existing = devicesById.get(deviceID);
    if (!existing && deviceID !== myID) {
      devicesById.set(deviceID, mergeDevice(null, deviceDefaults, {
        deviceID,
        name: deviceID === peerDeviceID ? input.peerName : undefined,
        addresses: Array.isArray(input.peerAddresses) ? input.peerAddresses : undefined,
      }));
      actions.push(`restored device ${deviceID.slice(0, 7)}`);
      continue;
    }
    if (existing?.paused) {
      devicesById.set(deviceID, { ...existing, paused: false });
      actions.push(`resumed device ${deviceID.slice(0, 7)}`);
    }
  }
  config.devices = Array.from(devicesById.values());
}

async function writeConfigIfNeeded(config, actions, deps) {
  if (!actions.length) return { configWritten: false, restartRequested: false };
  await deps.syncthingFetch("/rest/config", { method: "PUT", body: JSON.stringify(config), timeoutMs: 15_000 });
  const insync = await deps.syncthingFetch("/rest/system/config/insync").catch(() => null);
  const needsRestart = insync?.configInSync === false || insync?.insync === false;
  if (!needsRestart) return { configWritten: true, restartRequested: false };
  const restartRequested = await deps.syncthingFetch("/rest/system/restart", { method: "POST", timeoutMs: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (restartRequested) {
    await deps.sleep(1_000);
    await deps.waitForSyncthing();
  }
  return { configWritten: true, restartRequested };
}

export function createSyncthingRepair(deps) {
  return async function syncthingRepair(input = {}) {
    const install = await deps.syncthingInstalled();
    if (!install.installed) return { ok: false, installed: false, running: false, error: "Syncthing is not installed on this machine." };
    if (!await deps.waitForSyncthing()) return { ok: false, installed: true, running: false, error: "Syncthing local API is not reachable." };

    const before = await deps.syncthingFolderStatus(input).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read Syncthing status before repair.",
    }));
    const [config, status, deviceDefaults] = await Promise.all([
      deps.syncthingFetch("/rest/config"),
      deps.syncthingFetch("/rest/system/status").catch(() => null),
      deps.syncthingFetch("/rest/config/defaults/device").catch(() => ({})),
    ]);
    const myID = status?.myID || config?.myID || "";
    config.myID = myID;
    config.devices = Array.isArray(config.devices) ? config.devices : [];
    config.folders = Array.isArray(config.folders) ? config.folders : [];

    const folderIndex = findFolderIndex(config.folders, input, deps);
    if (folderIndex < 0) {
      return { ok: false, installed: true, running: true, error: "No Syncthing folder matched this vault. Pair Hivemind Sync first, then run repair again.", before };
    }

    const folder = { ...config.folders[folderIndex] };
    const actions = [];
    const deviceIds = folderDeviceIds(folder, myID, String(input.peerDeviceID || "").trim());
    const repairedPath = repairFolder(folder, deviceIds, input, deps, actions);
    if (repairedPath) {
      await mkdir(repairedPath, { recursive: true, mode: 0o700 });
      await mkdir(join(repairedPath, ".stfolder"), { recursive: true, mode: 0o700 });
    }
    repairDevices(config, deviceDefaults, deviceIds, input, myID, actions);
    config.folders[folderIndex] = folder;

    const { configWritten, restartRequested } = await writeConfigIfNeeded(config, actions, deps);
    await deps.syncthingFetch(`/rest/db/scan?folder=${encodeURIComponent(folder.id)}`, { method: "POST", timeoutMs: 15_000 })
      .then(() => actions.push("rescanned folder"))
      .catch((error) => actions.push(`rescan deferred: ${error instanceof Error ? error.message : "Syncthing scan failed"}`));
    const after = await deps.syncthingFolderStatus({ folderId: folder.id }).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read Syncthing status after repair.",
    }));

    return {
      ok: true,
      installed: true,
      running: true,
      host: hostname(),
      folderId: folder.id,
      path: folder.path,
      configWritten,
      restartRequested,
      actions: actions.length ? actions : ["checked configuration"],
      before,
      after,
    };
  };
}
