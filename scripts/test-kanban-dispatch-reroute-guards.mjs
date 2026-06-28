#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/features/dashboard/hooks/use-kanban-dispatch-controller.tsx", import.meta.url),
  "utf8",
);

assert(
  source.includes("markKanbanTaskNeedsHumanFromDashboardDispatch"),
  "Dashboard dispatch failures must go through the stale-owner guard before moving cards to Needs You.",
);

assert(
  source.includes('startsWith("queen-bee-autonomous:")'),
  "Dashboard dispatch failures must not mark cards Needs You while Queen Bee autonomous pickup owns the claim.",
);

assert(
  /if \(options\.leaveKanbanOpen\) \{\s*return \{ ok: false, message \};\s*\}/m.test(source),
  "Retry orchestration must receive ok:false without a Needs You patch when leaveKanbanOpen is set.",
);

assert(
  !/if \(task\.targetMachine\?\.key\) \{\s*await patchKanbanTask\(task\.id, \{\s*status: "needs-human"/m.test(source),
  "Target-machine dispatch failures must not bypass the stale-owner guard.",
);

assert(
  (source.match(/markKanbanTaskNeedsHumanFromDashboardDispatch\(/g) ?? []).length >= 4,
  "All dashboard dispatch/session stall Needs You writes should use the stale-owner guard.",
);

console.log("Kanban dispatch reroute guard tests passed.");
