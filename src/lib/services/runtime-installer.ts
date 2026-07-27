import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "@/lib/home-dir";
import { runtimeCommandEnv } from "@/lib/services/runtime-command-env";
import { runtimeInstallSpec } from "@/lib/services/runtime-install-catalog";
import type { KnownAgentRuntime } from "@/lib/types/agent-runtime";

const execFileAsync = promisify(execFile);
const INSTALL_TIMEOUT_MS = 15 * 60_000;
const INSTALLER_DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_INSTALLER_BYTES = 4 * 1024 * 1024;
const OPENCLAW_PLUGIN_TRUST_MARKER = join(homedir(), ".hivemindos", "openclaw-codex-plugin-trust.json");

type ProcessResult = { stdout: string; stderr: string };

export function mergeOpenClawPluginAllowlist(value: unknown, pluginId = "codex") {
  const current = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim())
    : [];
  return Array.from(new Set([...current, pluginId]));
}

function installerUrl(value: string | undefined) {
  if (!value) throw new Error("This runtime does not provide an installer for this platform.");
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Runtime installers must use HTTPS.");
  return url.toString();
}

async function downloadInstallerScript(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(INSTALLER_DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Installer download failed with HTTP ${response.status}.`);
  const script = await response.text();
  if (!script.trim()) throw new Error("The downloaded runtime installer was empty.");
  if (Buffer.byteLength(script, "utf8") > MAX_INSTALLER_BYTES) throw new Error("The runtime installer was unexpectedly large.");
  return script;
}

function runProcess(command: string, args: string[], stdin = "", timeoutMs = INSTALL_TIMEOUT_MS): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: runtimeCommandEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out while installing the runtime.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n\n");
      reject(new Error(`${command} exited with code ${code}${detail ? `:\n${detail}` : ""}`));
    });
    child.stdin.end(stdin);
  });
}

function powershellEncoded(script: string) {
  return Buffer.from(script, "utf16le").toString("base64");
}

async function installScriptRuntime(
  url: string,
  unixArgs: string[],
  windowsArgs: string[],
) {
  if (process.platform === "win32") {
    const renderedArgs = windowsArgs.map((arg) => {
      if (!/^-[A-Za-z][A-Za-z0-9-]*$/.test(arg)) throw new Error("Invalid PowerShell installer argument.");
      return arg;
    }).join(" ");
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `$installer = (Invoke-WebRequest -UseBasicParsing '${url.replaceAll("'", "''")}').Content`,
      `& ([ScriptBlock]::Create($installer))${renderedArgs ? ` ${renderedArgs}` : ""}`,
    ].join("\n");
    return execFileAsync("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      powershellEncoded(command),
    ], { timeout: INSTALL_TIMEOUT_MS, maxBuffer: 2_000_000, env: runtimeCommandEnv(), windowsHide: true });
  }
  const script = await downloadInstallerScript(url);
  return runProcess("bash", ["-s", "--", ...unixArgs], script);
}

async function configureOpenClawCodexPluginTrust() {
  const env = runtimeCommandEnv();
  const inspect = await execFileAsync("openclaw", ["plugins", "inspect", "codex", "--json"], {
    timeout: 15_000,
    maxBuffer: 300_000,
    env,
    windowsHide: true,
  }).catch(() => null);
  if (!inspect) return "";
  const current = await execFileAsync("openclaw", ["config", "get", "plugins.allow", "--json"], {
    timeout: 15_000,
    maxBuffer: 100_000,
    env,
    windowsHide: true,
  }).catch(() => ({ stdout: "[]", stderr: "" }));
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(current.stdout || "[]");
  } catch {
    parsed = [];
  }
  const allow = mergeOpenClawPluginAllowlist(parsed);
  if (Array.isArray(parsed) && parsed.length === allow.length && allow.every((entry, index) => parsed[index] === entry)) return "";
  await execFileAsync("openclaw", ["config", "set", "plugins.allow", JSON.stringify(allow), "--strict-json"], {
    timeout: 20_000,
    maxBuffer: 300_000,
    env,
    windowsHide: true,
  });
  await mkdir(join(homedir(), ".hivemindos"), { recursive: true, mode: 0o700 });
  await writeFile(OPENCLAW_PLUGIN_TRUST_MARKER, `${JSON.stringify({ pluginId: "codex", managedBy: "hivemindos" }, null, 2)}\n`, { mode: 0o600 });
  return "OpenClaw Codex plugin explicitly trusted.";
}

export async function installRuntimeBinary(runtime: KnownAgentRuntime) {
  const spec = runtimeInstallSpec(runtime);
  if (!spec?.inAppInstall) return { ok: false, error: `${spec?.label ?? runtime} can't be installed from here yet.` };
  if (spec.unsupportedPlatforms?.includes(process.platform as "windows" | "darwin" | "linux")) {
    return { ok: false, error: `${spec.label} can't be installed automatically on this platform yet.` };
  }
  try {
    let result: ProcessResult | Awaited<ReturnType<typeof execFileAsync>>;
    if (spec.installKind === "npm" && spec.npmPackage) {
      const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
      result = await execFileAsync(npmBin, ["install", "-g", spec.npmPackage], {
        timeout: INSTALL_TIMEOUT_MS,
        maxBuffer: 2_000_000,
        env: runtimeCommandEnv(),
        windowsHide: true,
      });
    } else if (spec.installKind === "uv" && spec.uvPackage) {
      const uv = await execFileAsync("uv", ["--version"], { timeout: 5_000, maxBuffer: 100_000, env: runtimeCommandEnv(), windowsHide: true }).catch(() => null);
      if (!uv) return { ok: false, error: `${spec.label} needs the uv package manager. Install uv from astral.sh/uv, then retry.` };
      result = await execFileAsync("uv", ["tool", "install", spec.uvPackage, ...(spec.uvPythonPin ? ["--python", spec.uvPythonPin] : [])], {
        timeout: INSTALL_TIMEOUT_MS,
        maxBuffer: 2_000_000,
        env: runtimeCommandEnv(),
        windowsHide: true,
      });
    } else if (spec.installKind === "curl") {
      const url = installerUrl(process.platform === "win32" ? spec.powershellInstallUrl : spec.curlInstallUrl);
      result = await installScriptRuntime(url, spec.curlInstallArgs ?? [], spec.powershellInstallArgs ?? []);
    } else {
      return { ok: false, error: `${spec.label} can't be installed automatically here yet.` };
    }
    const postInstall = runtime === "openclaw"
      ? await configureOpenClawCodexPluginTrust().catch(() => "")
      : "";
    return {
      ok: true,
      message: `${spec.label} installed.`,
      output: [`${result.stdout}${result.stderr}`.trim(), postInstall].filter(Boolean).join("\n").slice(-2_000),
    };
  } catch (error: unknown) {
    const maybe = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, error: (maybe.stderr || maybe.stdout || maybe.message || `${spec.label} install failed.`).slice(-1_500) };
  }
}
