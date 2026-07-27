import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildListmonkComposeYaml,
  LISTMONK_IMAGE,
  LISTMONK_POSTGRES_IMAGE,
  LISTMONK_VERSION,
} from "../src/lib/services/listmonk-compose.ts";

assert.equal(LISTMONK_VERSION, "6.1.0");
assert.match(LISTMONK_IMAGE, /^listmonk\/listmonk@sha256:[a-f0-9]{64}$/);
assert.match(LISTMONK_POSTGRES_IMAGE, /^postgres@sha256:[a-f0-9]{64}$/);

const compose = buildListmonkComposeYaml();
assert.match(compose, /127\.0\.0\.1:9000:9000/);
assert.match(compose, /--install --idempotent --yes/);
assert.match(compose, /listmonk-postgres:\/var\/lib\/postgresql\/data/);
assert.doesNotMatch(compose.match(/  postgres:[\s\S]*?(?=volumes:)/)?.[0] ?? "", /ports:/);

const tempDir = mkdtempSync(join(tmpdir(), "hivemindos-listmonk-compose-"));
try {
  const composePath = join(tempDir, "compose.yaml");
  const envPath = join(tempDir, "service.env");
  writeFileSync(composePath, compose, { encoding: "utf8", mode: 0o600 });
  writeFileSync(envPath, "LISTMONK_DB_PASSWORD=test-only-not-a-secret\n", { encoding: "utf8", mode: 0o600 });
  execFileSync("docker", ["compose", "--env-file", envPath, "--file", composePath, "config", "--quiet"], { stdio: "pipe" });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

const installable = readFileSync("src/lib/services/listmonk-installable.ts", "utf8");
const route = readFileSync("src/app/api/fleet/apps/installable-services/route.ts", "utf8");
const catalog = readFileSync("src/features/dashboard/agent-capability-catalog.ts", "utf8");
const providers = readFileSync("src/lib/services/external-agent-providers.ts", "utf8");
const panel = readFileSync("src/features/dashboard/views/MyAppsPanel.tsx", "utf8");

assert.match(installable, /This installs campaign and transactional-email software, not an inbox/);
assert.match(installable, /SMTP delivery is intentionally not bundled/);
assert.match(installable, /flag: "wx"/);
assert.match(installable, /0o600/);
assert.match(route, /value === "listmonk"/);
assert.match(catalog, /installableServiceId: "listmonk"/);
assert.match(providers, /id: "listmonk"/);
assert.match(panel, /\| "listmonk"/);

console.log("Listmonk installable service, immutable images, localhost binding, durable volumes, and email boundary checks passed.");
