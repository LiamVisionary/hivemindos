import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { homedir } from "@/lib/home-dir";
import {
  buildListmonkComposeYaml,
  LISTMONK_VERSION,
} from "@/lib/services/listmonk-compose";
import type {
  InstallableServiceAction,
  InstallableServiceStatus,
} from "@/lib/services/installable-services";

const execFileAsync = promisify(execFile);
const LISTMONK_PROJECT = "hivemindos-listmonk";
const LISTMONK_OPEN_URL = "http://127.0.0.1:9000";
const LISTMONK_SERVICE_DIR = join(homedir(), ".hivemindos", "services", "listmonk");
const LISTMONK_COMPOSE_FILE = join(LISTMONK_SERVICE_DIR, "compose.yaml");
const LISTMONK_ENV_FILE = join(LISTMONK_SERVICE_DIR, "service.env");

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

async function run(command: string, args: string[], timeout = 20_000): Promise<CommandResult> {
  return execFileAsync(command, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 500_000,
  }).then(
    ({ stdout, stderr }) => ({ ok: true, stdout, stderr }),
    (error: unknown) => {
      const commandError = error as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        stdout: commandError.stdout ?? "",
        stderr: commandError.stderr ?? commandError.message ?? "",
      };
    },
  );
}

function composeArgs(args: string[]) {
  return [
    "compose",
    "--project-name",
    LISTMONK_PROJECT,
    "--env-file",
    LISTMONK_ENV_FILE,
    "--file",
    LISTMONK_COMPOSE_FILE,
    ...args,
  ];
}

async function dockerReadiness() {
  const cli = (await run("docker", ["--version"], 5_000)).ok
    && (await run("docker", ["compose", "version"], 5_000)).ok;
  const daemon = cli && (await run("docker", ["info"], 8_000)).ok;
  return { cli, daemon };
}

async function serviceNames(args: string[]) {
  const result = await run("docker", composeArgs(args), 10_000);
  if (!result.ok) return [];
  return result.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
}

async function listmonkReachable() {
  return fetch(LISTMONK_OPEN_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(1_500),
  }).then(
    (response) => response.status < 500,
    () => false,
  );
}

function listmonkStatus(partial: Partial<InstallableServiceStatus> = {}): InstallableServiceStatus {
  return {
    id: "listmonk",
    name: "Listmonk",
    installed: false,
    running: false,
    openUrl: LISTMONK_OPEN_URL,
    detail: "Listmonk is not installed.",
    installMethod: "docker",
    requirements: ["Docker Desktop or Docker Engine", "An SMTP provider and verified sending domain for live email"],
    sourceUrl: "https://github.com/knadh/listmonk",
    provenance: {
      packageName: `listmonk ${LISTMONK_VERSION} with PostgreSQL`,
      packageManager: "Docker Compose",
      installCommand: "Create a local HivemindOS Compose project and start its pinned containers.",
      updatePolicy: "Listmonk and PostgreSQL images are pinned by immutable multi-architecture digest; upgrades require a fresh review.",
    },
    securityNotes: [
      "The admin UI binds to 127.0.0.1 only, and PostgreSQL is not published to the host network.",
      "This installs campaign and transactional-email software, not an inbox. No email is sent until a user configures an SMTP provider in Listmonk.",
      "Campaign HTML, uploads, templates, and raw-SQL permissions are powerful; grant administrative access only to trusted operators.",
      "Stop preserves the PostgreSQL and uploads volumes. Back up both volumes before upgrades or manual removal.",
    ],
    projectDir: LISTMONK_SERVICE_DIR,
    ...partial,
  };
}

async function createManagedFile(path: string, contents: string, mode: number) {
  try {
    await writeFile(path, contents, { encoding: "utf8", flag: "wx", mode });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await chmod(path, mode);
}

async function ensureListmonkConfiguration() {
  await mkdir(LISTMONK_SERVICE_DIR, { recursive: true, mode: 0o700 });
  await chmod(LISTMONK_SERVICE_DIR, 0o700);
  await createManagedFile(
    LISTMONK_ENV_FILE,
    `LISTMONK_DB_PASSWORD=${randomBytes(32).toString("base64url")}\n`,
    0o600,
  );
  await createManagedFile(LISTMONK_COMPOSE_FILE, buildListmonkComposeYaml(), 0o600);
}

export async function readListmonkInstallableServiceStatus(): Promise<InstallableServiceStatus> {
  const installed = existsSync(LISTMONK_COMPOSE_FILE) && existsSync(LISTMONK_ENV_FILE);
  const docker = await dockerReadiness();
  const runningServices = installed && docker.daemon
    ? await serviceNames(["ps", "--status", "running", "--services"])
    : [];
  const running = runningServices.includes("listmonk") && await listmonkReachable();

  let detail = "Listmonk Docker service is ready to install on localhost.";
  if (!docker.cli) detail = "Docker Desktop or Docker Engine with Compose is required before HivemindOS can install Listmonk.";
  else if (!docker.daemon) detail = installed
    ? "Listmonk configuration is installed, but the Docker daemon is not running."
    : "Docker Desktop or Docker Engine is required before HivemindOS can install Listmonk.";
  else if (installed && running) detail = "Listmonk is running on localhost:9000. Configure SMTP and a verified sending domain before live sends.";
  else if (installed) detail = "Listmonk is installed but stopped. Its PostgreSQL and uploads volumes are preserved.";

  return listmonkStatus({
    installed,
    running,
    version: installed ? LISTMONK_VERSION : undefined,
    detail,
    preflight: [
      {
        key: "docker-compose",
        ok: docker.daemon,
        detail: docker.daemon ? "Docker Compose and the Docker daemon are ready." : "Docker Compose and a running Docker daemon are required.",
      },
      {
        key: "local-only",
        ok: true,
        detail: "The admin UI is bound to 127.0.0.1; PostgreSQL has no published host port.",
      },
      {
        key: "smtp-provider",
        ok: false,
        blocking: false,
        detail: "SMTP delivery is intentionally not bundled. Add a provider and verify the sending domain inside Listmonk before live sends.",
      },
    ],
  });
}

export async function runListmonkInstallableServiceAction(action: InstallableServiceAction) {
  if (action === "status") return readListmonkInstallableServiceStatus();
  if (action !== "install" && action !== "start" && action !== "stop") {
    throw new Error("Listmonk supports install, start, stop, and status actions from HivemindOS.");
  }

  const docker = await dockerReadiness();
  if (!docker.daemon) throw new Error("Docker Compose and a running Docker daemon are required to install or run Listmonk.");

  if (action === "install") await ensureListmonkConfiguration();
  if (!existsSync(LISTMONK_COMPOSE_FILE) || !existsSync(LISTMONK_ENV_FILE)) {
    throw new Error("Install Listmonk before trying to start or stop it.");
  }

  const args = action === "stop" ? ["stop"] : ["up", "--detach", "--wait"];
  const result = await run("docker", composeArgs(args), action === "stop" ? 60_000 : 240_000);
  if (!result.ok) throw new Error(result.stderr || result.stdout || `Docker Compose could not ${action} Listmonk.`);
  return readListmonkInstallableServiceStatus();
}
