#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const MAX_LINES = 1500;
const root = process.cwd();

const ignoredDirectories = new Set([
  ".evo",
  ".git",
  ".next",
  ".next-tauri",
  ".next-tauri-build",
  ".next-tauri-static-build",
  // Gitignored benchmark/eval data dumps; only local runs ever see them.
  ".outputs",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "promo-videos",
  "remotion",
]);

const ignoredRelativeDirectories = new Set([
  "apps/zimage-mobile-tauri/src-tauri/gen",
  "design-system",
  // Pinned third-party HyperFrames compiler + measured-font data. These are
  // provenance-locked package resources, not HivemindOS application modules.
  "packaged-skills/auto-install/embedded-captions",
  "public/design-system",
  "src-tauri/gen",
  // Generated per-platform release payload. Its collector source is checked at
  // the canonical scripts/ path; counting the staged copy would duplicate it.
  "src-tauri/link-runtime",
  "src-tauri/static",
  "src-tauri/target",
]);

const ignoredFiles = new Set([
  "CHANGELOG.md",
  "ASSIMILATION_LOG.md",
  "agents-lock.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "skills-lock.json",
  "yarn.lock",
]);

const checkedExtensions = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".scss",
  ".ts",
  ".tsx",
]);

const legacyOversizedAllowances = new Map([
  // Ratchet re-baselined 2026-07-17: fd4581152 ("TONS of improvements") landed
  // without the gate running, growing eleven entries past their watermarks and
  // pushing seven new files over 1500 (added at the bottom of this map).
  // Watermarks set to the line counts at that HEAD; shrinking a file should
  // lower its entry, growth fails the gate.
  ["src/app/api/chat/agent-runtime/route.ts", 580],
  ["src/app/chat.module.css", 3878],
  ["src/app/fleet.module.css", 4729],
  ["src/app/kanban-board.module.css", 4642],
  ["src/app/vault.module.css", 1568],
  // 2026-07-04: +2 for the needs-human answer controller wiring (import + hook
  // call; the logic itself lives in use-kanban-needs-human-controller.tsx).
  // 2026-07-04: +12 for the KanbanPanel handler-stabilization perf fix (import +
  // useStableHandlers block; mechanism lives in use-stable-handlers.ts).
  // 2026-07-04: +14 for the notification→task deep-link reveal wiring (ref
  // bridge to the nav controller + openKanbanTaskConversation bee-pilot dep;
  // the flight logic lives in bee-pilot/reveal-kanban-task.ts).
  // 2026-07-18: −80 vs origin/main, chat transcript identity/split helpers to
  // features/dashboard/chat-transcript-helpers.ts. (Near-copies of some of them
  // still live in dashboard-storage.ts and use-dashboard-derived-state.tsx and
  // have already drifted — collapsing those is a behavior call, left as
  // follow-up.) Watermark carries ~2 lines of slack over clean HEAD because it
  // was measured in a working tree with concurrent uncommitted edits.
  ["src/features/dashboard/DashboardApp.tsx", 4777],
  ["src/lib/services/hive-actions/catalog.ts", 1817],
  ["src/features/dashboard/views/AeonAutopilotPanel.tsx", 3857],
  // Ratchet re-baselined 2026-07-02: watermarks set to then-current line counts
  // (files had silently grown past the old allowances while the gate wasn't run
  // in CI). Shrinking a file should lower its entry; growth fails the gate.
  // 2026-07-02: +5 for the cached /apps discovery sweep (logic itself lives in
  // scripts/lib/hosted-apps-cache.mjs; only the import + wiring is here).
  // 2026-07-03: +29 for /chat abort wiring — client disconnect now SIGTERMs
  // the spawned hermes CLI instead of leaving a 20-min zombie worker (hel1-2
  // pile-up amplifier); kill-switch AGENT_TELEMETRY_CHAT_ABORT_KILL=0.
  // 2026-07-03: +35 for startSyncthingViaServiceManager — syncthing recovery
  // now starts the installer-managed unit instead of racing it with a detached
  // spawn (hel1-2 DB-lock crash-loop, 400k+ restarts).
  // 2026-07-18: −59, the self-reload watcher moved to lib/collector-self-reload.mjs
  // with injectable deps; the Windows exit-75 contract that used to be pinned by
  // a source-text regex is now a behavioral unit test.
  ["scripts/agent-telemetry-collector.mjs", 9692],
  // 2026-07-02: +18 for the non-string task.result/body read+write coercion fix
  // (one poisoned task was 400ing every /api/kanban read).
  // 2026-07-04: +57 for answerHumanTask — the needs-human answer mutation
  // (answer into body, comment, back to Ready with assignee preserved). It uses
  // the store's private withBoardMutation/event/touch internals, so it lives here.
  // 2026-07-07: +48 for outreach revenue completion fail-closed wiring; the
  // reusable policy parser lives in kanban/outreach-safeguards.ts.
  // 2026-07-18: −127, deliverable extraction helpers moved to
  // kanban/deliverable-extraction.ts. The cut stops before mergeDeliverables /
  // sourceDeliverableKeys, which still reach back into store internals.
  ["src/lib/services/kanban/local-kanban-store.ts", 2465],
  ["src/features/dashboard/hooks/use-dashboard-derived-state.tsx", 2244],
  ["src/features/dashboard/views/chat/HiveChatView.module.css", 1802],
  ["src/lib/services/obsidian/agent-memory/core.ts", 1901],
  ["src/components/wallets-drop-in/WalletsView.tsx", 2183],
  ["src/app/globals.css", 1719],
  // +50 2026-07-03: aeon-mirror plague root fixes (no doubled-prefix minting,
  // all-roots mirror guard, vault->aeon GC) with incident comments in place.
  ["src/lib/services/obsidian/brain-skills.ts", 1675],
  ["src/lib/services/context-index.ts", 1680],
  // 2026-07-18: −169, the composer/quick-add/steer attachment + linked-directory
  // handlers moved to hooks/status-chat-composer-attachments.ts (a plain factory
  // — the block touched no hook state and no React hooks). The controller's
  // return shape is unchanged; DashboardApp still destructures all 23 names.
  ["src/features/dashboard/hooks/use-status-chat-input-controller.tsx", 1751],
  ["src/features/dashboard/views/chat/AgentSettingsModal.tsx", 1640],
  ["src/components/fleet/fleet-tokens.module.css", 1541],
  ["src/features/dashboard/views/chat/UsePodSetup.module.css", 1540],
  ["src/features/dashboard/hooks/use-miroshark-brain-controller.tsx", 1580],
  // 2026-07-17 (fd4581152): first crossed 1500 in that commit. The barely-over
  // three (dashboard-display-helpers, stream-openai-compatible, fleet-hive.css)
  // are the cheapest split candidates — extract, then delete their entries.
  // 2026-07-18: src/app/api/fleet/discover/route.ts dropped off this map — its
  // tailnet device identity/dedupe helpers moved to fleet/discover-devices.ts,
  // taking it from 1613 to 1365, back under the 1500 cap outright.
  // 2026-07-18: LM Studio server autostart moved to lm-studio-autostart.ts and
  // the capability-tool health tracker to invoke-hive-capability-tool.ts,
  // holding the file under its watermark after the capability-rail hardening.
  ["src/app/api/chat/agent-runtime/stream-openai-compatible.ts", 1506],
  ["src/app/api/phone/route.ts", 1544],
  ["src/components/fleet-hive/fleet-hive.css", 1516],
  ["src/features/dashboard/dashboard-display-helpers.tsx", 1519],
  ["src/lib/services/nansen.ts", 1640],
  // 2026-07-18: src/lib/types/agent-runtime.ts dropped off this map — the voice/
  // calls + ministry preference types moved to types/agent-call-preferences.ts,
  // taking it from 1556 to 1397. agent-runtime.ts re-exports them so none of the
  // 13 existing consumers had to change.
]);

function isIgnoredDirectory(directory) {
  const relativeDirectory = path.relative(root, directory);
  if (ignoredRelativeDirectories.has(relativeDirectory)) {
    return true;
  }

  return ignoredDirectories.has(path.basename(directory));
}

function isCheckedFile(filePath) {
  const basename = path.basename(filePath);

  if (ignoredFiles.has(basename)) {
    return false;
  }

  return checkedExtensions.has(path.extname(filePath));
}

function lineCount(filePath) {
  const source = readFileSync(filePath, "utf8");

  if (source.length === 0) {
    return 0;
  }

  return source.split(/\r\n|\r|\n/).length;
}

function walk(directory, results) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const entryPath = path.join(directory, entry.name);
      if (!isIgnoredDirectory(entryPath)) {
        walk(entryPath, results);
      }

      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(directory, entry.name);

    if (!isCheckedFile(filePath)) {
      continue;
    }

    const stats = statSync(filePath);

    if (stats.size === 0) {
      continue;
    }

    const lines = lineCount(filePath);

    if (lines > MAX_LINES) {
      results.push({
        lines,
        relativePath: path.relative(root, filePath),
      });
    }
  }
}

const oversizedFiles = [];
walk(root, oversizedFiles);
oversizedFiles.sort((left, right) => right.lines - left.lines);

const newOversizedFiles = [];
const legacyOversizedFiles = [];

for (const file of oversizedFiles) {
  const allowedLines = legacyOversizedAllowances.get(file.relativePath);
  if (allowedLines && file.lines <= allowedLines) {
    legacyOversizedFiles.push({ ...file, allowedLines });
    continue;
  }

  newOversizedFiles.push({
    ...file,
    allowedLines,
  });
}

if (newOversizedFiles.length > 0) {
  console.error(`Files over ${MAX_LINES} lines:`);

  for (const file of newOversizedFiles) {
    const allowance = file.allowedLines ? `, legacy allowance ${file.allowedLines}` : "";
    console.error(`- ${file.relativePath} (${file.lines} lines${allowance})`);
  }

  process.exitCode = 1;
} else {
  console.log(`All checked files are ${MAX_LINES} lines or fewer.`);
  if (legacyOversizedFiles.length > 0) {
    console.log(`Legacy oversized files are within their no-growth allowance:`);
    for (const file of legacyOversizedFiles) {
      console.log(`- ${file.relativePath} (${file.lines}/${file.allowedLines} lines)`);
    }
  }
}
