#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const API_PATH = "/api/crypto/b20/issuer-proof";
const DEVICE_TOKEN_HEADER = "x-hivemindos-device-token";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") return help();
  const flags = parseFlags(args);
  const baseUrl = flags["base-url"] || process.env.HIVEMINDOS_API_BASE_URL || "http://127.0.0.1:5020";

  if (command === "status") {
    const data = await request(baseUrl, "GET");
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (command === "draft") {
    const message = flags.message || "";
    const agentId = flags["agent-id"] || "";
    if (!agentId) throw new Error("--agent-id is required.");
    if (!message) throw new Error("--message is required.");
    const data = await request(baseUrl, "POST", {
      action: "draft",
      agentId,
      messages: [{ role: "user", content: message }],
    });
    console.log(data.message || JSON.stringify(data, null, 2));
    return;
  }

  if (command === "create") {
    const confirm = flags.confirm || "";
    if (confirm !== "B20_CREATE") throw new Error("--confirm B20_CREATE is required.");
    const file = flags["draft-message-file"];
    if (!file) throw new Error("--draft-message-file is required.");
    const draftMessage = await readFile(file, "utf8");
    const data = await request(baseUrl, "POST", {
      action: "create",
      draftMessage,
      confirmation: "B20_CREATE",
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function help() {
  console.log(`B20 issuer proof helper

Usage:
  node scripts/b20-issuer-proof.mjs status [--base-url URL]
  node scripts/b20-issuer-proof.mjs draft --agent-id ID --message "name Test, symbol TEST, initial supply 1000" [--base-url URL]
  node scripts/b20-issuer-proof.mjs create --draft-message-file proof.txt --confirm B20_CREATE [--base-url URL]

Environment:
  HIVEMINDOS_DASHBOARD_DEVICE_TOKEN is used for authenticated local API calls.
  HIVEMINDOS_API_BASE_URL may provide the default base URL.
`);
}

async function request(baseUrl, method, body) {
  const token = process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN || process.env.HIVEMINDOS_NATIVE_BOOTSTRAP_TOKEN || "";
  const response = await fetch(new URL(API_PATH, baseUrl), {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { [DEVICE_TOKEN_HEADER]: token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: text };
  }
  if (!response.ok) {
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }
  return data;
}

function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = "true";
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}
