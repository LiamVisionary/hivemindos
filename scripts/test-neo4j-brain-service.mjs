import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const collapse = (text) => text.replace(/\s+/g, " ");
const has = (path, token, label = token) => {
  assert.ok(collapse(read(path)).includes(collapse(token)), `${path} should contain ${label}`);
};
const lacks = (path, token, label = token) => {
  assert.ok(!collapse(read(path)).includes(collapse(token)), `${path} should not contain ${label}`);
};

const servicePath = "src/lib/services/brain/neo4j.ts";
assert.ok(existsSync(join(root, servicePath)), "missing Neo4j Brain Service");

for (const path of [
  "src/app/api/brain/neo4j/status/route.ts",
  "src/app/api/brain/neo4j/connect/route.ts",
  "src/app/api/brain/neo4j/sync/route.ts",
  "src/app/api/brain/neo4j/query/route.ts",
]) {
  assert.ok(existsSync(join(root, path)), `missing Neo4j API route: ${path}`);
}

for (const token of [
  "neo4j-driver",
  "hiveEnvPresence",
  "hiveEnvValue",
  "Invalid Neo4j env key",
  "No plaintext Neo4j URI, username, password, or private connection string",
]) {
  has(servicePath, token);
}

for (const token of [
  "Neo4jBrainConfig",
  "uriEnvKey",
  "usernameEnvKey",
  "passwordEnvKey",
  "databaseEnvKey",
  "queryLimit",
]) {
  has("src/lib/types/agent-runtime.ts", token);
}

for (const token of [
  "isReadOnlyCypher",
  "Only read-only Cypher is allowed",
  "cleaned.includes(\";\")",
  "CREATE|MERGE|SET|DELETE|DETACH|REMOVE|DROP|LOAD|FOREACH",
  "MATCH|RETURN|WITH|UNWIND",
  "CALL\\s+db\\.",
]) {
  has(servicePath, token);
}

for (const token of [
  "CREATE CONSTRAINT hivemind_memory_id",
  "MERGE (m:Memory {id: $id})",
  "MERGE (e:Entity {key: entity.key})",
  "MERGE (t:Tag {name: tag.key})",
  "MERGE (p:Project {name: $project})",
  "MERGE (a:Agent {key: $agent.key})",
  "MERGE (machine:Machine {key: $machine.key})",
  "MERGE (r:Runtime {name: $runtime})",
  "MERGE (previous:Memory {id: previousId})",
  "MERGE (p:CompiledKnowledgePage {path: $path})",
  "MERGE (m)-[:MENTIONS]->(e)",
  "MERGE (m)-[:HAS_TAG]->(t)",
  "MERGE (m)-[:IN_PROJECT]->(p)",
  "MERGE (m)-[:BY_AGENT]->(a)",
  "MERGE (m)-[:ON_MACHINE]->(machine)",
  "MERGE (m)-[:BY_RUNTIME]->(r)",
  "MERGE (m)-[:SUPERSEDES]->(previous)",
  "MERGE (p)-[:LINKS_TO]->(e)",
  "hivemindos-derived",
]) {
  has(servicePath, token);
}

for (const token of [
  "function cleanup",
  "cleanupNeo4j",
  "DETACH DELETE",
  "session.run(\"DELETE",
  "session.run(`DELETE",
  "session.run(\"DROP",
  "session.run(`DROP",
]) {
  lacks(servicePath, token);
}

for (const token of [
  "getNeo4jStatus",
  "connectNeo4j",
  "syncNeo4jBrain",
  "queryNeo4jBrain",
]) {
  has("src/app/api/brain/services/status/route.ts", token === "getNeo4jStatus" ? token : "neo4j");
}

for (const token of [
  "neo4jStatus",
  "neo4jBusy",
  "neo4jQuery",
  "/api/brain/neo4j/status",
  "/api/brain/neo4j/${action}",
  "/api/brain/neo4j/query",
]) {
  has("src/features/dashboard/DashboardApp.tsx", token);
}

for (const token of [
  "neo4jSettings",
  "Read-only Cypher",
  "Advanced connection",
  "uriEnvKey",
  "usernameEnvKey",
  "passwordEnvKey",
  "databaseEnvKey",
]) {
  has("src/features/dashboard/views/VaultPanel.tsx", token);
}

console.log("Neo4j Brain Service contract checks passed.");
