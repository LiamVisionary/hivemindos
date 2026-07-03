#!/usr/bin/env node
/**
 * Virtuals ACP × HivemindOS — seller/provider scaffold (SPIKE).
 *
 * Proves the proposal in docs/proposals/virtuals-acp-integration.md:
 * a long-lived ACP provider process that runs ON your Hive box, listens for
 * funded jobs from the Virtuals marketplace, runs the actual work through Hive's
 * existing /api/chat/agent-runtime endpoint, and returns the result as the
 * ACP deliverable. Virtuals coordinates discovery + escrow; Hive is the brain.
 *
 * This is a disposable spike scaffold, NOT production code:
 *   - It is a standalone script (not imported by the Next app), so it does not
 *     affect tsc/build, and `@virtuals-protocol/acp-node-v2` need not be a repo dep yet.
 *   - SDK fields marked `// CONFIRM` are taken from the acp-node-v2 README and
 *     must be verified against the installed SDK once provisioned.
 *
 * SETUP (see docs/proposals/virtuals-acp-integration.md for the full runbook):
 *   pnpm add -D @virtuals-protocol/acp-node-v2 viem
 *   acp configure && acp agent create && acp agent add-signer \
 *     && acp agent register-erc8004 --chain-id 84532 && acp offering create
 *   hive-env-add SELLER_WALLET_ADDRESS / SELLER_WALLET_ID / SELLER_SIGNER_PRIVATE_KEY
 *
 * RUN (with the Hive dev server up, secrets from shared hive env):
 *   hive-env-run -- node scripts/virtuals-acp-seller.mjs
 *
 * Secrets are read from the environment only and never logged or persisted.
 */

// Known gotcha on this network: Node's 250ms happy-eyeballs per-attempt connect
// timeout is shorter than the TCP handshake to many hosts (e.g. Base RPC via
// Cloudflare), so outbound fetch/undici silently fails with ETIMEDOUT. Raise it.
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
setDefaultAutoSelectFamilyAttemptTimeout(2500);

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Config (all from env / shared hive env; nothing secret is hardcoded)
// ---------------------------------------------------------------------------
const HIVE_AGENT_RUNTIME_URL =
  process.env.HIVE_AGENT_RUNTIME_URL || "http://localhost:3000/api/chat/agent-runtime";
// The dashboard's /api routes 401 tokenless since the auth gate moved to
// src/proxy.ts. Env-only on purpose (run via hive-env-run), matching this
// script's secrets policy.
const HIVE_DASHBOARD_DEVICE_TOKEN = (process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN || "").trim();
const HIVE_AGENT_PROFILE_JSON = process.env.HIVE_AGENT_PROFILE_JSON || "";
const ACP_CHAIN = (process.env.ACP_CHAIN || "base-sepolia").toLowerCase();

const SELLER_WALLET_ADDRESS = process.env.SELLER_WALLET_ADDRESS || "";
const SELLER_WALLET_ID = process.env.SELLER_WALLET_ID || "";
const SELLER_SIGNER_PRIVATE_KEY = process.env.SELLER_SIGNER_PRIVATE_KEY || "";

function requireEnv() {
  const missing = [
    ["SELLER_WALLET_ADDRESS", SELLER_WALLET_ADDRESS],
    ["SELLER_WALLET_ID", SELLER_WALLET_ID],
    ["SELLER_SIGNER_PRIVATE_KEY", SELLER_SIGNER_PRIVATE_KEY],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(
      `Missing required env: ${missing.join(", ")}.\n` +
        `Provision with acp-cli, store in shared hive env, and run via:\n` +
        `  hive-env-run -- node scripts/virtuals-acp-seller.mjs`
    );
    process.exit(1);
  }
}

// Load the AgentProfile to send to Hive's runtime. Export one from the dashboard
// and point HIVE_AGENT_PROFILE_JSON at it. Minimal fallback is for smoke-testing only.
function loadAgentProfile() {
  if (HIVE_AGENT_PROFILE_JSON) {
    try {
      return JSON.parse(readFileSync(HIVE_AGENT_PROFILE_JSON, "utf8"));
    } catch (err) {
      console.error(`Could not read HIVE_AGENT_PROFILE_JSON (${HIVE_AGENT_PROFILE_JSON}): ${err.message}`);
      process.exit(1);
    }
  }
  console.warn(
    "HIVE_AGENT_PROFILE_JSON not set — using a minimal placeholder profile. " +
      "Export a real agent profile from the dashboard for a meaningful run."
  );
  return { name: "Hive ACP Provider", runtime: "hivemind-os" };
}

// ---------------------------------------------------------------------------
// The brain: run a buyer's request through Hive's agent-runtime and collect text.
// Hive streams OpenAI-shaped SSE (choices[].delta.content, terminated by [DONE]).
// ---------------------------------------------------------------------------
async function runOnHive(profile, requirementText) {
  const res = await fetch(HIVE_AGENT_RUNTIME_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(HIVE_DASHBOARD_DEVICE_TOKEN ? { "x-hivemindos-device-token": HIVE_DASHBOARD_DEVICE_TOKEN } : {}),
    },
    body: JSON.stringify({
      agent: profile,
      messages: [{ role: "user", content: requirementText }],
      agentMode: "chat",
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Hive runtime returned ${res.status} ${res.statusText}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return out;
      try {
        const json = JSON.parse(payload);
        out += json?.choices?.[0]?.delta?.content ?? "";
      } catch {
        // partial/non-JSON keepalive line; ignore
      }
    }
  }
  return out;
}

// Best-effort extraction of the buyer's ask from an ACP job session/entry.
// CONFIRM the real field path against the installed acp-node-v2 SDK.
function extractRequirement(session, entry) {
  return (
    session?.job?.requirement ??
    session?.job?.serviceRequirement ??
    entry?.event?.requirement ??
    entry?.content ??
    "Summarize your available capabilities and complete the requested task."
  );
}

// ---------------------------------------------------------------------------
// Main: stand up the ACP seller and bind job.funded → Hive → session.submit.
// ---------------------------------------------------------------------------
async function main() {
  requireEnv();
  const profile = loadAgentProfile();

  // Imported lazily so the script can print a friendly message if deps aren't installed yet.
  let AcpAgent, PrivyAlchemyEvmProviderAdapter, base, baseSepolia;
  try {
    ({ AcpAgent, PrivyAlchemyEvmProviderAdapter } = await import("@virtuals-protocol/acp-node-v2"));
    ({ base, baseSepolia } = await import("viem/chains"));
  } catch {
    console.error(
      "Dependencies not installed. Run:\n  pnpm add -D @virtuals-protocol/acp-node-v2 viem"
    );
    process.exit(1);
  }

  const chain = ACP_CHAIN === "base" ? base : baseSepolia;

  const seller = await AcpAgent.create({
    provider: await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: SELLER_WALLET_ADDRESS,
      walletId: SELLER_WALLET_ID,
      signerPrivateKey: SELLER_SIGNER_PRIVATE_KEY,
      chains: [chain],
    }),
  });

  seller.on("entry", async (session, entry) => {
    // CONFIRM event shape against the SDK; README shows entry.kind === "system"
    // with entry.event.type in {job.created, job.funded, job.completed, ...}.
    if (entry?.kind !== "system") return;
    const type = entry?.event?.type;
    if (type !== "job.funded") {
      console.log(`[acp] ${type ?? "event"} (ignored)`);
      return;
    }

    console.log("[acp] job.funded — running on Hive…");
    try {
      const requirement = extractRequirement(session, entry);
      const deliverable = await runOnHive(profile, String(requirement));
      // For the spike we submit the text directly. If the Evaluator requires a
      // hosted URL, host the result and submit the URL instead.
      await session.submit(deliverable || "(empty result)");
      console.log("[acp] deliverable submitted ✓");
    } catch (err) {
      console.error(`[acp] job failed: ${err.message}`);
    }
  });

  await seller.start();
  console.log(
    `ACP seller online (chain=${chain?.name ?? ACP_CHAIN}). ` +
      `Brain → ${HIVE_AGENT_RUNTIME_URL}. Waiting for funded jobs…`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
