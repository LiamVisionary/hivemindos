#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-hive-query-"));
process.env.HOME = tempHome;
process.env.GH_GLOBAL = "test-secret-that-must-not-appear";

try {
  const { executeHiveQuery } = await import("../src/lib/services/hive-query.ts");
  const { getVisualArtifact } = await import("../src/lib/services/visual-artifacts.ts");
  const { localAdminPrincipal } = await import("../src/lib/types/principal.ts");
  const principal = localAdminPrincipal("tester", "session");

  const result = await executeHiveQuery({
    connectorKey: "github",
    operationId: "connection-status",
    createArtifact: true,
    title: "GitHub connector status",
  }, principal);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].connector, "github");
  assert.equal(result.rows[0].connected, true);
  assert.equal(result.receipts[0].credentialStatus.GH_GLOBAL, "set");
  assert.ok(result.artifact?.artifact.id);

  const serialized = JSON.stringify(result);
  assert.ok(serialized.includes("GH_GLOBAL"));
  assert.ok(!serialized.includes("test-secret-that-must-not-appear"));

  const stored = await getVisualArtifact(result.artifact.artifact.id);
  assert.equal(stored.artifact.kind, "query-result");
  assert.ok(stored.artifact.blocks.some((block) => block.type === "table"));
  assert.ok(stored.artifact.blocks.some((block) => block.type === "source-receipt"));

  await assert.rejects(
    () => executeHiveQuery({ connectorKey: "clawbank", operationId: "clawbank-money-action" }, principal),
    /read-only manifest operations/,
  );

  console.log("Hive Query sandbox tests passed.");
} finally {
  delete process.env.GH_GLOBAL;
  await rm(tempHome, { recursive: true, force: true });
}
