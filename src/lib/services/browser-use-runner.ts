import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { homedir } from "@/lib/home-dir";
import { readBrowserUsePermissions } from "@/lib/services/browser-use-permissions";

const execFileAsync = promisify(execFile);
const RUN_ROOT = join(homedir(), ".hivemindos", "runtime-runs", "browser-use");

export type BrowserUseAction =
  | "doctor"
  | "open"
  | "state"
  | "click"
  | "input"
  | "type"
  | "upload"
  | "screenshot"
  | "eval"
  | "cloud-task"
  | "close";

type BrowserUseInput = {
  action?: BrowserUseAction | string;
  url?: string;
  index?: number;
  text?: string;
  path?: string;
  script?: string;
  task?: string;
  profile?: string;
  cdpUrl?: string;
  session?: string;
  headed?: boolean;
};

const FULL_PERMISSION_ACTIONS = new Set([
  "cloud-task",
  "eval",
  "upload",
]);

const ALWAYS_BLOCKED_ACTIONS = new Set([
  "cloud",
  "connect",
  "cookies",
  "extract",
  "install",
  "profile",
  "python",
  "record",
  "setup",
  "tunnel",
]);

const LOCAL_ACTIONS = new Set<BrowserUseAction>([
  "doctor",
  "open",
  "state",
  "click",
  "input",
  "type",
  "upload",
  "screenshot",
  "eval",
  "cloud-task",
  "close",
]);

function browserUseCommand() {
  const explicit = process.env.BROWSER_USE_BIN?.trim();
  if (explicit) return explicit;
  for (const candidate of [
    join(homedir(), ".local", "bin", "browser-use"),
    "/opt/homebrew/bin/browser-use",
    "/usr/local/bin/browser-use",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "browser-use";
}

function baseArgs(input: BrowserUseInput) {
  const args: string[] = [];
  if (input.headed) args.push("--headed");
  if (input.profile?.trim()) args.push("--profile", input.profile.trim());
  if (input.cdpUrl?.trim()) args.push("--cdp-url", input.cdpUrl.trim());
  if (input.session?.trim()) args.push("--session", input.session.trim());
  return args;
}

function browserUseEnv() {
  return {
    ANONYMIZED_TELEMETRY: "False",
    BROWSER_USE_ANONYMIZED_TELEMETRY: "False",
  };
}

function safeOpenUrl(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) throw new Error("url is required for Browser Use open.");
  if (raw === "about:blank") return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Browser Use open requires an absolute http(s) URL or about:blank.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Browser Use open only allows http(s) URLs and about:blank from HivemindOS.");
  }
  return url.toString();
}

function safeScreenshotPath(value: string | undefined) {
  const fallback = `screenshot-${Date.now().toString(36)}.png`;
  const filename = value?.trim()
    ? value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g, "-") || fallback
    : fallback;
  return join(RUN_ROOT, filename.endsWith(".png") ? filename : `${filename}.png`);
}

function buildArgs(input: BrowserUseInput, fullAccess: boolean) {
  const action = input.action || "state";
  const hasFullPermissionOption = Boolean(input.profile?.trim() || input.cdpUrl?.trim());
  if (ALWAYS_BLOCKED_ACTIONS.has(action)) {
    throw new Error(`Browser Use action "${action}" is managed outside the HivemindOS runtime bridge.`);
  }
  if ((FULL_PERMISSION_ACTIONS.has(action) || hasFullPermissionOption) && !fullAccess) {
    throw new Error(`Browser Use action "${action}" requires Full permissions on the Browser Use provider card.`);
  }
  if (!LOCAL_ACTIONS.has(action as BrowserUseAction)) {
    throw new Error(`Unsupported Browser Use action: ${action}`);
  }
  const args = baseArgs(input);
  if (action === "doctor") return ["doctor"];
  if (action === "state") return [...args, "state"];
  if (action === "close") return [...args, "close", "--all"];
  if (action === "open") {
    return [...args, "open", safeOpenUrl(input.url)];
  }
  if (action === "click") {
    if (!Number.isInteger(input.index)) throw new Error("index is required for Browser Use click.");
    return [...args, "click", String(input.index)];
  }
  if (action === "input") {
    if (!Number.isInteger(input.index) || !input.text) throw new Error("index and text are required for Browser Use input.");
    return [...args, "input", String(input.index), input.text];
  }
  if (action === "type") {
    if (!input.text) throw new Error("text is required for Browser Use type.");
    return [...args, "type", input.text];
  }
  if (action === "upload") {
    if (!Number.isInteger(input.index) || !input.path?.trim()) throw new Error("index and path are required for Browser Use upload.");
    return [...args, "upload", String(input.index), input.path.trim()];
  }
  if (action === "screenshot") {
    return [...args, "screenshot", safeScreenshotPath(input.path)];
  }
  if (action === "eval") {
    if (!input.script?.trim()) throw new Error("script is required for Browser Use eval.");
    return [...args, "eval", input.script.trim()];
  }
  if (action === "cloud-task") {
    if (!input.task?.trim()) throw new Error("task is required for Browser Use cloud-task.");
    const payload = input.url?.trim()
      ? { task: input.task.trim(), url: safeOpenUrl(input.url) }
      : { task: input.task.trim() };
    return ["cloud", "v2", "POST", "/tasks", JSON.stringify(payload)];
  }
  throw new Error(`Unsupported Browser Use action: ${action}`);
}

export async function runBrowserUse(input: BrowserUseInput) {
  const permissions = await readBrowserUsePermissions();
  const args = buildArgs(input, permissions.fullAccess);
  await mkdir(RUN_ROOT, { recursive: true });
  const id = `browser-use-${Date.now().toString(36)}`;
  const logPath = join(RUN_ROOT, `${id}.log`);
  const startedAt = new Date().toISOString();
  const command = browserUseCommand();
  const result = await execFileAsync(command, args, {
    timeout: 60_000,
    encoding: "utf8",
    maxBuffer: 1_000_000,
    env: { ...process.env, ...browserUseEnv() },
  }).then(
    ({ stdout, stderr }) => ({ ok: true, stdout, stderr }),
    (error: unknown) => {
      const maybe = error as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, stdout: maybe.stdout ?? "", stderr: maybe.stderr ?? maybe.message ?? "" };
    },
  );
  const finishedAt = new Date().toISOString();
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, [
    `$ ${command} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`,
    result.stdout,
    result.stderr,
  ].filter(Boolean).join("\n"), { mode: 0o600 });
  if (!result.ok) throw new Error(result.stderr || result.stdout || "Browser Use command failed.");
  return {
    ok: true,
    id,
    action: input.action || "state",
    args,
    stdout: result.stdout,
    stderr: result.stderr,
    logPath,
    startedAt,
    finishedAt,
  };
}
