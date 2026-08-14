import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hivePanelSource = readFileSync("src/components/fleet-hive/HivePanel.tsx", "utf8");
const fleetHiveViewSource = readFileSync("src/components/fleet-hive/FleetHiveView.tsx", "utf8");
const derivedStateSource = readFileSync("src/features/dashboard/hooks/use-dashboard-derived-state.tsx", "utf8");
const machineNameEditor = hivePanelSource.match(
  /function MachineNameEditor[\s\S]*?\n}\n\nfunction FrPhoneStatusRow/,
)?.[0] ?? "";

assert.match(
  hivePanelSource,
  /onRenameMachine\?: \(m: HiveMachine, name: string\) => void/,
  "the Hive panel rename handler should accept the inline editor's saved name",
);
assert.match(
  machineNameEditor,
  /<h2[\s\S]*?>\{machine\.name}<\/h2>[\s\S]*?<Pencil/,
  "the pencil control should render beside the machine heading",
);
assert.match(
  machineNameEditor,
  /React\.useLayoutEffect\([\s\S]*?new ResizeObserver\(fitName\)[\s\S]*?observer\.observe\(row\)/,
  "the machine heading should refit when its available width changes",
);
assert.match(
  machineNameEditor,
  /fontSize: machineNameFontSize[\s\S]*?whiteSpace: "nowrap"/,
  "long machine names should shrink while remaining fully visible on one line",
);
assert.doesNotMatch(
  machineNameEditor,
  /flexWrap: "wrap"|overflowWrap: "anywhere"/,
  "the machine heading should not wrap long names",
);
assert.match(
  machineNameEditor,
  /const \[editing, setEditing] = React\.useState\(false\)[\s\S]*?<input[\s\S]*?value=\{draft}/,
  "pressing the pencil should swap the heading for a controlled input",
);
assert.match(
  machineNameEditor,
  /<form[\s\S]*?onSubmit=[\s\S]*?saveRename\(\)[\s\S]*?<button[\s\S]*?type="submit"[\s\S]*?<Check/,
  "rename mode should expose a check button that submits the edited name",
);
assert.match(
  machineNameEditor,
  /<button[\s\S]*?aria-label=\{`Cancel renaming \$\{machine\.name}`\}[\s\S]*?onClick=\{cancelRename\}[\s\S]*?<X/,
  "rename mode should expose an X button that cancels the edit",
);
assert.match(
  machineNameEditor,
  /event\.key === "Escape"[\s\S]*?cancelRename\(\)/,
  "Escape should use the same non-saving cancel path as the X button",
);
assert.match(
  machineNameEditor,
  /onRenameMachine\?\.\(machine, normalizedDraft\)/,
  "saving should send the trimmed draft through the real rename handler",
);
assert.doesNotMatch(
  hivePanelSource,
  />\s*Rename\s*</,
  "the machine action cluster should no longer include a standalone Rename chip",
);
assert.doesNotMatch(
  fleetHiveViewSource,
  /window\.prompt\(/,
  "the Hive rename flow should not fall back to a browser prompt",
);
assert.match(
  fleetHiveViewSource,
  /onRenameMachine: onRenameMachine \? \(m, name\) => onRenameMachine\(m\.id, name\) : undefined/,
  "the Hive adapter should forward the edited name with the stable machine id",
);
assert.match(
  derivedStateSource,
  /setMachineNameAliases\(\(current\) =>[\s\S]*?next\[machineId\] = normalized/,
  "the dashboard rename handler should update the displayed machine alias",
);
assert.match(
  derivedStateSource,
  /fetch\("\/api\/obsidian\/machine-aliases"[\s\S]*?machineKey: machineId[\s\S]*?name: normalized/,
  "the dashboard rename handler should retain its Shared Brain persistence path",
);

console.log("fleet hive inline machine rename contract ok");
