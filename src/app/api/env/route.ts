import { execFile, spawn } from "child_process";
import { join } from "path";
import { promisify } from "util";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type HiveEnvExport = {
  version?: number;
  scope?: string;
  runtime?: string;
  values?: Record<string, string>;
};

type HiveEnvBackupStatus = {
  version?: number;
  scope?: string;
  runtime?: string;
  envFile?: string;
  backupPath?: string;
  backupExists?: boolean;
  gpgAvailable?: boolean;
  backupApplies?: boolean;
  error?: string;
};

const SHARED_SOURCE = { id: "shared", label: "Shared sync store", scope: "agent", runtime: "generic" } as const;
const RUNTIME_SOURCES = [
  { id: "runtime-openclaw", label: "OpenClaw", scope: "agent", runtime: "openclaw" },
  { id: "runtime-hermes", label: "Hermes", scope: "agent", runtime: "hermes" },
  { id: "runtime-aeon", label: "Aeon", scope: "agent", runtime: "aeon" },
] as const;
const ALL_AGENT_SOURCES = [SHARED_SOURCE, ...RUNTIME_SOURCES] as const;

type EnvUpdateBody = {
  sourceId?: string;
  key?: string;
  value?: string;
  promoteToShared?: boolean;
  action?: "restoreBackup" | "syncMachines";
  entries?: Record<string, string>;
};

function sourceById(id: string) {
  return ALL_AGENT_SOURCES.find((source) => source.id === id);
}

function updateHiveEnvSource(source: (typeof ALL_AGENT_SOURCES)[number], key: string, value: string, options: { backup?: boolean; sync?: boolean } = {}) {
  const args = [
    "--stdin",
    "--scope",
    source.scope,
    "--runtime",
    source.runtime,
    key,
  ];
  if (options.backup === false) args.splice(1, 0, "--no-backup");
  if (options.sync === false) args.splice(1, 0, "--no-tailnet-sync");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.cwd(), "scripts", "hive-env-add"), args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let errorText = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while saving env variable."));
    }, 30_000);
    child.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorText.trim() || "hive-env-add could not save env variable."));
    });
    child.stdin.end(value);
  });
}

function encodeEnvEntries(entries: Record<string, string>) {
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n") + "\n";
}

function importHiveEnvSource(source: (typeof ALL_AGENT_SOURCES)[number], entries: Record<string, string>, options: { backup?: boolean; sync?: boolean } = {}) {
  const args = [
    "--import-stdin",
    "--scope",
    source.scope,
    "--runtime",
    source.runtime,
  ];
  if (options.backup === false) args.splice(1, 0, "--no-backup");
  if (options.sync === false) args.splice(1, 0, "--no-tailnet-sync");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.cwd(), "scripts", "hive-env-add"), args, {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let errorText = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while importing env variables."));
    }, 90_000);
    child.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorText.trim() || "hive-env-add could not import env variables."));
    });
    child.stdin.end(encodeEnvEntries(entries));
  });
}

async function readSharedBackupStatus() {
  try {
    const { stdout } = await execFileAsync(join(process.cwd(), "scripts", "hive-env-add"), [
      "--backup-status",
      "--scope",
      SHARED_SOURCE.scope,
      "--runtime",
      SHARED_SOURCE.runtime,
    ], {
      timeout: 12_000,
      maxBuffer: 1_000_000,
    });
    return JSON.parse(stdout) as HiveEnvBackupStatus;
  } catch (error) {
    return {
      backupExists: false,
      gpgAvailable: false,
      error: error instanceof Error ? error.message : "Could not read encrypted backup status.",
    };
  }
}

async function readHiveEnvSource(source: (typeof ALL_AGENT_SOURCES)[number]) {
  try {
    const { stdout } = await execFileAsync(join(process.cwd(), "scripts", "hive-env-add"), [
      "--export-json",
      "--scope",
      source.scope,
      "--runtime",
      source.runtime,
    ], {
      timeout: 12_000,
      maxBuffer: 1_000_000,
    });
    const payload = JSON.parse(stdout) as HiveEnvExport;
    const values = payload.values && typeof payload.values === "object" ? payload.values : {};
    return {
      ...source,
      values: Object.fromEntries(
        Object.entries(values)
          .filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === "string")
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    };
  } catch (error) {
    return {
      ...source,
      values: {},
      error: error instanceof Error ? error.message : "Could not read this env source.",
    };
  }
}

async function readEnvPayload() {
  const [sharedSource, ...runtimeSources] = await Promise.all(ALL_AGENT_SOURCES.map(readHiveEnvSource));
  const backupStatus = await readSharedBackupStatus();
  const sharedKeys = new Set(Object.keys(sharedSource.values));
  const unsharedRuntimeSources = runtimeSources.map((source) => ({
    ...source,
    values: Object.fromEntries(
      Object.entries(source.values)
        .filter(([key]) => !sharedKeys.has(key))
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  }));
  return {
    ok: true,
    sharedSource,
    runtimeSources: unsharedRuntimeSources,
    backupStatus,
    total: Object.keys(sharedSource.values).length,
  };
}

function restoreSharedBackup() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.cwd(), "scripts", "hive-env-add"), [
      "--restore-backup",
      "--scope",
      SHARED_SOURCE.scope,
      "--runtime",
      SHARED_SOURCE.runtime,
    ], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorText = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while restoring encrypted env backup."));
    }, 90_000);
    child.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorText.trim() || "hive-env-add could not restore the encrypted env backup."));
    });
  });
}

function syncSharedEnvMachines() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.cwd(), "scripts", "hive-env-add"), [
      "--reconcile",
      "--scope",
      SHARED_SOURCE.scope,
      "--runtime",
      SHARED_SOURCE.runtime,
    ], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorText = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while syncing env variables."));
    }, 90_000);
    child.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorText.trim() || "hive-env-add could not sync env variables."));
    });
  });
}

export async function GET(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  return Response.json(await readEnvPayload());
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({})) as EnvUpdateBody;

  if (body.action === "restoreBackup") {
    try {
      await restoreSharedBackup();
      return Response.json(await readEnvPayload());
    } catch (error) {
      return Response.json({
        ok: false,
        error: error instanceof Error ? error.message : "Could not restore encrypted env backup.",
      }, { status: 500 });
    }
  }

  if (body.action === "syncMachines") {
    try {
      await syncSharedEnvMachines();
      return Response.json(await readEnvPayload());
    } catch (error) {
      return Response.json({
        ok: false,
        error: error instanceof Error ? error.message : "Could not sync env variables.",
      }, { status: 500 });
    }
  }

  const source = sourceById(body.sourceId ?? "");
  const key = body.key?.trim() ?? "";
  const value = body.value ?? "";
  const entries = body.entries && typeof body.entries === "object"
    ? Object.fromEntries(
      Object.entries(body.entries)
        .filter(([entryKey, entryValue]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(entryKey) && typeof entryValue === "string"),
    )
    : {};

  if (!source) {
    return Response.json({ ok: false, error: "Unknown env source." }, { status: 400 });
  }
  if (Object.keys(entries).length) {
    try {
      if (source.id === SHARED_SOURCE.id || body.promoteToShared) {
        await importHiveEnvSource(SHARED_SOURCE, entries);
        await Promise.all(
          RUNTIME_SOURCES.map((target) => importHiveEnvSource(target, entries, { backup: false, sync: false })),
        );
      } else {
        await importHiveEnvSource(source, entries, { backup: false });
      }
      return Response.json(await readEnvPayload());
    } catch (error) {
      return Response.json({
        ok: false,
        error: error instanceof Error ? error.message : "Could not import env variables.",
      }, { status: 500 });
    }
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return Response.json({ ok: false, error: "Invalid env variable name." }, { status: 400 });
  }

  try {
    if (source.id === SHARED_SOURCE.id || body.promoteToShared) {
      await updateHiveEnvSource(SHARED_SOURCE, key, value);
      await Promise.all(
        RUNTIME_SOURCES.map((target) => updateHiveEnvSource(target, key, value, { backup: false, sync: false })),
      );
    } else {
      await updateHiveEnvSource(source, key, value, { backup: false });
    }
    return Response.json(await readEnvPayload());
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not save env variable.",
    }, { status: 500 });
  }
}
