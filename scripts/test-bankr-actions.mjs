#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const tmp = await mkdtemp(join(tmpdir(), "hivemindos-bankr-actions-"));

async function loadBankrActions() {
  const sourcePath = new URL("../src/lib/services/bankr-actions.ts", import.meta.url);
  const source = (await readFile(sourcePath, "utf8"))
    .replace(
      'import { bankrApiKey } from "@/lib/services/bankr-llm";',
      'async function bankrApiKey() { return "bk_test"; }',
    );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true,
    },
  }).outputText;
  const modulePath = join(tmp, "bankr-actions.mjs");
  await writeFile(modulePath, transpiled, "utf8");
  return import(pathToFileURL(modulePath).href);
}

try {
  const bankr = await loadBankrActions();

  assert.equal(bankr.classifyBankrActionPrompt("show my Bankr wallet portfolio")?.intent, "portfolio");
  assert.equal(bankr.classifyBankrActionPrompt("show my Bankr wallet portfolio")?.readOnly, true);
  assert.equal(bankr.classifyBankrActionPrompt("swap $50 of ETH to BNKR on Bankr")?.intent, "swap");
  assert.equal(bankr.classifyBankrActionPrompt("swap $50 of ETH to BNKR on Bankr")?.readOnly, false);
  assert.equal(bankr.classifyBankrActionPrompt("launch a token called HIVE on Bankr")?.intent, "token-launch");
  assert.equal(bankr.classifyBankrActionPrompt("search Polymarket for bitcoin markets")?.intent, "polymarket");
  assert.equal(bankr.classifyBankrActionPrompt("search Polymarket for bitcoin markets")?.readOnly, true);

  // Word-anchored intents still catch the real phrasings...
  assert.equal(bankr.classifyBankrActionPrompt("pause my DCA into ETH")?.intent, "automation");
  assert.equal(bankr.classifyBankrActionPrompt("list my automations on bankr")?.intent, "automation");
  assert.equal(bankr.classifyBankrActionPrompt("set a limit order for BNKR")?.intent, "automation");
  assert.equal(bankr.classifyBankrActionPrompt("check my open perps on hyperliquid")?.intent, "hyperliquid");
  assert.equal(bankr.classifyBankrActionPrompt("close my perpetuals")?.intent, "hyperliquid");
  assert.equal(bankr.classifyBankrActionPrompt("show my NFTs")?.intent, "nft");
  // ...but ordinary speech no longer false-triggers a Bankr call: half-anchored
  // alternations previously matched substrings ("broadcast" contains "dca",
  // "alphabet" ends in "bet") and persona/scaffolding words ("automation").
  assert.equal(bankr.classifyBankrActionPrompt("broadcast the update to everyone"), null);
  assert.equal(bankr.classifyBankrActionPrompt("teach me the greek alphabet"), null);
  assert.equal(bankr.classifyBankrActionPrompt("that line is perpendicular to the wall"), null);
  assert.equal(
    bankr.classifyBankrActionPrompt(
      "You are an expert YouTube Shorts strategist, video production manager, and automation engineer. Create viral Minecraft crafting videos.",
    ),
    null,
    "a non-financial automation role must not hijack the task with Bankr setup",
  );
  assert.equal(
    bankr.classifyBankrActionPrompt(
      "Set task ONLY when the user clearly asks for work to be done (a job, build, fix, research, automation, reminder, or delegation to the hive)."
    ),
    null,
    "generic hive automation scaffolding must not be treated as Bankr",
  );
  assert.equal(bankr.classifyBankrActionPrompt("uh nothing much"), null);

  const launchDraft = bankr.classifyBankrActionPrompt("launch a token called HIVE on Bankr");
  const card = bankr.bankrActionDraftMessage(launchDraft);
  assert.match(card, /Bankr action ready/);
  const parsedLaunchDraft = bankr.parseBankrActionDraftMessage(card);
  assert.equal(parsedLaunchDraft.intent, launchDraft.intent);
  assert.equal(parsedLaunchDraft.prompt, launchDraft.prompt);
  assert.equal(parsedLaunchDraft.readOnly, launchDraft.readOnly);

  const prepared = await bankr.runBankrActionTool({ intent: "swap", prompt: "swap $50 of ETH to BNKR on Bankr" });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.prepared, true);
  assert.match(prepared.message, /Reply `confirm`/);

  const calls = [];
  const portfolio = await bankr.executeBankrAction(
    { intent: "portfolio", prompt: "show my Bankr wallet portfolio", readOnly: true },
    {
      apiKey: "bk_test",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return {
          ok: true,
          json: async () => ({ totalUsd: 42, nfts: [{ name: "Hive Pass" }] }),
        };
      },
    },
  );
  assert.equal(portfolio.ok, true);
  assert.equal(calls[0].url, "https://api.bankr.bot/wallet/portfolio?include=pnl,nfts");
  assert.equal(calls[0].init.headers["X-API-Key"], "bk_test");

  const jobCalls = [];
  const swap = await bankr.executeBankrAction(
    { intent: "swap", prompt: "swap $5 USDC to ETH on Bankr", readOnly: false },
    {
      apiKey: "bk_test",
      pollMs: 1,
      timeoutMs: 100,
      fetchImpl: async (url, init) => {
        jobCalls.push({ url: String(url), init });
        if (String(url).endsWith("/agent/prompt")) {
          assert.equal(init.method, "POST");
          assert.deepEqual(JSON.parse(init.body), { prompt: "swap $5 USDC to ETH on Bankr" });
          return { ok: true, json: async () => ({ jobId: "job_1", threadId: "thread_1" }) };
        }
        return { ok: true, json: async () => ({ status: "completed", response: "Swap submitted.", jobId: "job_1" }) };
      },
    },
  );
  assert.equal(swap.ok, true);
  assert.equal(swap.jobId, "job_1");
  assert.equal(swap.threadId, "thread_1");
  assert.match(swap.summary, /Swap submitted/);
  assert.equal(jobCalls[0].url, "https://api.bankr.bot/agent/prompt");
  assert.equal(jobCalls[1].url, "https://api.bankr.bot/agent/job/job_1");

  console.log("Bankr actions classify requests, preserve confirmation cards, read portfolio, and poll Agent API jobs.");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
