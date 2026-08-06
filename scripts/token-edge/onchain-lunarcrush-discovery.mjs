#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendLedgerEvent,
  digestValue,
  eventWithIntegrity,
  readLedger,
  verifyLedger,
} from "./onchain-forward-core.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";
import { collectSolanaLunarCrushDiscovery } from "./onchain-lunarcrush-provider.mjs";

export async function collectTokenEdgeLunarDiscovery(options = {}, dependencies = {}) {
  const now = dependencies.now ?? new Date();
  const fetcher = dependencies.fetcher ?? fetch;
  const clock = dependencies.clock ?? (() => new Date());
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const bucketStart = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  const existing = events.find((event) => {
    const attemptedAt = Date.parse(event.availableAt ?? event.observedAt ?? "");
    return ["discovery", "lunarcrush-discovery-attempt", "lunarcrush-social-snapshot"]
      .includes(event.type)
      && (event.provider === "lunarcrush-coin-list" || event.provider === "lunarcrush")
      && attemptedAt >= bucketStart
      && attemptedAt < bucketStart + 3_600_000;
  });
  if (existing) {
    return {
      ledgerPath,
      status: "skipped-existing-hour",
      requestsAttempted: 0,
      discoveryEventId: existing.type === "discovery" ? existing.id : null,
      observedAt: existing.observedAt,
      candidates: existing.candidates?.length ?? 0,
      monitoringCandidates: existing.monitoringPanel?.candidates?.length ?? 0,
    };
  }
  const collected = await collectSolanaLunarCrushDiscovery({
    apiKey: options.lunarcrushApiKey,
    chain: "solana",
    observedAt: now,
    maxRequests: options.maxRequests ?? 10,
  }, { fetcher, clock });
  if (!collected.discovery) {
    const attempt = await appendLedgerEvent(ledgerPath, {
      type: "lunarcrush-discovery-attempt",
      id: `lunarcrush_discovery_attempt_${digestValue({
        bucketStart,
        availableAt: collected.availableAt,
        universe: collected.universe,
      }).slice(0, 24)}`,
      observedAt: collected.availableAt,
      availableAt: collected.availableAt,
      provider: "lunarcrush",
      profile: "solana-social-discovery",
      status: "blocked",
      requestBudget: collected.requestBudget,
      universe: collected.universe,
      researchOnly: true,
      mutationAllowed: false,
    });
    return {
      ledgerPath,
      status: "blocked",
      requestsAttempted: collected.requestBudget.attempted,
      universe: collected.universe,
      discoveryEventId: null,
      attemptEventId: attempt.id,
      candidates: 0,
      monitoringCandidates: 0,
    };
  }
  const proposed = eventWithIntegrity(collected.discovery);
  const collision = events.find((event) => event.id === proposed.id);
  if (collision && collision.digest !== proposed.digest) {
    throw new Error(`Existing LunarCrush discovery identity mismatch: ${proposed.id}`);
  }
  const signed = collision ?? await appendLedgerEvent(ledgerPath, collected.discovery);
  const evidenceEvents = [];
  for (const event of [...collected.events, ...(collected.creatorEvents ?? [])]) {
    const proposedEvidence = eventWithIntegrity(event);
    const existingEvidence = events.find((row) => row.id === proposedEvidence.id);
    if (existingEvidence && existingEvidence.digest !== proposedEvidence.digest) {
      throw new Error(`Existing LunarCrush evidence identity mismatch: ${proposedEvidence.id}`);
    }
    evidenceEvents.push(existingEvidence ?? await appendLedgerEvent(ledgerPath, event));
  }
  return {
    ledgerPath,
    status: collision ? "duplicate" : "recorded",
    requestsAttempted: collected.requestBudget.attempted,
    requestsSucceeded: collected.requestBudget.succeeded,
    universe: collected.universe,
    discoveryEventId: signed.id,
    observedAt: signed.observedAt,
    candidates: signed.candidates.length,
    monitoringCandidates: signed.monitoringPanel?.candidates?.length ?? 0,
    readyFollowupHistories: evidenceEvents.filter((event) => (
      event.type === "lunarcrush-social-snapshot" && event.status === "ready"
    )).length,
    blockedFollowupHistories: evidenceEvents.filter((event) => (
      event.type === "lunarcrush-social-snapshot" && event.status === "blocked"
    )).length,
    readyCreatorAggregates: evidenceEvents.filter((event) => (
      event.type === "lunarcrush-creator-aggregate" && event.status === "ready"
    )).length,
    blockedCreatorAggregates: evidenceEvents.filter((event) => (
      event.type === "lunarcrush-creator-aggregate" && event.status === "blocked"
    )).length,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--ledger" && value) options.ledgerPath = value;
    if (key === "--max-lunarcrush-requests" && value) options.maxRequests = Number(value);
    if (key.startsWith("--")) index += 1;
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  collectTokenEdgeLunarDiscovery({
    ...parseArgs(process.argv.slice(2)),
    lunarcrushApiKey: process.env.LUNARCRUSH_API_KEY,
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
