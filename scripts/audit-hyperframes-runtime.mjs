#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "production";
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  HYPERFRAMES_RUNTIME_VERSION,
  installHyperframesRuntime,
  uninstallHyperframesRuntime,
} = await import("../src/lib/services/hyperframes-runtime.ts");

const auditHome = await mkdtemp(join(tmpdir(), "hivemindos-hyperframes-audit-"));
try {
  const installed = await installHyperframesRuntime({ homeDirectory: auditHome });
  assert.equal(installed.installed, true);
  assert.equal(installed.components.find((component) => component.id === "hyperframes")?.version, HYPERFRAMES_RUNTIME_VERSION);
  assert.equal(installed.provenance.telemetry, "disabled-by-managed-wrapper");

  const removed = await uninstallHyperframesRuntime({ homeDirectory: auditHome });
  assert.equal(removed.installed, false);
  console.log(`Pinned HyperFrames ${HYPERFRAMES_RUNTIME_VERSION} isolated install and removal passed.`);
} finally {
  await rm(auditHome, { recursive: true, force: true });
}
