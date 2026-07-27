#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-evaluation-surfaces-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  appendRuntimeChatSessionText,
  finishRuntimeChatSession,
  readRuntimeChatSession,
  startRuntimeChatSession,
} = await import("../src/lib/services/chat/runtime-session-store.ts");
const { listCliTaskRuns, startCliTaskRun } = await import("../src/lib/services/runtime-adapters/cli-task-runs.ts");

try {
  const vault = join(tempHome, "vault");
  await mkdir(vault, { recursive: true });
  const sessionId = "evaluation-chat-session";
  await startRuntimeChatSession({
    sessionId,
    agent: { id: "chat-agent", name: "Chat Agent", runtime: "hermes" },
    sharedVaultPath: vault,
    userContent: "Implement and verify the focused change.",
    startedAt: 1_800_000_000_000,
  });
  await appendRuntimeChatSessionText(
    sessionId,
    "assistant",
    "Implemented the focused change and verified the managed chat completion path with concrete evidence.",
  );
  await finishRuntimeChatSession(sessionId, "completed");
  const session = await readRuntimeChatSession({ sessionId });
  assert.equal(session?.evaluation?.verdict, "accepted");
  assert.equal(session?.evaluation?.tier, "quick");
  assert.equal(session?.evaluation?.routingEligible, false, "casual chat must not train task routing");

  // Evaluations attach in the child's close handler (log flush + evaluateCompletionEvent
  // + run rewrite), so under parallel gate load this can take well over the process's own
  // runtime. Poll on a generous deadline; the loop exits as soon as the evaluation lands.
  const waitForEvaluatedRun = async (runId) => {
    const deadline = Date.now() + 30_000;
    let run;
    while (Date.now() < deadline) {
      run = (await listCliTaskRuns("codex")).find((candidate) => candidate.id === runId);
      if (run?.status === "completed" && run.evaluation) return run;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return run;
  };

  const started = await startCliTaskRun({
    runtime: "codex",
    label: "Test CLI",
    command: process.execPath,
    buildArgs: () => ["-e", "console.log('Managed CLI task produced substantive verified output for evaluation.')"],
  }, { task: "Run a deterministic managed CLI evaluation test.", cwd: tempHome });
  assert.equal(started.ok, true);

  const cliRun = await waitForEvaluatedRun(started.id);
  assert.equal(cliRun?.status, "completed");
  assert.equal(cliRun?.evaluation?.surface, "runtime-cli");
  assert.equal(cliRun?.evaluation?.verdict, "accepted");
  assert.equal(cliRun?.evaluation?.routingEligible, true);

  const silentStarted = await startCliTaskRun({
    runtime: "codex",
    label: "Silent Test CLI",
    command: process.execPath,
    buildArgs: () => ["-e", "process.exit(0)"],
  }, { task: "This prompt is deliberately substantive but the process returns no output.", cwd: tempHome });
  const silentRun = await waitForEvaluatedRun(silentStarted.id);
  assert.equal(silentRun?.evaluation?.verdict, "rejected", "the command echo must not let a silent exit-0 CLI run pass");

  const [evaluationGuide, navigation, readme, investorGuide] = await Promise.all([
    readFile(new URL("../docs/for-users/features/agent-evaluations.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/_data/navigation.yml", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/for-investors/index.md", import.meta.url), "utf8"),
  ]);
  assert.match(navigation, /url: \/for-users\/features\/agent-evaluations\.html/);
  assert.match(readme, /docs\/for-users\/features\/agent-evaluations\.md/);
  assert.match(evaluationGuide, /requires a separate reviewer/i);
  assert.match(evaluationGuide, /Independently launched CLI/);
  assert.match(evaluationGuide, /outside the managed run path/i);
  assert.match(investorGuide, /official reputation, entitlement, settlement, and payout decisions remain server-controlled/i);

  console.log("evaluation surface integration tests passed");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
