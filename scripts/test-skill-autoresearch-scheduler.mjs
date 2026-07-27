#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-skill-scheduler-autoresearch-"));
const vaultPath = join(tempHome, "vault");
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;

const skillDir = join(vaultPath, "Skills", "scheduled-brief");
await mkdir(skillDir, { recursive: true });
await writeFile(join(skillDir, "SKILL.md"), [
  "---",
  "name: scheduled-brief",
  "description: Run a scheduled brief action.",
  "---",
  "",
  "# Scheduled Brief",
  "",
  "```hivemindos-action",
  JSON.stringify({ id: "run-brief", runtime: "node", permissions: ["local-execution"], requiresApproval: true, script: "process.exit(1)" }),
  "```",
  "",
].join("\n"));

try {
  const route = await import("../src/app/api/scheduler/skill-action/route.ts");
  const queue = await import("../src/lib/services/brain-review-queue.ts");

  for (let index = 1; index <= 3; index += 1) {
    const response = await route.POST(new Request("http://127.0.0.1/api/scheduler/skill-action", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hivemind-run-id": `schedule-run-${index}`,
      },
      body: JSON.stringify({
        skillSlugs: ["scheduled-brief"],
        scheduleName: "Scheduled Brief",
        vaultPath,
        approved: true,
      }),
    }));
    assert.equal(response.status, 500);
    const reviews = await queue.readBrainReviewQueue();
    assert.equal(
      reviews.proposals.filter((proposal) => proposal.kind === "skill-evolution").length,
      index === 3 ? 1 : 0,
      "the scheduler should feed the same three-distinct-run autoresearch threshold",
    );
  }

  const reviews = await queue.readBrainReviewQueue();
  const proposal = reviews.proposals.find((candidate) => candidate.kind === "skill-evolution");
  assert.equal(proposal?.metadata?.skillSlug, "scheduled-brief");
  console.log("Scheduler skill failures feed the app-wide autoresearch review queue");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
