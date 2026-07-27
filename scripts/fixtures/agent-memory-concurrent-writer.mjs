import { register } from "node:module";

register(new URL("../lib/ts-relative-loader.mjs", import.meta.url));

process.env.HIVEMINDOS_MEMORY_PROOFS = "off";
delete process.env.HIVEMINDOS_EMBEDDINGS_URL;

const { rememberAgentMemory } = await import("../../src/lib/services/obsidian/agent-memory/core.ts");
const [vaultPath, indexValue] = process.argv.slice(2);
if (!vaultPath || indexValue === undefined) throw new Error("Expected vault path and writer index.");

const index = Number(indexValue);
const result = await rememberAgentMemory({
  vaultPath,
  type: "fact",
  title: "Concurrent Atlas fact " + index,
  content: "Atlas shard " + index + " uses unique verification token quartz-" + index + "-nebula-" + (index * 17 + 3) + ".",
  project: "atlas",
  allowDuplicate: true,
});
if (!result.record) throw new Error(result.blockReason || "Concurrent memory writer did not commit.");
process.stdout.write(JSON.stringify({ id: result.record.id, generationId: result.generation.generationId }));
