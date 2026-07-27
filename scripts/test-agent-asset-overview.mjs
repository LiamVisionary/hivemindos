#!/usr/bin/env node
// Chat-route agent asset overview: the shared fund-agent client's guard chain
// (unit-tested with a stubbed fetch) plus the popover/modal wiring that keeps
// the chat surface on the same rails as the Wallets route.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  executeAgentFunding,
  isStableSendAsset,
  resolvePersonalWalletAgentIdForAsset,
  stableSendAssetForNetwork,
} = await import("../src/lib/services/wallet/fund-agent-client.ts");

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

// --- Asset/network resolution -------------------------------------------------

assert.equal(stableSendAssetForNetwork("eip155:8453"), "USDC");
assert.equal(stableSendAssetForNetwork("eip155:4663"), "USDG");
assert.equal(stableSendAssetForNetwork(""), "USDC");
assert.equal(isStableSendAsset("USDC"), true);
assert.equal(isStableSendAsset("USDG"), true);
assert.equal(isStableSendAsset("ETH"), false);

// --- Source account resolution -------------------------------------------------

const personalWallets = [
  { id: "user:seed:eip155-8453", custodyMode: "local", network: "eip155:8453", address: "0xAAA", tokens: [{ symbol: "USDC", balance: 25 }] },
  { id: "user:seed:solana-mainnet", custodyMode: "local", network: "solana:mainnet", address: "SoL1", tokens: [] },
  { id: "user:watch", custodyMode: "watch", network: "eip155:8453", address: "0xBBB", tokens: [{ symbol: "USDC", balance: 90 }] },
];
const source = {
  id: "user:seed",
  spendId: "user:seed:eip155-8453",
  canSpend: true,
  accounts: [{ id: "user:seed:eip155-8453" }, { id: "user:seed:solana-mainnet" }],
  addresses: [["Base", "0xAAA"], ["Solana", "SoL1"]],
};

assert.equal(
  resolvePersonalWalletAgentIdForAsset(source, "USDC", personalWallets),
  "user:seed:eip155-8453",
  "the funded local per-chain account id must be resolved for execution (never the watch record)",
);

// --- Guard chain ----------------------------------------------------------------

const recipientWallet = { walletAddress: "0xRECIPIENT", network: "eip155:8453" };

await assert.rejects(
  () => executeAgentFunding({ source, recipientAgentId: "agent-1", recipientWallet, asset: "ETH", amountUsd: 5, personalWallets }),
  /USDC or USDG/,
  "non-stable assets must be rejected",
);
await assert.rejects(
  () => executeAgentFunding({ source: { ...source, canSpend: false }, recipientAgentId: "agent-1", recipientWallet, asset: "USDC", amountUsd: 5, personalWallets }),
  /watch-only/,
  "watch-only sources must be rejected",
);
await assert.rejects(
  () => executeAgentFunding({ source, recipientAgentId: "agent-1", recipientWallet: {}, asset: "USDC", amountUsd: 5, personalWallets }),
  /deposit address/,
  "a recipient without an address must be rejected",
);
await assert.rejects(
  () => executeAgentFunding({ source, recipientAgentId: "agent-1", recipientWallet: { walletAddress: "0xR", network: "eip155:4663" }, asset: "USDC", amountUsd: 5, personalWallets }),
  /receives USDG on Robinhood Chain/,
  "asset must match the recipient chain's stablecoin",
);
await assert.rejects(
  () => executeAgentFunding({ source: {}, recipientAgentId: "agent-1", recipientWallet, asset: "USDC", amountUsd: 5, personalWallets }),
  /No local USDC wallet/,
  "a source with no resolvable account id must be rejected",
);

// --- Happy path: two-phase /api/wallet/send with recipient gas sponsorship ------

const calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url, body });
  const payload = body.action === "approve"
    ? { ok: true, approvalToken: "tok-1" }
    : { ok: true, signature: "0xsig", network: body.agentId.includes("eip155") ? "eip155:8453" : "unknown", assetSymbol: "USDC" };
  return { ok: true, json: async () => payload };
};
try {
  const result = await executeAgentFunding({
    source,
    recipientAgentId: "agent-1",
    recipientWallet,
    asset: "USDC",
    amountUsd: 5,
    confirmation: "SEND_USDC",
    personalWallets,
  });
  assert.equal(result.ok, true);
  assert.equal(result.signature, "0xsig");
  assert.equal(result.toAddress, "0xRECIPIENT");
  assert.equal(calls.length, 2, "funding must run the two-phase approve/send flow");
  assert.equal(calls[0].url, "/api/wallet/send");
  assert.equal(calls[0].body.action, "approve");
  assert.equal(calls[1].body.action, "send");
  assert.equal(calls[1].body.approvalToken, "tok-1");
  for (const { body } of calls) {
    assert.equal(body.agentId, "user:seed:eip155-8453", "the send must execute from the per-chain source account id");
    assert.equal(body.toAddress, "0xRECIPIENT");
    assert.equal(body.autoPayEnabled, false, "personal wallets never auto-spend");
    assert.equal(body.confirmation, "SEND_USDC");
    assert.equal(body.maxPaymentUsd, 5);
    assert.equal(body.gasSponsorAgentId, "agent-1", "the receiving agent sponsors missing gas, no one else");
  }
} finally {
  globalThis.fetch = originalFetch;
}

// --- Wiring: chat popover, modals, and prop threading ----------------------------

const thread = read("src/features/dashboard/views/chat/exchange/MessageThread.tsx");
assert.match(thread, /onAgentNameClick/, "the message thread must surface agent-name clicks");
assert.match(thread, /fr-chat-agent-message-name-btn/, "the agent name must render as a clickable button when the popover is wired");

const panel = read("src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx");
assert.match(panel, /AgentAssetOverview/, "the chat panel must mount the asset overview popover");
assert.match(panel, /agentAssetPopover\.agentId === selectedAgent\.id/, "a stale anchor from another agent must not render");

const overview = read("src/features/dashboard/views/chat/exchange/AgentAssetOverview.tsx");
assert.match(overview, /resolveAgentWallet\(/, "the popover must resolve wallets through the canonical helper");
assert.match(overview, /getSurvivalSnapshot\(/, "runway/status must come from the canonical survival snapshot");
assert.match(overview, /\/api\/agents\/mailbox\?agentId=/, "mailboxes load from the agent mailbox route");
assert.match(overview, /\/api\/agents\/inbox\?agentId=/, "threads load from the agent-scoped inbox route");
assert.doesNotMatch(overview, /Loading\.\.\.|Loading…/, "pending states must animate, never a static Loading label");

const fundModal = read("src/features/dashboard/views/chat/exchange/AgentFundModal.tsx");
assert.match(fundModal, /executeAgentFunding\(/, "chat funding must go through the shared fund-agent client");
assert.match(fundModal, /confirmation: "SEND_USDC"/, "chat funding keeps the explicit send confirmation");
assert.match(fundModal, /has no deposit address yet/, "a recipient without a wallet must be surfaced upfront, not at submit");

const walletPanel = read("src/features/dashboard/views/WalletPanel.tsx");
assert.match(walletPanel, /executeAgentFunding\(/, "wallets-route funding must go through the same shared client");

const dashboard = read("src/features/dashboard/DashboardApp.tsx");
const chatSpread = dashboard.match(/<ChatPanel \{\.\.\.\{[\s\S]*?\}\} \/> : null\}/)?.[0] ?? "";
assert.match(chatSpread, /\bwalletsByAgent\b/, "the chat panel must receive walletsByAgent");
assert.match(chatSpread, /\brefreshWalletBalance\b/, "the chat panel must receive refreshWalletBalance");

const inboxRoute = read("src/app/api/agents/inbox/route.ts");
assert.match(inboxRoute, /searchParams\.get\("agentId"\)/, "the inbox route must support agent-scoped reads");
assert.match(inboxRoute, /requireAuth/, "the agent-scoped inbox read must stay auth-gated");

console.log("Agent asset overview tests passed.");
