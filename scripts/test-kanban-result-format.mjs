#!/usr/bin/env node
// Hermetic tests for the Work Board result presentation helpers: artifact
// extraction, wall-of-text splitting, and the needs-human "action needed" ask.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  extractResultArtifacts,
  formatPlainResultBody,
  extractActionNeeded,
} = await import("../src/features/dashboard/kanban-result-format.ts");

// The real Ada Lovelace deliverability result that motivated this formatter.
const adaResult = "Deliverability setup result recorded by Ada Lovelace: AgentMail credentials and runtime selectors are fixed; GET /v0/inboxes returned status 200/count 1 for liamvisionary@agentmail.to. Custom SPF/DKIM remains blocked: AgentMail POST /v0/domains for outreach.hivemindos.app returned 403 LimitExceededError: Domain limit exceeded while GET /v0/domains reports count 0. No Cloudflare DNS records were created, no emails sent, spend $0. Artifact: /Users/liam/Documents/Obsidian/hivemindos-vault/Operations/Work Board/artifacts/t_x-resolve-email/RESULT.md";

{
  const { artifacts, remainder } = extractResultArtifacts(adaResult);
  assert.equal(artifacts.length, 1, "one artifact extracted");
  assert.equal(artifacts[0].path, "/Users/liam/Documents/Obsidian/hivemindos-vault/Operations/Work Board/artifacts/t_x-resolve-email/RESULT.md");
  assert.equal(artifacts[0].label, "t_x-resolve-email/RESULT.md", "label is dir/basename");
  assert.ok(!remainder.includes("Artifact:"), "Artifact clause removed from prose");
  assert.ok(remainder.includes("Custom SPF/DKIM remains blocked"), "prose preserved");
}

{
  const multi = extractResultArtifacts("Artifacts: /tmp/a.txt, /tmp/b.txt done. Log at /var/log/x.log.");
  assert.equal(multi.artifacts.length, 3, "labeled list + bare path all extracted");
  assert.equal(multi.artifacts[2].path, "/var/log/x.log", "trailing punctuation stripped from bare path");
}

{
  const none = extractResultArtifacts("No paths here, just prose.");
  assert.equal(none.artifacts.length, 0);
  assert.equal(none.remainder, "No paths here, just prose.");
}

{
  const formatted = formatPlainResultBody(extractResultArtifacts(adaResult).remainder);
  const paragraphs = formatted.split("\n\n");
  assert.ok(paragraphs.length >= 3, `wall of text split into paragraphs (got ${paragraphs.length})`);
  assert.ok(paragraphs.some((p) => p.startsWith("Custom SPF/DKIM remains blocked")), "sentence boundaries respected");
}

{
  const short = "All done. Nothing to see.";
  assert.equal(formatPlainResultBody(short), short, "short text untouched");
  const structured = "- item one\n- item two " + "x".repeat(300);
  assert.equal(formatPlainResultBody(structured), structured, "already-structured text untouched");
}

{
  const ask = extractActionNeeded(adaResult);
  assert.ok(/blocked|Domain limit/i.test(ask), `heuristic pulls the blocker sentence (got: ${ask})`);
  assert.ok(!/credentials and runtime selectors are fixed/.test(ask), "non-blocker progress sentences excluded");
  assert.ok(ask.length <= 310, "clipped to a readable headline");
}

{
  const labeled = extractActionNeeded("Everything failed.\n\nACTION NEEDED: Upgrade the AgentMail plan or pick a different sending domain.\n\nEVIDENCE: none");
  assert.equal(labeled, "Upgrade the AgentMail plan or pick a different sending domain.", "labeled section wins and stops at the next section");
}

{
  assert.equal(extractActionNeeded(""), "", "empty result yields empty ask");
  assert.equal(extractActionNeeded(undefined), "", "undefined result yields empty ask");
  const lastResort = extractActionNeeded("Everything went fine. Task closed early.");
  assert.equal(lastResort, "Task closed early.", "falls back to the final sentence");
}

console.log("kanban-result-format: all assertions passed");
