import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter } from "node:path";
import { dirname, isAbsolute, join, sep } from "node:path";

const DEFAULTS = {
  vaultPath: "~/Documents/Obsidian/hivemindos-vault",
  scheduledFolder: "Operations/Automations",
  synthesisFolder: "Synthesis",
  brainServicesFolder: "Operations/Brain Services",
  secureFolder: "Operations/Secure",
  kanbanFolder: "Operations/Work Board",
  notificationsFolder: "Operations/Agent Notifications",
};

const WORKFLOW_ROOT = "Foundation Workflows";
const QUEEN_BEE_CANONICAL_IDENTITY_PATH = "Operations/Brain Services/Queen Bee/Identity.md";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : "true";
    if (args[key] !== "true") index += 1;
  }
  return args;
}

function expandHome(path) {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function safeVaultFolder(value, fallback) {
  const folder = String(value || fallback).trim();
  if (!folder) return fallback;
  if (isAbsolute(folder) || folder.split(/[\\/]+/).includes("..")) {
    throw new Error(`Vault folder must be relative: ${folder}`);
  }
  return folder.split(/[\\/]+/).filter(Boolean).join(sep);
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeIfMissing(path, content) {
  if (await exists(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${content.trim()}\n`, "utf8");
  return true;
}

async function findExecutable(candidates) {
  const pathDirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const expanded = candidates.flatMap((candidate) => {
    if (!candidate) return [];
    if (isAbsolute(candidate) || candidate.includes("/") || candidate.includes("\\")) return [expandHome(candidate)];
    return pathDirs.map((dir) => join(dir, candidate));
  });
  for (const candidate of expanded) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep probing; this is an optional status note.
    }
  }
  return "";
}

function vaultContract(folders) {
  return `# AI-Ready Vault Contract

This vault is the shared brain for HivemindOS agents. It should stay useful to humans in Obsidian and predictable for agents, search, Dataview, Tasks, GBrain, and other retrieval tools.

## Routing

| Layer | Use |
| --- | --- |
| Intake | Raw captures, URLs, meeting dumps, unsorted requests, and source material. |
| Synthesis | Drafts, connection reports, research summaries, reviewed analysis, and generated outputs. |
| Memory | Durable daily briefings, weekly reviews, decisions, meetings, book notes, imported sources, and distillations. |
| Projects | Project overviews, status deltas, plans, decisions, and reusable project context. |
| Operations | Machine-readable HivemindOS state: automations, work board, notifications, runtime mirrors, secure backups, access logs, and brain-service status. |
| Skills | Reusable agent procedures. Read \`Skills/README.md\` first, then the relevant \`Skills/<slug>/SKILL.md\`. |
| Archive | Preserved inactive or processed material. |

## Note Contract

- Use one of the templates in \`Templates/HivemindOS/\` for durable notes whenever practical.
- Include \`type\`, \`status\`, \`created\`, and source/project fields when the template provides them.
- Keep raw imported material separate from reviewed synthesis.
- Promote useful synthesis into Memory or Projects only after it has sources and a clear reuse case.
- Link sources with wikilinks or relative vault paths.
- Tag generated agent outputs with \`ai-generated\` in frontmatter or body metadata.
- Do not store provider secrets, private keys, bearer tokens, or unredacted sensitive data in the vault.

## Agent Write Policy

- Read \`AGENTS.md\`, \`Shared Context.md\`, and this contract before durable edits.
- Use \`hive-brain answer "<query>"\` or \`/api/brain/memory\` for shared-brain recall and durable shared memories. Raw/non-managed agents should prefer \`hive-brain\` because it discovers the running API and falls back to local vault/index search. Claude Code may also receive shared-brain context automatically through the setup-installed \`hive-brain-hook\` \`UserPromptSubmit\` hook.
- Default recall/answer is tiered: check typed Agent Memory first, return it when the distilled hit is strong, and otherwise augment with relevant markdown from the full shared vault.
- Use \`--scope agent-memory\` or \`scope: "agent-memory"\` for typed/proven memory only; use \`--scope full-vault\` or \`scope: "full-vault"\` to force broad vault recall.
- Recall before relying on prior preferences, decisions, instructions, goals, commitments, artifacts, lessons, or project context.
- Save shared memories under \`Memory/Distillations/Agent Memory/\` through the API, include available agent/runtime/machine/Tailnet provenance, and prefer \`proof: "auto"\` unless explicit proof is requested.
- Never store raw Tailnet IPs, provider secrets, private keys, bearer tokens, or plaintext sensitive data in memory notes or proof receipts.
- \`${folders.secureFolder}/\` reference/status notes are searchable during full-vault recall so agents can know which credential names exist or are set, but plaintext secret values must stay out of notes and responses.
- Run the memory API \`rebuild-index\` action after importing or manually editing agent memory notes.
- Use \`hive-handoff\`, \`/api/handoff\`, \`/handoff-task\`, or \`hivemind-mcp\` for fleet-aware file and task handoffs. If a task handoff lacks the task, ask what the receiving agent should do; plain file handoff can proceed without a task.
- Prefer appending dated status deltas over rewriting project history.
- Never silently delete notes. Archive or create explicit conflict copies when needed.
- Summarize automation writes in \`${folders.scheduledFolder}/Foundation Workflows/OPERATIONS-LOG.md\` or in the scheduled run note.
- Treat \`${folders.kanbanFolder}\`, \`${folders.scheduledFolder}\`, and \`${folders.secureFolder}\` as operational state, not permanent knowledge.`;
}

function templatesReadme() {
  return `# HivemindOS Templates

AI-ready note templates for the shared brain.

Use these as starting points for durable notes so humans, agents, Dataview, Tasks, and retrieval services see consistent metadata.

Recommended mapping:

- Daily briefing -> \`Memory/Daily Briefings/YYYY-MM-DD.md\`
- Weekly review -> \`Memory/Weekly Reviews/YYYY-MM-DD.md\`
- Meeting -> \`Memory/Meetings/YYYY-MM-DD-topic.md\`
- Research source -> \`Memory/Imported Sources/YYYY-MM-DD-topic.md\`
- Decision -> \`Memory/Decision Journal/YYYY-MM-DD-topic.md\` or a project folder
- Book note -> \`Memory/Book Notes/title.md\`
- Project -> \`Projects/<project>/overview.md\`
- Distillation -> \`Memory/Distillations/YYYY-MM-DD-topic.md\`
- AI output -> \`Synthesis/wiki/synthesis/YYYY-MM-DD-topic.md\``;
}

function queenBeeIdentityMarkdown() {
  return `# Queen Bee Identity

Queen Bee is Liam's single logical coordinator identity across HivemindOS machines, agents, tools, projects, and shared brain context.

She may run from multiple machines, but all instances coordinate through this shared brain, the shared Work Board, Shared Brain Memory, Fleet discovery, and Handoff receipts.

## Contract

- Present one assistant identity to the user.
- Keep per-machine coordinators as implementation details unless routing transparency is useful.
- Use \`Operations/Work Board/\` for tasks.
- Use \`Memory/Distillations/Agent Memory/\` and \`/api/brain/memory\` for durable memory.
- Use \`/api/fleet/discover\`, \`/api/fleet/apps\`, and \`/api/handoff\` for live routing and cross-machine work.`;
}

function queenBeeRoutingPolicyMarkdown() {
  return `# Queen Bee Routing Policy

Queen Bee routes by reading the current request, Shared Brain Memory, Work Board state, Fleet discovery, connected-app context, project notes, and safety policy.

## Canonical primitives

- Tasks: \`Operations/Work Board/kanban.json\` and \`/api/kanban\`.
- Durable memory: \`Memory/Distillations/Agent Memory/\` and \`/api/brain/memory\`.
- Live machines: \`/api/fleet/discover\` and \`/api/fleet/apps\`.
- Cross-machine delegation: \`/api/handoff\` and \`.hivemindos-transfers/\`.
- Human attention: \`Operations/Agent Notifications/\`.

Node files under this folder are snapshots/annotations, not the primary live source of truth.

## Default routing

- Infer the worker class from the request.
- Rank online chat-capable agents across all machines, not just the local machine.
- Assign the Work Board card to the best available matching agent and target machine.
- If no matching runtime is online, keep the card assigned to \`queen-bee\` for later review/delegation.`;
}

function queenBeeSafetyPolicyMarkdown() {
  return `# Queen Bee Safety Policy

- Read-only lookup: no confirmation required.
- Safe mutation directly requested by Liam: proceed after fresh prerequisite checks.
- Risky mutation such as delete, deploy, send, spend, credentials, or irreversible external side effects: require explicit confirmation and write a receipt.
- Sensitive data: never write raw secrets, tokens, passwords, keys, or connection strings into the vault; use credential names/status only.

Vault state provides consistency and replay protection. Live APIs provide current execution truth. Human confirmation gates high-risk side effects.`;
}

function queenBeeCurrentStateMarkdown() {
  return `# Queen Bee Current State

Status: ready

Queen Bee is backed by \`Operations/Brain Services/Queen Bee/\`, the shared Work Board, Shared Brain Memory, Fleet discovery, and Handoff. Runtime instances should check this file for compact state, then use live APIs for fresh status before executing work.`;
}

function queenBeeReadme() {
  return `# Queen Bee Control Plane

This folder stores the lightweight coordination state for the single logical Queen Bee identity.

Use it for identity, routing and safety policy, dedupe records, leases, node annotations, and completion receipts. Do not fork durable memory or normal task storage here: use \`/api/brain/memory\` for memory and \`Operations/Work Board/\` for tasks.`;
}

function templateMarkdown(kind) {
  const templates = {
    "daily-briefing": `---
type: daily-briefing
status: active
created: YYYY-MM-DD
review_after:
tags:
  - daily-briefing
---

# Daily Briefing - YYYY-MM-DD

## Focus

## Before Noon

## Risks

## Open Loops

## Suggested First Move

## Sources`,
    "weekly-review": `---
type: weekly-review
status: active
created: YYYY-MM-DD
week:
tags:
  - weekly-review
---

# Weekly Review - YYYY-MM-DD

## Moved Forward

## Stalled

## Patterns

## Top 3 Next Week

## Decisions To Make

## Sources`,
    meeting: `---
type: meeting
status: draft
created: YYYY-MM-DD
project:
attendees:
decisions:
tags:
  - meeting
---

# Meeting - Topic

## Raw Notes

## Decisions

## Action Items

- [ ] Task - owner - due YYYY-MM-DD

## Follow-Up

## Links`,
    "research-source": `---
type: research-source
status: captured
created: YYYY-MM-DD
source_url:
source_type:
author:
project:
confidence:
tags:
  - research
---

# Research Source - Topic

## Source

## Summary

## Key Claims

## Useful For

## Contradictions Or Tensions

## Follow-Up Questions`,
    decision: `---
type: decision
status: proposed
created: YYYY-MM-DD
project:
decision_date:
owner:
outcome_review:
tags:
  - decision
---

# Decision - Topic

## Context

## Options

## Decision

## Expected Outcome

## Risks

## Review Notes`,
    project: `---
type: project
status: active
created: YYYY-MM-DD
owner:
priority:
tags:
  - project
---

# Project - Name

## Goal

## Current Status

## Constraints

## Milestones

## Decisions

## Open Questions

## Related Notes`,
    "book-note": `---
type: book-note
status: captured
created: YYYY-MM-DD
author:
source:
tags:
  - book-note
---

# Book - Title

## Core Ideas

## Highlights

## Connections

## Actions

## Questions`,
    distillation: `---
type: distillation
status: reviewed
created: YYYY-MM-DD
topic:
confidence:
source_notes:
tags:
  - distillation
---

# Distillation - Topic

## Insight

## Evidence

## When To Reuse

## Limits

## Source Trail`,
    "ai-output": `---
type: ai-output
status: draft
created: YYYY-MM-DD
generator:
project:
source_notes:
tags:
  - ai-generated
---

# AI Output - Topic

## Prompt Or Request

## Output

## Source Notes

## Human Review

## Next Action`,
  };
  return templates[kind];
}

function obsidianPluginPack() {
  return `---
type: brain-service
service: obsidian-plugin-pack
enabled: false
installMode: manual
---

# Obsidian Plugin Pack

Recommended optional plugins for a stronger HivemindOS shared brain. Install manually from Obsidian's Community Plugins browser after reviewing each plugin's privacy and sync behavior.

## Core Structure

- Templater: create new notes from the AI-ready templates.
- Dataview: query notes by frontmatter such as type, project, status, and review_after.
- Tasks: collect tasks from meetings, decisions, and project notes.
- Periodic Notes: create daily, weekly, monthly, and quarterly notes with templates.
- Calendar: navigate daily notes and timelines.
- Kanban: view markdown boards when you want Obsidian-native boards alongside HivemindOS work-board state.

## Retrieval And AI

- Smart Connections: semantic search and chat over the vault.
- Copilot: in-Obsidian chat over local vault context.

## Safety And History

- Obsidian Git: commit vault changes on a schedule when that fits your sync model.

## HivemindOS Policy

- Do not put API keys or model secrets in plugin notes.
- Keep generated outputs tagged with ai-generated.
- Let HivemindOS own machine-readable operational state under Operations unless a plugin is explicitly configured to write there.`;
}

function obsidianCliNote(cliPath) {
  return `---
type: brain-service
service: obsidian-cli
enabled: ${cliPath ? "true" : "false"}
installMode: optional
cliPath: ${JSON.stringify(cliPath || "obsidian")}
---

# Obsidian CLI

Optional official Obsidian CLI surface for opening, searching, and managing the desktop vault from agent workflows.

## Status

- Detected path: \`${cliPath || "not detected"}\`
- Preferred command: \`${cliPath || "obsidian"}\`

## HivemindOS Usage

- Prefer exact vault-relative paths for note reads and writes.
- Use filesystem reads for conservative read-only inspection when the desktop CLI is unavailable.
- Use the CLI for desktop-aware actions such as opening notes, workspace navigation, plugin/runtime administration, and Sync status when explicitly requested.
- Keep destructive Sync, Publish, plugin, and workspace operations behind explicit user intent.`;
}

function obsidianNativeBrainPackNote() {
  return `---
type: brain-service
service: obsidian-native-brain-pack
enabled: true
installMode: auto-installed-shared-skills
source: kepano/obsidian-skills
---

# Obsidian Native Brain Pack

HivemindOS seeds a small Obsidian-native skill pack into the shared Skills shelf so agents can write notes that render well for humans, not just for retrieval.

## Auto-Installed Skills

- \`obsidian-markdown\`: Obsidian Flavored Markdown, wikilinks, embeds, properties, callouts, comments, tags, math, Mermaid, and footnotes.
- \`obsidian-bases\`: YAML \`.base\` files for native database-like views over vault notes.
- \`json-canvas\`: Obsidian \`.canvas\` files for visual maps, project boards, flowcharts, and concept graphs.
- \`defuddle\`: optional clean web-page-to-markdown extraction when the CLI is installed.

## Seeded Native Views

- \`Operations/Brain Services/Agent Memory.base\`
- \`Operations/Brain Services/Project Brain.base\`
- \`Operations/Brain Services/Secure References.base\`
- \`Operations/Brain Services/Whole Brain.canvas\`

## Policy

- Use native Obsidian syntax when writing durable human-facing notes.
- Keep Bases and Canvas files as views over the vault, not sources of private secret values.
- Do not import the generic upstream \`obsidian-cli\` skill by default; HivemindOS uses its own safer Obsidian CLI skills and vault policy.`;
}

function agentMemoryBase() {
  return `filters:
  and:
    - 'file.inFolder("Memory/Distillations/Agent Memory")'

properties:
  file.name:
    displayName: "Memory"
  type:
    displayName: "Type"
  status:
    displayName: "Status"
  project:
    displayName: "Project"
  runtime:
    displayName: "Runtime"
  agentName:
    displayName: "Agent"
  machineName:
    displayName: "Machine"
  tailnetName:
    displayName: "Tailnet"
  confidence:
    displayName: "Confidence"
  file.mtime:
    displayName: "Updated"

views:
  - type: table
    name: "Typed Memories"
    order:
      - file.name
      - type
      - status
      - project
      - runtime
      - agentName
      - machineName
      - tailnetName
      - confidence
      - file.mtime
  - type: cards
    name: "By Project"
    order:
      - file.name
      - type
      - project
      - agentName
      - machineName
    groupBy:
      property: project
      direction: ASC`;
}

function projectBrainBase() {
  return `filters:
  or:
    - 'file.inFolder("Projects")'
    - 'file.inFolder("Memory/Decision Journal")'
    - 'file.inFolder("Memory/Weekly Reviews")'

properties:
  file.name:
    displayName: "Note"
  status:
    displayName: "Status"
  owner:
    displayName: "Owner"
  priority:
    displayName: "Priority"
  project:
    displayName: "Project"
  type:
    displayName: "Type"
  review_after:
    displayName: "Review After"
  file.mtime:
    displayName: "Updated"

views:
  - type: table
    name: "Project Context"
    order:
      - file.name
      - status
      - project
      - owner
      - priority
      - type
      - review_after
      - file.mtime
  - type: cards
    name: "By Status"
    order:
      - file.name
      - project
      - owner
      - priority
      - file.mtime
    groupBy:
      property: status
      direction: ASC`;
}

function secureReferencesBase(folders) {
  return `filters:
  and:
    - 'file.inFolder("${folders.secureFolder}")'
    - 'file.ext == "md"'

properties:
  file.name:
    displayName: "Reference"
  type:
    displayName: "Type"
  service:
    displayName: "Service"
  keyName:
    displayName: "Key Name"
  status:
    displayName: "Status"
  last_checked:
    displayName: "Last Checked"
  file.mtime:
    displayName: "Updated"

views:
  - type: table
    name: "Credential References"
    order:
      - file.name
      - service
      - keyName
      - status
      - last_checked
      - file.mtime
  - type: cards
    name: "By Service"
    order:
      - file.name
      - keyName
      - status
      - file.mtime
    groupBy:
      property: service
      direction: ASC`;
}

function wholeBrainCanvas(folders) {
  const canvas = {
    nodes: [
      {
        id: "0f3c9a18b7e24d10",
        type: "text",
        x: -640,
        y: -120,
        width: 300,
        height: 170,
        color: "5",
        text: "# Agent request\n\nRaw Codex, Claude, Hermes, Aeon, app-routed chat, or shell workflow asks a question.",
      },
      {
        id: "c84d4b12e73a5019",
        type: "text",
        x: -260,
        y: -120,
        width: 320,
        height: 170,
        color: "4",
        text: "# Typed Agent Memory\n\nFast durable recall from Memory/Distillations/Agent Memory plus the private JSONL index.",
      },
      {
        id: "88f07ac903bd4f2a",
        type: "text",
        x: 140,
        y: -120,
        width: 320,
        height: 170,
        color: "3",
        text: "# Full vault augmentation\n\nIf typed memory is weak, broaden to Projects, Memory, Synthesis, Ideas, Operations, Skills, and safe Secure references.",
      },
      {
        id: "bd1a90573e4c8f21",
        type: "text",
        x: 540,
        y: -120,
        width: 320,
        height: 170,
        color: "2",
        text: "# Answer or action\n\nReturn grounded context, then write durable memories through hive-brain remember or the memory API when the result should compound.",
      },
      {
        id: "621f431b8a90d7ce",
        type: "group",
        x: -300,
        y: 140,
        width: 520,
        height: 280,
        color: "4",
        label: "Durable memory proof layer",
      },
      {
        id: "29d71a4c9b80f63e",
        type: "text",
        x: -260,
        y: 210,
        width: 440,
        height: 150,
        color: "4",
        text: "Optional GitLawb receipts live at Operations/Brain Services/Agent Memory Proofs.jsonl. They store hashes and provenance, not memory bodies.",
      },
      {
        id: "e7b2f6d1a03c48ab",
        type: "group",
        x: 300,
        y: 140,
        width: 520,
        height: 280,
        color: "6",
        label: "Obsidian-native human views",
      },
      {
        id: "a918fc03d4e67b25",
        type: "text",
        x: 340,
        y: 210,
        width: 440,
        height: 150,
        color: "6",
        text: `Bases expose Agent Memory, Projects, and ${folders.secureFolder} status notes as native Obsidian views. Whole Brain.canvas maps the retrieval path for humans.`,
      },
    ],
    edges: [
      {
        id: "6dbe4930182c74af",
        fromNode: "0f3c9a18b7e24d10",
        fromSide: "right",
        toNode: "c84d4b12e73a5019",
        toSide: "left",
        toEnd: "arrow",
        label: "hive-brain answer",
      },
      {
        id: "3fa0b6d74e9c2185",
        fromNode: "c84d4b12e73a5019",
        fromSide: "right",
        toNode: "88f07ac903bd4f2a",
        toSide: "left",
        toEnd: "arrow",
        label: "weak hit",
      },
      {
        id: "8c16a2f39d4b70e5",
        fromNode: "88f07ac903bd4f2a",
        fromSide: "right",
        toNode: "bd1a90573e4c8f21",
        toSide: "left",
        toEnd: "arrow",
        label: "grounded context",
      },
      {
        id: "fd42a8b350169c7e",
        fromNode: "bd1a90573e4c8f21",
        fromSide: "bottom",
        toNode: "29d71a4c9b80f63e",
        toSide: "top",
        toEnd: "arrow",
        label: "proof:auto",
      },
      {
        id: "73ea19c6b8042df5",
        fromNode: "88f07ac903bd4f2a",
        fromSide: "bottom",
        toNode: "a918fc03d4e67b25",
        toSide: "top",
        toEnd: "arrow",
        label: "human views",
      },
    ],
  };
  return JSON.stringify(canvas, null, 2);
}

function workflowPrompt(workflow, folders) {
  const operationLogPath = `${folders.scheduledFolder}/${WORKFLOW_ROOT}/OPERATIONS-LOG.md`;
  const rules = [
    "Read AGENTS.md and Shared Context.md before writing.",
    "Use hive-brain answer \"<query>\" or /api/brain/memory for shared-brain recall and durable shared memories; raw/non-managed agents should prefer hive-brain because it discovers the API and falls back to local vault/index search.",
    "Claude Code may also receive shared-brain context automatically through the setup-installed hive-brain-hook UserPromptSubmit hook.",
    "Default recall/answer is tiered through typed Agent Memory first, then full shared vault when needed.",
    "Use --scope agent-memory or scope: \"agent-memory\" for typed/proven memory only; use --scope full-vault or scope: \"full-vault\" to force broad vault recall.",
    "Recall before depending on prior preferences, decisions, instructions, goals, commitments, artifacts, lessons, or project context.",
    "When saving shared memories, include available agent/runtime/machine/Tailnet provenance and use proof: \"auto\" unless explicit proof is requested.",
    "Use hive-handoff, /api/handoff, /handoff-task, or hivemind-mcp for fleet-aware file and task handoffs; ask for a missing task before using task handoff.",
    "Never delete files. Move or archive only when the task explicitly says to do so.",
    `Treat ${folders.kanbanFolder} and ${folders.scheduledFolder} as operational state, not permanent knowledge.`,
    `Treat ${folders.synthesisFolder} as generated or reviewed synthesis, not raw intake.`,
    `Use ${folders.secureFolder} only for explicitly encrypted backup artifacts and credential/public-key reference or status notes.`,
    `Treat ${folders.secureFolder} reference/status notes as searchable full-vault context for credential names and set/missing status only.`,
    "Do not store provider secrets in plaintext in the vault.",
    `Summarize every write in ${operationLogPath} or in the scheduled run note.`,
  ].join("\n- ");
  return `${workflow.intent}

HivemindOS mapping:
- Intake: raw captures, imports, clips, and unsorted request notes.
- Memory: durable notes, daily briefings, weekly reviews, imported sources, and distilled knowledge.
- Projects: project dossiers, decisions, overview notes, and status material.
- Operations: automations, work-board state, agent notifications, wallet notes, and brain-service status.
- Synthesis: Syntho/GBrain-assisted drafts, connection reports, reviewed wiki notes, and agent packs.
- Archive: inactive or superseded material.

Hard rules:
- ${rules}

Read:
${workflow.read.map((item) => `- ${item}`).join("\n")}

Write:
${workflow.write.map((item) => `- ${item}`).join("\n")}

Output standard:
${workflow.outputStandard}`;
}

function scheduleMarkdown(workflow, folders) {
  const config = {
    id: `foundation:${workflow.slug}`,
    name: workflow.name,
    agentName: "Queen Bee",
    machineName: "Foundation Workflows",
    runtime: "openai-compatible",
    enabled: false,
    every: workflow.every,
    mode: "prompt",
    prompt: workflowPrompt(workflow, folders),
    model: "",
    skills: workflow.skills,
    paths: workflow.paths,
    steps: [],
    externalSource: "hivemindos-foundation",
    externalJobId: `foundation:${workflow.slug}`,
    updatedAt: Date.now(),
    usePastRuns: true,
    pastRunLimit: 4,
  };
  return `---
type: hivemindos-schedule
template: foundation-workflow
scheduleId: ${JSON.stringify(config.id)}
scheduleName: ${JSON.stringify(workflow.name)}
device: Foundation Workflows
agentName: Queen Bee
runtime: openai-compatible
enabled: false
every: ${JSON.stringify(workflow.every)}
externalSource: hivemindos-foundation
externalJobId: ${JSON.stringify(config.externalJobId)}
usePastRuns: true
pastRunLimit: 4
---

# ${workflow.name}

Disabled Foundation workflow template. Enable it from the HivemindOS Automations surface after choosing the agent, cadence, model, and approval posture.

## Canonical Outputs

${workflow.write.map((item) => `- ${item}`).join("\n")}

## Prompt

\`\`\`text
${config.prompt}
\`\`\`

## Config JSON

\`\`\`text
${JSON.stringify(config, null, 2)}
\`\`\``;
}

function workflowReadme(folders) {
  const operationLogPath = `${folders.scheduledFolder}/${WORKFLOW_ROOT}/OPERATIONS-LOG.md`;
  return `# Foundation Workflows

Self-writing vault workflows adapted into HivemindOS Foundation.

These templates intentionally keep the article-style capabilities while avoiding the numbered PARA folder scheme. They are disabled by default. Enable one at a time from the dashboard after choosing an agent and reviewing the write policy.

| Article concept | HivemindOS home |
| --- | --- |
| Inbox | Intake |
| Generated | Synthesis and Memory |
| Queue | Operations/Work Board and Intake/Requests |
| Daily Notes | Memory/Daily Briefings |
| System | AGENTS.md, Shared Context.md, Operations |
| Autonomous write logs | ${operationLogPath} and scheduled run notes |

Recommended rollout:

1. Daily Context Generator
2. Queue Processor
3. Connection Finder
4. Weekly Synthesis
5. Project Auto-Updater
6. Meeting Processor
7. Research Ingestion
8. Vault Health Check
9. Decision Journal Review
10. Argument Builder
11. Book Notes Processor
12. Feedback Loop Capture
13. Knowledge Distillation Engine`;
}

function operationLog() {
  return `# Foundation Workflow Operations Log

Append write summaries here when an automation writes outside its scheduled run note.

Format:

- YYYY-MM-DD HH:mm agent/workflow -> path changed -> short reason`;
}

const args = parseArgs(process.argv.slice(2));
const folders = {
  scheduledFolder: safeVaultFolder(args.scheduledFolder ?? process.env.NEXT_PUBLIC_OBSIDIAN_SCHEDULED_FOLDER, DEFAULTS.scheduledFolder),
  synthesisFolder: safeVaultFolder(args.synthesisFolder ?? process.env.NEXT_PUBLIC_OBSIDIAN_SYNTHESIS_FOLDER, DEFAULTS.synthesisFolder),
  brainServicesFolder: safeVaultFolder(args.brainServicesFolder ?? process.env.NEXT_PUBLIC_OBSIDIAN_BRAIN_SERVICES_FOLDER, DEFAULTS.brainServicesFolder),
  secureFolder: safeVaultFolder(args.secureFolder ?? process.env.HIVE_NOTE_SECURE_FOLDER, DEFAULTS.secureFolder),
  kanbanFolder: safeVaultFolder(args.kanbanFolder ?? process.env.NEXT_PUBLIC_OBSIDIAN_KANBAN_FOLDER, DEFAULTS.kanbanFolder),
  notificationsFolder: safeVaultFolder(args.notificationsFolder ?? process.env.NEXT_PUBLIC_OBSIDIAN_NOTIFICATIONS_FOLDER, DEFAULTS.notificationsFolder),
};
const vaultPath = expandHome(args.vault ?? process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH ?? DEFAULTS.vaultPath);

const workflows = [
  {
    slug: "daily-context-generator",
    name: "Daily Context Generator",
    every: "daily 06:00",
    skills: ["gbrain/think", "vault-synthesis"],
    paths: ["Shared Context.md", "Intake", "Memory/Daily Briefings", "Projects", folders.kanbanFolder],
    intent: "Generate a concise morning context note from recent captures, active projects, open loops, and operational state.",
    read: [
      "`Shared Context.md` and `AGENTS.md`",
      "`Memory/Daily Briefings/` most recent notes",
      "`Projects/` active project overview/status notes",
      "`Intake/` captures from the last 48 hours",
      `ready and blocked work in \`${folders.kanbanFolder}\` when readable`,
    ],
    write: [
      "`Memory/Daily Briefings/YYYY-MM-DD.md`",
      `run note under \`${folders.scheduledFolder}/Foundation Workflows/daily-context-generator/\``,
    ],
    outputStandard: "Under 350 words. Sections: Focus, Before Noon, Risks, Open Loops, Suggested First Move. Cite source notes by wikilink or path.",
  },
  {
    slug: "connection-finder",
    name: "Connection Finder",
    every: "weekly Monday 09:00",
    skills: ["gbrain/query", "vault-linker"],
    paths: ["Intake", "Memory", "Projects", folders.synthesisFolder, "Skills"],
    intent: "Find non-obvious links between recent notes and older vault knowledge without auto-editing source notes.",
    read: [
      `notes modified in the last 7 days under \`Intake/\`, \`Memory/\`, \`Projects/\`, \`${folders.synthesisFolder}/\`, and \`Skills/\``,
      "older related notes discovered by search, wikilinks, GBrain, or graph inspection",
    ],
    write: [
      `\`${folders.synthesisFolder}/wiki/synthesis/Connections-YYYY-MM-DD.md\``,
      "`Intake/Requests/` only for suggested follow-up tasks that need human review",
    ],
    outputStandard: "Connection report with source, connected note, connection type, why it matters, and suggested wikilinks. No source-note mutation.",
  },
  {
    slug: "queue-processor",
    name: "Queue Processor",
    every: "every 2 hours",
    skills: ["kanban-orchestrator", "vault-synthesis"],
    paths: ["Intake/Requests", folders.kanbanFolder, folders.synthesisFolder, "Archive/Processed Requests"],
    intent: "Process request notes and work-board queue items asynchronously, then file outputs into the correct HivemindOS layer.",
    read: [
      "`Intake/Requests/` request notes whose filenames start with `RESEARCH-`, `SYNTHESIZE-`, `DRAFT-`, or `ANALYZE-`",
      `ready queue state in \`${folders.kanbanFolder}\``,
      "relevant project, memory, and synthesis source notes",
    ],
    write: [
      `drafts and reports in \`${folders.synthesisFolder}/wiki/.drafts/\` or \`${folders.synthesisFolder}/wiki/synthesis/\``,
      "`Projects/<project>/` only when the request names a project explicitly",
      "`Archive/Processed Requests/` after preserving the original request content",
    ],
    outputStandard: "Produce the requested artifact, then append a short processing report with source paths, destination, and unresolved questions.",
  },
  {
    slug: "weekly-synthesis",
    name: "Weekly Synthesis",
    every: "weekly Sunday 20:00",
    skills: ["vault-synthesis", "journal-synthesis"],
    paths: ["Memory/Daily Briefings", "Projects", folders.synthesisFolder, folders.kanbanFolder],
    intent: "Summarize the week across work, memory, generated outputs, and completed operational tasks.",
    read: [
      "`Memory/Daily Briefings/` notes from the past 7 days",
      "`Projects/` files modified this week",
      `\`${folders.synthesisFolder}/\` outputs modified this week`,
      `done/completed work in \`${folders.kanbanFolder}\` when readable`,
    ],
    write: [
      "`Memory/Weekly Reviews/YYYY-MM-DD.md`",
    ],
    outputStandard: "Sections: Moved Forward, Stalled, Patterns, Top 3 Next Week, Decisions to Make. Be direct and evidence-backed.",
  },
  {
    slug: "project-auto-updater",
    name: "Project Auto-Updater",
    every: "daily 18:00",
    skills: ["kanban-orchestrator", "vault-synthesis"],
    paths: ["Projects", folders.kanbanFolder, "Memory/Daily Briefings"],
    intent: "Keep project overview notes fresh by appending status deltas rather than rewriting project history.",
    read: [
      "`Projects/` files modified in the last 24 hours",
      "matching work-board cards and recent daily briefings",
      "the project overview file when one exists",
    ],
    write: [
      "`Projects/<project>/overview.md` or the existing top-level project note",
      "`Memory/Daily Briefings/YYYY-MM-DD.md` only when a project delta affects tomorrow's context",
    ],
    outputStandard: "Append a dated status delta with Changed, Meaning, Next Action, Risk. Do not replace existing overview prose.",
  },
  {
    slug: "knowledge-distillation-engine",
    name: "Knowledge Distillation Engine",
    every: "monthly first Sunday 19:00",
    skills: ["vault-synthesis", "gbrain/query"],
    paths: ["Memory", "Projects", folders.synthesisFolder, "Skills"],
    intent: "Compress related recent notes into durable reference documents while preserving source trails.",
    read: [
      "`Memory/Imported Sources/` and other durable notes modified in the last 30 days",
      "`Projects/` decisions and retrospectives",
      `reviewed material in \`${folders.synthesisFolder}/wiki/synthesis/\``,
      "`Skills/` only for reusable agent capability knowledge",
    ],
    write: [
      "`Memory/Distillations/YYYY-MM-DD-<topic>.md`",
      `source trails in \`${folders.synthesisFolder}/wiki/sources/\` when useful`,
    ],
    outputStandard: "One distilled insight per note. Include source links, claims, open questions, and when to reuse the distillation.",
  },
  {
    slug: "meeting-processor",
    name: "Meeting Processor",
    every: "every 4 hours",
    skills: ["vault-synthesis", "kanban-orchestrator"],
    paths: ["Intake", "Memory/Meetings", "Projects", folders.kanbanFolder],
    intent: "Turn raw meeting dumps into structured notes, decisions, tasks, and project links without discarding the original notes.",
    read: [
      "`Intake/` notes tagged meeting or whose filename starts with `MEETING-`",
      "`Projects/` notes named by the meeting or detected from attendees/topics",
      `open work-board tasks in \`${folders.kanbanFolder}\` when readable`,
    ],
    write: [
      "`Memory/Meetings/YYYY-MM-DD-<topic>.md`",
      "`Memory/Decision Journal/` only for explicit decisions",
      "`Intake/Requests/` only for follow-up work that needs routing",
    ],
    outputStandard: "Sections: Summary, Decisions, Action Items, Risks, Project Links, Source. Preserve raw source links and assign owners/dates only when present.",
  },
  {
    slug: "research-ingestion",
    name: "Research Ingestion",
    every: "every 3 hours",
    skills: ["vault-synthesis", "gbrain/query"],
    paths: ["Intake", "Memory/Imported Sources", folders.synthesisFolder, "Projects"],
    intent: "Convert captured URLs, transcripts, PDFs, and pasted source notes into source-linked summaries and follow-up questions.",
    read: [
      "`Intake/` notes tagged research or whose filename starts with `SOURCE-`, `URL-`, `PDF-`, or `TRANSCRIPT-`",
      "`Memory/Imported Sources/` related sources",
      "`Projects/` active project context when the source names a project",
    ],
    write: [
      "`Memory/Imported Sources/YYYY-MM-DD-<topic>.md`",
      `\`${folders.synthesisFolder}/wiki/sources/YYYY-MM-DD-<topic>.md\` when a richer source trail is useful`,
      "`Intake/Requests/` for contradictions or follow-up research that needs review",
    ],
    outputStandard: "Include source metadata, concise summary, key claims, contradictions with existing notes, project relevance, and unanswered questions.",
  },
  {
    slug: "vault-health-check",
    name: "Vault Health Check",
    every: "monthly first Monday 09:00",
    skills: ["vault-synthesis", "vault-linker"],
    paths: ["Intake", "Memory", "Projects", "Skills", folders.synthesisFolder, "Operations/Vault Migrations"],
    intent: "Audit the shared brain for stale projects, orphan notes, inconsistent metadata, and notes that need human review.",
    read: [
      "recent and stale notes across `Intake/`, `Memory/`, `Projects/`, `Skills/`, generated synthesis, and Operations/Vault Migrations manifests",
      "frontmatter fields such as type, status, project, review_after, and tags",
      "wikilinks and backlinks when available",
      "the dry-run output of `node scripts/vault-doctor.mjs --vault <vault>` when repository access is available",
    ],
    write: [
      `\`${folders.synthesisFolder}/wiki/synthesis/Vault-Health-YYYY-MM-DD.md\``,
      "`Intake/Requests/` only for maintenance tasks that need human approval",
    ],
    outputStandard: "Report stale projects, orphan notes, missing metadata, inconsistent tags, risky generated notes, duplicate skills, legacy root folders, conflict artifacts, and a prioritized maintenance checklist. Do not mutate source notes unless a human explicitly approves `vault-doctor.mjs --fix`.",
  },
  {
    slug: "decision-journal-review",
    name: "Decision Journal Review",
    every: "monthly first Friday 16:00",
    skills: ["journal-synthesis", "vault-synthesis"],
    paths: ["Memory/Decision Journal", "Projects", "Memory/Weekly Reviews"],
    intent: "Review decisions whose outcome window has arrived and summarize accuracy, bias, and lessons for future choices.",
    read: [
      "`Memory/Decision Journal/` notes with outcome_review due or missing review notes",
      "`Projects/` and `Memory/Weekly Reviews/` entries that show outcomes",
    ],
    write: [
      "`Memory/Decision Journal/YYYY-MM-DD-<topic>.md` only by appending a Review Notes section",
      "`Memory/Distillations/YYYY-MM-DD-decision-patterns.md` when durable lessons emerge",
    ],
    outputStandard: "Sections: Decision, Expected, Actual, What Was Missed, Pattern, Future Rule. Append instead of rewriting the original decision.",
  },
  {
    slug: "argument-builder",
    name: "Argument Builder",
    every: "manual",
    skills: ["vault-synthesis", "gbrain/query"],
    paths: ["Intake/Requests", "Memory", "Projects", folders.synthesisFolder],
    intent: "Build an evidence-backed outline for a thesis, proposal, article, pitch, or presentation request.",
    read: [
      "`Intake/Requests/` notes whose filenames start with `ARGUMENT-`, `THESIS-`, `PROPOSAL-`, or `PITCH-`",
      "supporting evidence across `Memory/`, `Projects/`, and reviewed synthesis",
    ],
    write: [
      `\`${folders.synthesisFolder}/wiki/.drafts/YYYY-MM-DD-<topic>-argument.md\``,
    ],
    outputStandard: "State the thesis, strongest evidence, counterpoints, missing proof, suggested structure, and source links. Mark weak evidence clearly.",
  },
  {
    slug: "book-notes-processor",
    name: "Book Notes Processor",
    every: "weekly Saturday 11:00",
    skills: ["vault-synthesis", "gbrain/query"],
    paths: ["Intake", "Memory/Book Notes", "Memory/Distillations", "Projects"],
    intent: "Turn book highlights or reading notes into reusable ideas connected to active projects and durable memory.",
    read: [
      "`Intake/` notes tagged book or whose filename starts with `BOOK-`",
      "`Memory/Book Notes/` existing notes by the same author/topic",
      "`Projects/` active project notes that could use the ideas",
    ],
    write: [
      "`Memory/Book Notes/<title>.md`",
      "`Memory/Distillations/YYYY-MM-DD-<topic>.md` for reusable ideas",
    ],
    outputStandard: "Sections: Core Ideas, Connections, Project Uses, Actions, Further Reading. Separate the author's claim from Liam's application.",
  },
  {
    slug: "feedback-loop-capture",
    name: "Feedback Loop Capture",
    every: "daily 21:00",
    skills: ["vault-synthesis"],
    paths: [folders.synthesisFolder, "Memory", "Projects", "Shared Context.md"],
    intent: "Review generated agent outputs and preserve only useful human-reviewed synthesis or project context.",
    read: [
      `agent outputs tagged ai-generated under \`${folders.synthesisFolder}/\``,
      "`Projects/` notes that received generated drafts",
      "`Shared Context.md` for current priorities",
    ],
    write: [
      "`Memory/Distillations/YYYY-MM-DD-<topic>.md` only for durable insights",
      "`Projects/<project>/overview.md` only by appending dated project-relevant deltas",
      `\`${folders.synthesisFolder}/wiki/synthesis/AI-Outputs-YYYY-MM-DD.md\` for review summaries`,
    ],
    outputStandard: "Classify outputs as Keep, Revise, Archive, or Ignore. Explain why, link sources, and avoid reinforcing low-confidence generated claims.",
  },
];

await mkdir(vaultPath, { recursive: true });
await Promise.all([
  "Intake",
  "Intake/Requests",
  "Intake/Sources",
  ".hivemindos-transfers",
  "Memory",
  "Memory/Book Notes",
  "Memory/Daily Briefings",
  "Memory/Decision Journal",
  "Memory/Weekly Reviews",
  "Memory/Meetings",
  "Memory/Imported Sources",
  "Memory/Distillations",
  "Memory/Distillations/Agent Memory",
  "Projects",
  "Operations",
  "Templates",
  "Templates/HivemindOS",
  folders.secureFolder,
  "Operations/Runtime Mirrors",
  folders.scheduledFolder,
  join(folders.scheduledFolder, WORKFLOW_ROOT),
  folders.kanbanFolder,
  folders.notificationsFolder,
  folders.brainServicesFolder,
  join(folders.brainServicesFolder, "Queen Bee"),
  join(folders.brainServicesFolder, "Queen Bee", "nodes"),
  join(folders.brainServicesFolder, "Queen Bee", "inbox"),
  join(folders.brainServicesFolder, "Queen Bee", "outbox"),
  folders.synthesisFolder,
  `${folders.synthesisFolder}/raw`,
  `${folders.synthesisFolder}/wiki/.drafts`,
  `${folders.synthesisFolder}/wiki/sources`,
  `${folders.synthesisFolder}/wiki/queries`,
  `${folders.synthesisFolder}/wiki/synthesis`,
  `${folders.synthesisFolder}/pack`,
  "Archive",
  "Archive/Processed Requests",
].map((folder) => mkdir(join(vaultPath, folder), { recursive: true })));

const obsidianCliPath = await findExecutable([
  process.env.OBSIDIAN_CLI_PATH,
  "~/.local/bin/obsidian",
  "obsidian",
]);

await writeIfMissing(join(vaultPath, "Operations", "AI-Ready Vault Contract.md"), vaultContract(folders));
await writeIfMissing(join(vaultPath, "Templates", "HivemindOS", "README.md"), templatesReadme());
for (const template of ["daily-briefing", "weekly-review", "meeting", "research-source", "decision", "project", "book-note", "distillation", "ai-output"]) {
  await writeIfMissing(join(vaultPath, "Templates", "HivemindOS", `${template}.md`), templateMarkdown(template));
}
await writeIfMissing(join(vaultPath, folders.brainServicesFolder, "Obsidian Plugin Pack.md"), obsidianPluginPack());
await writeIfMissing(join(vaultPath, folders.brainServicesFolder, "Obsidian CLI.md"), obsidianCliNote(obsidianCliPath));
await writeIfMissing(join(vaultPath, folders.brainServicesFolder, "Obsidian Native Brain Pack.md"), obsidianNativeBrainPackNote());
await writeIfMissing(join(vaultPath, folders.brainServicesFolder, "Agent Memory.base"), agentMemoryBase());
await writeIfMissing(join(vaultPath, folders.brainServicesFolder, "Project Brain.base"), projectBrainBase());
await writeIfMissing(join(vaultPath, folders.brainServicesFolder, "Secure References.base"), secureReferencesBase(folders));
await writeIfMissing(join(vaultPath, folders.brainServicesFolder, "Whole Brain.canvas"), wholeBrainCanvas(folders));
const queenBeeFolder = join(vaultPath, folders.brainServicesFolder, "Queen Bee");
await writeIfMissing(join(queenBeeFolder, "README.md"), queenBeeReadme());
await writeIfMissing(join(queenBeeFolder, "Identity.md"), queenBeeIdentityMarkdown());
await writeIfMissing(join(queenBeeFolder, "Routing Policy.md"), queenBeeRoutingPolicyMarkdown());
await writeIfMissing(join(queenBeeFolder, "Safety Policy.md"), queenBeeSafetyPolicyMarkdown());
await writeIfMissing(join(queenBeeFolder, "Current State.md"), queenBeeCurrentStateMarkdown());
await writeIfMissing(join(queenBeeFolder, "state.json"), JSON.stringify({
  protocol: "hivemind-queen-bee",
  version: 1,
  identity: "logical-queen-bee",
  status: "ready",
  workBoard: folders.kanbanFolder,
  memory: "Memory/Distillations/Agent Memory + Operations/Brain Services/Agent Memory Index.jsonl",
  fleet: "/api/fleet/discover + /api/fleet/apps",
  handoff: "/api/handoff + .hivemindos-transfers/",
}, null, 2));
await writeIfMissing(join(queenBeeFolder, "nodes", "README.md"), "# Queen Bee Nodes\n\nOptional machine snapshots and annotations. Live availability comes from `/api/fleet/discover` and `/api/fleet/apps`.\n");
await writeIfMissing(join(queenBeeFolder, "inbox", "README.md"), "# Queen Bee Inbox\n\nOptional append-only request intake for runtimes that cannot call `/api/queen-bee` directly.\n");
await writeIfMissing(join(queenBeeFolder, "outbox", "README.md"), "# Queen Bee Outbox\n\nOptional response receipts for runtimes that cannot receive live API responses.\n");
await writeIfMissing(join(queenBeeFolder, "intent-dedupe.jsonl"), "");
await writeIfMissing(join(queenBeeFolder, "leases.jsonl"), "");
await writeIfMissing(join(queenBeeFolder, "receipts.jsonl"), "");
await writeIfMissing(join(vaultPath, folders.scheduledFolder, WORKFLOW_ROOT, "README.md"), workflowReadme(folders));
await writeIfMissing(join(vaultPath, folders.scheduledFolder, WORKFLOW_ROOT, "OPERATIONS-LOG.md"), operationLog());

let created = 0;
for (const workflow of workflows) {
  const path = join(vaultPath, folders.scheduledFolder, WORKFLOW_ROOT, workflow.slug, "schedule.md");
  if (await writeIfMissing(path, scheduleMarkdown(workflow, folders))) created += 1;
}

console.log(`Seeded HivemindOS Foundation workflows: ${created} created, ${workflows.length - created} already present.`);
