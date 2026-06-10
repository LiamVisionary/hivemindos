import { mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";

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

function folderDevices(config, existingDevices, peerDeviceID) {
  const devices = [];
  const seen = new Set();
  const addDevice = (device) => {
    const deviceID = String(device?.deviceID || "").trim();
    if (!deviceID || seen.has(deviceID)) return;
    seen.add(deviceID);
    devices.push({ ...device, deviceID });
  };
  for (const device of Array.isArray(existingDevices) ? existingDevices : []) addDevice(device);
  addDevice({ deviceID: config.myID });
  addDevice({ deviceID: peerDeviceID });
  return devices;
}

function mergeFolder(existing, defaults, input, config, deps) {
  const folder = {
    ...defaults,
    ...existing,
    id: deps.safeFolderId(input.folderId || defaults?.id),
    label: input.label || existing?.label || defaults?.label || "HivemindOS Sync",
    path: deps.expandHome(input.path),
    type: "sendreceive",
    paused: false,
    fsWatcherEnabled: true,
    fsWatcherDelayS: existing?.fsWatcherDelayS ?? defaults?.fsWatcherDelayS ?? 10,
    rescanIntervalS: existing?.rescanIntervalS ?? defaults?.rescanIntervalS ?? 30,
    ignorePerms: true,
    devices: folderDevices(config, existing?.devices, input.peerDeviceID),
  };
  delete folder._editing;
  return folder;
}

export function createConfigureSyncthingFolder(deps) {
  return async function configureSyncthingFolder(input) {
    const peerDeviceID = String(input.peerDeviceID || "").trim();
    const path = deps.expandHome(String(input.path || "").trim());
    if (!peerDeviceID) throw new Error("peerDeviceID is required.");
    if (!path) throw new Error("path is required.");
    await mkdir(path, { recursive: true, mode: 0o700 });
    await mkdir(join(path, ".stfolder"), { recursive: true, mode: 0o700 });
    if (!await deps.waitForSyncthing()) throw new Error("Syncthing local API is not reachable.");

    const [config, deviceDefaults, folderDefaults, status] = await Promise.all([
      deps.syncthingFetch("/rest/config"),
      deps.syncthingFetch("/rest/config/defaults/device"),
      deps.syncthingFetch("/rest/config/defaults/folder"),
      deps.syncthingFetch("/rest/system/status"),
    ]);
    config.myID = status.myID;

    const folderId = deps.safeFolderId(input.folderId || `hivemindos-${randomBytes(4).toString("hex")}`);
    const devices = Array.isArray(config.devices) ? config.devices : [];
    const folders = Array.isArray(config.folders) ? config.folders : [];
    const existingDeviceIndex = devices.findIndex((device) => device.deviceID === peerDeviceID);
    const peerDevice = mergeDevice(existingDeviceIndex >= 0 ? devices[existingDeviceIndex] : null, deviceDefaults, {
      deviceID: peerDeviceID,
      name: input.peerName,
      addresses: input.peerAddresses,
    });
    if (existingDeviceIndex >= 0) devices[existingDeviceIndex] = peerDevice;
    else devices.push(peerDevice);

    const existingFolderIndex = folders.findIndex((folder) => folder.id === folderId);
    const folder = mergeFolder(existingFolderIndex >= 0 ? folders[existingFolderIndex] : null, folderDefaults, {
      folderId,
      label: input.label,
      path,
      peerDeviceID,
    }, config, deps);
    if (existingFolderIndex >= 0) folders[existingFolderIndex] = folder;
    else folders.push(folder);

    config.devices = devices;
    config.folders = folders;
    await deps.syncthingFetch("/rest/config", { method: "PUT", body: JSON.stringify(config), timeoutMs: 15_000 });
    await deps.syncthingFetch("/rest/db/scan", {
      method: "POST",
      body: JSON.stringify({ folder: folderId }),
      timeoutMs: 8_000,
    }).catch(() => null);
    const restartRequested = await deps.syncthingFetch("/rest/system/restart", {
      method: "POST",
      timeoutMs: 5_000,
    }).then(() => true).catch(() => false);

    return {
      ok: true,
      host: hostname(),
      deviceID: status.myID,
      folderId,
      label: folder.label,
      path: folder.path,
      peerDeviceID,
      restartRequested,
    };
  };
}
