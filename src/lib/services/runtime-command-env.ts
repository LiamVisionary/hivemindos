import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { homedir } from "@/lib/home-dir";

const POSIX_RUNTIME_COMMAND_PATHS = [
  join(homedir(), ".local", "bin"),
  join(homedir(), ".npm-global", "bin"),
  join(homedir(), ".nvm", "versions", "node", process.version, "bin"),
  dirname(process.execPath),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

const WINDOWS_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"];

export function runtimeCommandPaths(basePath = process.env.PATH || "") {
  const existingPaths = basePath.split(delimiter).filter(Boolean);
  const fallbackPaths = process.platform === "win32" ? [dirname(process.execPath)] : POSIX_RUNTIME_COMMAND_PATHS;
  return Array.from(new Set([...fallbackPaths, ...existingPaths]));
}

export function runtimeCommandPath(basePath = process.env.PATH || "") {
  return runtimeCommandPaths(basePath).join(delimiter);
}

export function runtimeCommandEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...baseEnv, PATH: runtimeCommandPath(baseEnv.PATH || "") };
}

export function runtimeCommandExists(command: string) {
  if (/[\\/]/.test(command)) return existsSync(command);
  const candidateNames = runtimeCommandCandidateNames(command);
  return runtimeCommandPaths().some((directory) => (
    candidateNames.some((candidate) => existsSync(join(directory, candidate)))
  ));
}

function runtimeCommandCandidateNames(command: string) {
  if (process.platform !== "win32" || /\.[^\\/]+$/.test(command)) return [command];
  const extensions = (process.env.PATHEXT || WINDOWS_PATHEXT.join(delimiter))
    .split(delimiter)
    .map((extension) => extension.trim())
    .filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension}`)];
}
