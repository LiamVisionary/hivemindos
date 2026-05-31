#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("-")) ?? "help";
const envFile = resolve(root, valueAfter("--env-file") ?? ".env.local");

const AUTH_SECRET = "HIVEMINDOS_DASHBOARD_AUTH_SECRET";
const DEVICE_TOKEN = "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN";

switch (command) {
  case "copy-token":
    copyExistingToken();
    break;
  case "reset-token":
    resetToken();
    break;
  case "rotate-secret":
    rotateSecret();
    break;
  case "status":
    printStatus();
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    console.error(`Unknown dashboard auth command: ${command}`);
    printHelp();
    process.exit(2);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  return inline?.slice(flag.length + 1);
}

function readEnvFile() {
  return existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
}

function writeEnvFile(text) {
  writeFileSync(envFile, text, { mode: 0o600 });
}

function readKey(key) {
  const line = readEnvFile().split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim() ?? "";
}

function setKey(key, value) {
  const lines = readEnvFile().split(/\r?\n/);
  let replaced = false;
  const next = lines
    .filter((line, index) => line || index < lines.length - 1)
    .map((line) => {
      if (!line.startsWith(`${key}=`)) return line;
      replaced = true;
      return `${key}=${value}`;
    });
  if (!replaced) next.push(`${key}=${value}`);
  writeEnvFile(`${next.join("\n")}\n`);
}

function secret() {
  return randomBytes(32).toString("hex");
}

function copyExistingToken() {
  const token = readKey(DEVICE_TOKEN);
  if (!token) {
    console.error(`${DEVICE_TOKEN} is missing from ${envFile}. Run: pnpm dashboard-auth reset-token`);
    process.exit(1);
  }
  copyTokenOrExit(token);
  console.log("Copied dashboard unlock token to clipboard.");
}

function resetToken() {
  const token = secret();
  setKey(DEVICE_TOKEN, token);
  console.log(`Reset ${DEVICE_TOKEN} in ${envFile}.`);
  if (copyToken(token)) console.log("Copied new dashboard unlock token to clipboard.");
  else printCopyFallback();
  console.log("Restart the dashboard server so it loads the new token.");
}

function rotateSecret() {
  setKey(AUTH_SECRET, secret());
  console.log(`Rotated ${AUTH_SECRET} in ${envFile}.`);
  console.log("Existing dashboard sessions are invalid after the dashboard server restarts.");
}

function printStatus() {
  const authSecret = readKey(AUTH_SECRET);
  const deviceToken = readKey(DEVICE_TOKEN);
  console.log(`${AUTH_SECRET}: ${authSecret.length >= 32 ? "present" : "missing or too short"}`);
  console.log(`${DEVICE_TOKEN}: ${deviceToken.length >= 24 ? "present" : "missing or too short"}`);
  console.log(`Env file: ${envFile}`);
}

function copyTokenOrExit(token) {
  if (copyToken(token)) return;
  printCopyFallback();
  process.exit(1);
}

function copyToken(token) {
  const commands = process.platform === "darwin"
    ? [["pbcopy"]]
    : process.platform === "win32"
      ? [["powershell.exe", "-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"], ["clip.exe"]]
      : [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];

  for (const commandParts of commands) {
    const result = spawnSync(commandParts[0], commandParts.slice(1), {
      input: token,
      stdio: ["pipe", "ignore", "ignore"],
    });
    if (result.status === 0) return true;
  }
  return false;
}

function printCopyFallback() {
  console.error("No clipboard command was available.");
  console.error("To inspect or copy the token manually, open .env.local and read HIVEMINDOS_DASHBOARD_DEVICE_TOKEN.");
}

function printHelp() {
  console.log(`Dashboard auth helper

Usage:
  pnpm dashboard-auth status
  pnpm dashboard-auth copy-token
  pnpm dashboard-auth reset-token
  pnpm dashboard-auth rotate-secret

Commands:
  status         Check whether dashboard auth keys exist.
  copy-token     Copy the current unlock token to the clipboard.
  reset-token    Generate a new unlock token and copy it when possible.
  rotate-secret  Generate a new session-signing secret. Restart invalidates sessions.

Options:
  --env-file <path>  Use another env file, mainly for tests.
`);
}
