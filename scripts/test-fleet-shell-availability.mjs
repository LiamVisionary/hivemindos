import { register } from "node:module";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Guards the fleet Shell panel's Windows story (observed live 2026-07-17):
// 1. Windows hivemind-linkd builds run without the shell service, so the
//    dashboard must gate the Shell affordance per machine — capability flag
//    first, OS fallback — instead of offering a terminal that can never work.
// 2. linkd failure paths answer with PLAIN-TEXT bodies ("hivemind-linkd proxy
//    error: dial tcp ..."), which used to crash the panel with a raw JSON
//    parse error; the shell route must wrap them as readable { ok, error }.
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { machineRemoteShellAvailable, isWindowsMachineOs } = await import(
  "../src/features/fleet/fleet-identity.ts"
);
const { shellEnvelopeFromUpstream } = await import(
  "../src/app/api/fleet/shell/shell-target.ts"
);

// ── OS fallback: both Windows spellings block, unix/unknown allow ────────────
assert.equal(isWindowsMachineOs("windows"), true, "native-bridge spelling");
assert.equal(isWindowsMachineOs("win32"), true, "process.platform spelling");
assert.equal(isWindowsMachineOs("macOS"), false);
assert.equal(machineRemoteShellAvailable("windows"), false, "Windows machines get no shell affordance");
assert.equal(machineRemoteShellAvailable("win32"), false, "win32 spelling blocks too");
assert.equal(machineRemoteShellAvailable("macOS"), true);
assert.equal(machineRemoteShellAvailable("linux"), true);
assert.equal(
  machineRemoteShellAvailable(undefined),
  true,
  "unknown OS keeps legacy behavior (shell offered; route errors are readable)",
);

// ── Capability wins over the OS fallback in both directions ──────────────────
assert.equal(
  machineRemoteShellAvailable("windows", true),
  true,
  "a future Windows linkd reporting remoteShell:true must open the gate with no dashboard change",
);
assert.equal(
  machineRemoteShellAvailable("macOS", false),
  false,
  "a machine reporting remoteShell:false (e.g. -shell=false linkd) must gate even on unix",
);

// ── Shell route forwards JSON upstream bodies verbatim ───────────────────────
const okBody = shellEnvelopeFromUpstream('{"ok":true,"lines":["$ ls"]}', 200);
assert.deepEqual(okBody, { payload: { ok: true, lines: ["$ ls"] }, status: 200 });
const jsonError = shellEnvelopeFromUpstream('{"ok":false,"error":"missing command"}', 400);
assert.deepEqual(jsonError, { payload: { ok: false, error: "missing command" }, status: 400 });

// ── Plain-text linkd bodies become readable { ok, error } lines ──────────────
const proxyText =
  "hivemind-linkd proxy error: dial tcp 127.0.0.1:8787: connectex: No connection could be made because the target machine actively refused it.";
const wrapped = shellEnvelopeFromUpstream(proxyText, 502);
assert.equal(wrapped.status, 502);
assert.equal(wrapped.payload.ok, false);
assert.match(
  wrapped.payload.error,
  /hivemind-linkd proxy error/,
  "the upstream text must surface as the error line, not a JSON parse crash",
);

// Non-JSON with a 2xx status is still an upstream failure.
const misleadingOk = shellEnvelopeFromUpstream("<html>404 page</html>", 200);
assert.equal(misleadingOk.status, 502, "non-JSON 2xx must not report success");
assert.equal(misleadingOk.payload.ok, false);

// Empty bodies get an explanatory message instead of an empty error line.
const empty = shellEnvelopeFromUpstream("", 502);
assert.equal(empty.payload.ok, false);
assert.match(empty.payload.error, /HTTP 502/);

// ── UI wiring: the terminal modal + fleet chips honor the gate ───────────────
const modal = await readFile(
  new URL("../src/components/fleet/machine-terminal-modal.tsx", import.meta.url),
  "utf8",
);
assert.match(
  modal,
  /machine\.remoteShell === false/,
  "terminal modal must gate on the machine's remoteShell availability",
);
assert.match(
  modal,
  /if \(shellUnavailable\) return;/,
  "terminal modal must not open the SSE stream for shell-less machines",
);
assert.match(
  modal,
  /Remote shell isn't available on \$\{machine\.name\}/,
  "terminal modal must explain the unavailable state",
);

const hivePanelActions = await readFile(
  new URL("../src/components/fleet-hive/HivePanelActions.tsx", import.meta.url),
  "utf8",
);
assert.match(
  hivePanelActions,
  /machine\.source\.remoteShell === false/,
  "hive panel Shell action must gate on remoteShell",
);

const listMachineActions = await readFile(
  new URL("../src/components/fleet/list-view-machine-actions.tsx", import.meta.url),
  "utf8",
);
assert.match(
  listMachineActions,
  /machine\.remoteShell === false/,
  "fleet List Shell action must gate on remoteShell",
);

const tooltip = await readFile(
  new URL("../src/components/fleet/selection-tooltip.tsx", import.meta.url),
  "utf8",
);
assert.match(
  tooltip,
  /machine\.remoteShell === false/,
  "fleet selection tooltip Terminal button must gate on remoteShell",
);

console.log("fleet shell availability checks passed");
