import { existsSync, readFileSync } from "node:fs";
import { homedir } from "@/lib/home-dir";
import { join } from "node:path";

export const HOUND_VERSION = "11.1.6";
export const HOUND_PACKAGE = `hound-mcp[all]==${HOUND_VERSION}`;

export function webResearchPaths() {
  const integrationRoot = join(homedir(), ".hivemindos", "integrations", "web-research");
  const binaryDir = join(integrationRoot, "venv", process.platform === "win32" ? "Scripts" : "bin");
  return {
    integrationRoot,
    dataDir: join(integrationRoot, "data"),
    browserDir: join(integrationRoot, "playwright"),
    python: join(binaryDir, process.platform === "win32" ? "python.exe" : "python"),
    stateFile: join(homedir(), ".hivemindos", "integrations", "web-research-state.json"),
    wrapper: join(process.cwd(), "scripts", "web-research", "hound_server.py"),
    screenshotDir: join(homedir(), ".hivemindos", "web-research", "screenshots"),
  };
}

export function webResearchInstallState() {
  try {
    return JSON.parse(readFileSync(webResearchPaths().stateFile, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function webResearchInstalled() {
  const paths = webResearchPaths();
  const state = webResearchInstallState();
  return existsSync(paths.python)
    && existsSync(paths.wrapper)
    && state.status === "installed"
    && state.version === HOUND_VERSION;
}
