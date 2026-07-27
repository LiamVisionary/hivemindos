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
  extractHumanAsk,
  parseTaskBrief,
  taskBriefHeadline,
  isBriefGuidanceSection,
  isBriefGuidanceText,
  isGenuineHumanAsk,
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

// --- extractHumanAsk: structured needs-human asks -------------------------

{
  const full = extractHumanAsk([
    "Research stalled at the API layer.",
    "",
    "ACTION NEEDED: Create an OpenAI API key and provide it so outreach drafting can continue.",
    "LINK: https://platform.openai.com/api-keys — OpenAI key page",
    "OPTIONS: Use my existing key | Create a new key",
    "NEEDS: api-key OPENAI_API_KEY",
  ].join("\n"));
  assert.ok(full, "structured ask parsed");
  assert.ok(full.ask.startsWith("Create an OpenAI API key"), "ask text extracted");
  assert.equal(full.links.length, 1, "LINK line parsed");
  assert.equal(full.links[0].url, "https://platform.openai.com/api-keys");
  assert.equal(full.links[0].label, "OpenAI key page", "explicit link label kept");
  assert.deepEqual(full.options, ["Use my existing key", "Create a new key"], "OPTIONS split on pipes");
  assert.deepEqual(full.input, { kind: "api-key", envKey: "OPENAI_API_KEY" }, "NEEDS parsed with env key");
  assert.deepEqual(full.inputs, [{ kind: "api-key", envKey: "OPENAI_API_KEY" }], "single NEEDS key is also exposed in inputs list");
}

{
  const bare = extractHumanAsk("ACTION NEEDED: Approve the plan at https://example.com/plans/7 before I proceed.");
  assert.equal(bare.links.length, 1, "bare URL in the ask becomes a link");
  assert.equal(bare.links[0].url, "https://example.com/plans/7", "trailing punctuation stripped");
  assert.ok(!bare.ask.includes("https://"), "URL removed from the ask prose");
  assert.ok(bare.ask.includes("Approve the plan"), "ask prose preserved");
}

{
  const inferred = extractHumanAsk("ACTION NEEDED: Provide the ANTHROPIC_API_KEY API key so the drafting agent can run.");
  assert.equal(inferred.input?.kind, "api-key", "api-key inferred from prose");
  assert.equal(inferred.input?.envKey, "ANTHROPIC_API_KEY", "env-shaped token picked up");
  assert.deepEqual(inferred.inputs, [{ kind: "api-key", envKey: "ANTHROPIC_API_KEY" }], "inferred env key is listed as an input");
}

{
  const multi = extractHumanAsk([
    "ACTION NEEDED: Add OUTREACH_PHYSICAL_ADDRESS and AGENTMAIL_API_KEY to the shared hive env/runtime, then rerun this card.",
    "NEEDS: api-key AGENTMAIL_API_KEY",
  ].join("\n"));
  assert.deepEqual(
    multi.inputs,
    [
      { kind: "api-key", envKey: "AGENTMAIL_API_KEY" },
      { kind: "api-key", envKey: "OUTREACH_PHYSICAL_ADDRESS" },
    ],
    "env vars named in the ask prose stay visible even when NEEDS names only one",
  );
}

{
  const decision = extractHumanAsk("ACTION NEEDED: Should I send the outreach batch now?\nOPTIONS: Yes | No | Wait until Monday");
  assert.deepEqual(decision.options, ["Yes", "No", "Wait until Monday"]);
  assert.equal(decision.input, undefined, "no input control for a pure decision");
}

{
  const file = extractHumanAsk("ACTION NEEDED: Attach the signed contract PDF so I can countersign.\nNEEDS: file");
  assert.deepEqual(file.input, { kind: "file", envKey: undefined }, "file ask parsed");
  assert.equal(file.options.length, 0);
}

{
  assert.equal(extractHumanAsk(""), null, "empty result yields no ask");
  assert.equal(extractHumanAsk(undefined), null, "undefined result yields no ask");
  const plain = extractHumanAsk("ACTION NEEDED: Reply with the preferred launch date.");
  assert.equal(plain.links.length, 0);
  assert.equal(plain.options.length, 0);
  assert.equal(plain.input, undefined, "plain text ask has no inferred controls");
}

// --- parseTaskBrief: control-plane dispatch briefs -------------------------

const controlPlaneBrief = [
  "Created by the Queen Bee control plane.",
  "",
  "Source: company:df5c0f4a-4c12:mr4zji71",
  "Mode: act",
  "Intent fingerprint: 92127d3c8356d5314cc3a06e",
  "Worker class: planner",
  "Delegated agent: Grace Hopper",
  "Target machine: hivemindos-ubuntu-8gb-hel1-2",
  "Loop contract",
  "Mode: optimizer",
  "Goal: Resolve email deliverability setup issues",
  "Success criteria: Weekly Revenue moves toward 5k.; The result includes reusable learning.",
  "Request",
  "Address the failures in the outreach email deliverability setup.",
  "Complete this scoped task and record the result on the Work Board.",
  "---",
  "Company: Website Outreach Agency (Web Development)",
  "Apex goal: Earn $250k/yr creating and shipping websites",
  "Metric: Weekly Revenue -> target 5k (current 0)",
  "Charter: Autonomous Sarasota web agency",
  "",
  "What the company has done recently (newest first):",
  "[2026-07-03] DONE: Verify outreach email deliverability setup (HermesMain) — Completed deliverability verification",
  "[2026-07-03] BLOCKED: Verify outreach email deliverability setup (HermesMain) — Queen Bee autonomous pickup exhausted",
  "",
  "Do not repeat work listed as DONE above. Record a concrete, durable result on the Work Board.",
].join("\n");

{
  const brief = parseTaskBrief(controlPlaneBrief);
  assert.ok(brief, "control-plane brief parses");
  const first = brief.sections[0];
  assert.equal(first.title, undefined, "leading section untitled");
  assert.equal(first.blocks[0].kind, "prose", "intro prose kept first");
  assert.ok(first.blocks[0].text.includes("Queen Bee control plane"));
  const fieldsBlock = first.blocks.find((b) => b.kind === "fields");
  assert.equal(fieldsBlock.fields.length, 6, "routing fields grouped");
  assert.equal(fieldsBlock.fields[0].key, "Source");
  const loop = brief.sections.find((s) => s.title === "Loop contract");
  assert.ok(loop, "Loop contract section detected");
  assert.ok(loop.blocks[0].fields.some((f) => f.key === "Goal"), "loop fields parsed");
  const request = brief.sections.find((s) => s.title === "Request");
  assert.ok(request.blocks[0].text.startsWith("Address the failures"), "request prose parsed");
  const activity = brief.sections.find((s) => s.title === "Recent company activity");
  const items = activity.blocks.find((b) => b.kind === "activity").items;
  assert.equal(items.length, 2, "digest lines become activity items");
  assert.equal(items[0].kind, "DONE");
  assert.equal(items[1].kind, "BLOCKED");
  assert.equal(items[0].date, "2026-07-03");
  assert.equal(taskBriefHeadline(brief), "Address the failures in the outreach email deliverability setup.", "headline = first Request line");
}

{
  assert.equal(parseTaskBrief("Just a hand-written task body with one Note: inline."), null, "ordinary bodies do not parse as briefs");
  assert.equal(parseTaskBrief(""), null);
  assert.equal(parseTaskBrief(undefined), null);
}

// --- brief guidance classification -----------------------------------------

{
  assert.equal(isBriefGuidanceSection({ title: "Routing contract", blocks: [] }), true);
  assert.equal(isBriefGuidanceSection({ title: "Queen Bee delegation", blocks: [] }), true);
  assert.equal(isBriefGuidanceSection({ title: "Request", blocks: [] }), false);
  assert.equal(isBriefGuidanceSection({ blocks: [] }), false, "untitled sections are not guidance by title");
  assert.equal(isBriefGuidanceText("Do not repeat work listed as DONE above. Record a concrete, durable result on the Work Board."), true);
  assert.equal(isBriefGuidanceText("If you are blocked on human input, access, approval, or a decision, end your result with ACTION NEEDED."), true);
  assert.equal(isBriefGuidanceText("Complete this scoped task and record the result on the Work Board."), true);
  assert.equal(isBriefGuidanceText("Address the failures in the outreach email deliverability setup."), false);
  assert.equal(isBriefGuidanceText("Created by the Queen Bee control plane."), false);
}

// isGenuineHumanAsk: worker/control-plane boilerplate and bare completion reports
// are NOT decisions the owner can act on; a real ask is.
{
  assert.equal(isGenuineHumanAsk("Re-run or revise the worker result with Status: sent plus a receipt, or Status: blocked plus the exact blocker and evidence."), false);
  assert.equal(isGenuineHumanAsk("Re-run or revise the worker result with Status: sent plus a receipt, or Status: blocked plus the exact blocker and evidence. Created by the Queen Bee control plane."), false);
  assert.equal(isGenuineHumanAsk("Created by the Queen Bee control plane."), false);
  assert.equal(isGenuineHumanAsk("Required Work Board evidence fields: Status: sent|blocked; Receipt: <if sent>."), false);
  assert.equal(isGenuineHumanAsk("Status: blocked\nEvidence: form rejected submit"), false);
  assert.equal(isGenuineHumanAsk("Completed Work Board task t_x."), false);
  assert.equal(isGenuineHumanAsk(""), false);
  assert.equal(isGenuineHumanAsk("  "), false);
  assert.equal(isGenuineHumanAsk("Approve sending the four drafted close replies, or choose the smaller send set."), true);
  assert.equal(isGenuineHumanAsk("Add PORTFOLIO_OFFER_API_TOKEN to the shared env so the crew can post offers."), true);
  assert.equal(isGenuineHumanAsk("The crew finished this but couldn't confirm the outreach was actually sent. Review it, then use Discuss to tell the crew what to do."), true);
}

console.log("kanban-result-format: all assertions passed");
