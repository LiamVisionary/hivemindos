#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const X_MCP_URL = "https://api.x.com/mcp";
const XURL_PACKAGE = "@xdevplatform/xurl";
const X_CLIENT_ID_ENV = "X_MCP_CLIENT_ID";
const X_CLIENT_SECRET_ENV = "X_MCP_CLIENT_SECRET";
const X_REDIRECT_URI_ENV = "X_MCP_REDIRECT_URI";

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SELF_DIR, "..");
const HIVE_ENV_FILE = process.env.HIVE_ENV_FILE?.trim()
  ? expandHome(process.env.HIVE_ENV_FILE.trim())
  : path.join(os.homedir(), ".hivemindos", ".env");

const command = process.argv[2] || "mcp";
const rest = process.argv.slice(3);

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function parseRawEnvValue(rawValue = "") {
  const value = rawValue.trim();
  if (!value) return "";
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replaceAll("\0", "").trim();
  }
  return value.replace(/\s+#.*$/, "").replaceAll("\0", "").trim();
}

function readHiveEnv() {
  const raw = fs.existsSync(HIVE_ENV_FILE) ? fs.readFileSync(HIVE_ENV_FILE, "utf8") : "";
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = parseRawEnvValue(match[2]);
  }
  return values;
}

function xurlEnv() {
  const hive = readHiveEnv();
  const clientId = process.env.CLIENT_ID || process.env[X_CLIENT_ID_ENV] || hive[X_CLIENT_ID_ENV];
  const clientSecret = process.env.CLIENT_SECRET || process.env[X_CLIENT_SECRET_ENV] || hive[X_CLIENT_SECRET_ENV];
  const redirectUri = process.env.REDIRECT_URI || process.env[X_REDIRECT_URI_ENV] || hive[X_REDIRECT_URI_ENV];
  const env = {
    ...process.env,
    HIVE_ENV_PROJECT_ROOT: process.env.HIVE_ENV_PROJECT_ROOT || ROOT,
    CLIENT_ID: clientId || "",
    CLIENT_SECRET: clientSecret || "",
  };
  if (redirectUri) env.REDIRECT_URI = redirectUri;
  return env;
}

function ensureCredentials(env) {
  if (env.CLIENT_ID && env.CLIENT_SECRET) return true;
  process.stderr.write(
    `[hivemindos x-mcp] Missing ${X_CLIENT_ID_ENV} or ${X_CLIENT_SECRET_ENV}. Save them in HivemindOS shared env before starting X MCP.\n`,
  );
  return false;
}

function runXurl(args, options = {}) {
  const child = spawn("npx", ["-y", XURL_PACKAGE, ...args], {
    cwd: ROOT,
    env: xurlEnv(),
    stdio: options.stdio || "inherit",
  });
  child.on("error", (error) => {
    process.stderr.write(`[hivemindos x-mcp] Could not start xurl via npx: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on("close", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

if (command === "auth") {
  const env = xurlEnv();
  if (!ensureCredentials(env)) process.exit(1);
  runXurl(["auth", "oauth2", ...rest]);
} else if (command === "mcp") {
  const env = xurlEnv();
  if (!ensureCredentials(env)) process.exit(1);
  runXurl(["mcp", X_MCP_URL, ...rest]);
} else {
  process.stderr.write("Usage: x-mcp-bridge.mjs [mcp|auth] [xurl args...]\n");
  process.exit(2);
}
