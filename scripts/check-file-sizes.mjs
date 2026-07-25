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
  ["src/app/api/chat/agent-runtime/route.ts", 580],
  ["src/app/chat.module.css", 3813],
  ["src/app/fleet.module.css", 4722],
  ["src/app/kanban-board.module.css", 4528],
  ["src/app/vault.module.css", 1568],
  // 2026-07-04: +2 for the needs-human answer controller wiring (import + hook
  // call; the logic itself lives in use-kanban-needs-human-controller.tsx).
  // 2026-07-04: +12 for the KanbanPanel handler-stabilization perf fix (import +
  // useStableHandlers block; mechanism lives in use-stable-handlers.ts).
  // 2026-07-04: +14 for the notification→task deep-link reveal wiring (ref
  // bridge to the nav controller + openKanbanTaskConversation bee-pilot dep;
  // the flight logic lives in bee-pilot/reveal-kanban-task.ts).
  ["src/features/dashboard/DashboardApp.tsx", 4752],
  ["src/lib/services/hive-actions/catalog.ts", 1633],
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
  ["scripts/agent-telemetry-collector.mjs", 8187],
  // 2026-07-02: +18 for the non-string task.result/body read+write coercion fix
  // (one poisoned task was 400ing every /api/kanban read).
  // 2026-07-04: +57 for answerHumanTask — the needs-human answer mutation
  // (answer into body, comment, back to Ready with assignee preserved). It uses
  // the store's private withBoardMutation/event/touch internals, so it lives here.
  // 2026-07-07: +48 for outreach revenue completion fail-closed wiring; the
  // reusable policy parser lives in kanban/outreach-safeguards.ts.
  ["src/lib/services/kanban/local-kanban-store.ts", 2538],
  ["src/features/dashboard/hooks/use-dashboard-derived-state.tsx", 2244],
  ["src/features/dashboard/views/chat/HiveChatView.module.css", 1802],
  ["src/lib/services/obsidian/agent-memory/core.ts", 1850],
  ["src/components/wallets-drop-in/WalletsView.tsx", 1850],
  ["src/app/globals.css", 1719],
  // +50 2026-07-03: aeon-mirror plague root fixes (no doubled-prefix minting,
  // all-roots mirror guard, vault->aeon GC) with incident comments in place.
  ["src/lib/services/obsidian/brain-skills.ts", 1675],
  ["src/lib/services/context-index.ts", 1680],
  ["src/features/dashboard/hooks/use-status-chat-input-controller.tsx", 1660],
  ["src/features/dashboard/views/chat/AgentSettingsModal.tsx", 1640],
  ["src/components/fleet/fleet-tokens.module.css", 1540],
  ["src/features/dashboard/views/chat/UsePodSetup.module.css", 1540],
  ["src/features/dashboard/hooks/use-miroshark-brain-controller.tsx", 1580],
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
