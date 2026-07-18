import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const writesArgument = process.argv.find((argument) => argument.startsWith("--writes="));
const writes = Math.max(2, Math.min(1_000, Math.trunc(Number(writesArgument?.split("=")[1] ?? 40))));
const temporaryRoot = await mkdtemp(join(tmpdir(), "hivemindos-brain-index-storage-benchmark-"));
const vaultPath = join(temporaryRoot, "vault");
process.env.HOME = join(temporaryRoot, "home");
process.env.HIVEMINDOS_MEMORY_PROOFS = "off";
delete process.env.HIVEMINDOS_EMBEDDINGS_URL;

async function directoryBytes(path) {
  const entries = await readdir(path, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? await directoryBytes(child) : (await stat(child)).size;
  }
  return total;
}

try {
  await mkdir(vaultPath, { recursive: true });
  await writeFile(join(vaultPath, "Shared Context.md"), "# Shared Context\n");
  const memory = await import("../src/lib/services/obsidian/agent-memory.ts");
  const generations = await import("../src/lib/services/obsidian/brain-index-generations.ts");
  const startedAt = performance.now();
  for (let index = 0; index < writes; index += 1) {
    const result = await memory.rememberAgentMemory({
      vaultPath,
      type: "fact",
      title: `Generation storage benchmark ${String(index).padStart(4, "0")}`,
      content: `Benchmark memory ${index} preserves a distinct durable fact for sequential generation storage measurement.`,
      project: "generation-storage-benchmark",
      allowDuplicate: true,
    });
    if (!result.record) throw new Error(`Benchmark write ${index} did not create a memory record.`);
  }
  const writeSeconds = (performance.now() - startedAt) / 1_000;
  const listed = await memory.listAgentMemoryGenerations({ vaultPath });
  let completeArtifactBytes = 0;
  let storedArtifactBytes = 0;
  let deltaGenerations = 0;
  for (const generation of listed.generations) {
    completeArtifactBytes += generation.artifacts.reduce((total, artifact) => total + artifact.bytes, 0);
    storedArtifactBytes += generation.artifacts.reduce((total, artifact) => total + (artifact.storageBytes ?? artifact.bytes), 0);
    if (generation.artifacts.some((artifact) => artifact.encoding?.includes("delta"))) deltaGenerations += 1;
    if (!await generations.readBrainIndexGeneration({ root: vaultPath, kind: "agent-memory", generationId: generation.generationId })) {
      throw new Error(`Benchmark replay verification failed for ${generation.generationId}.`);
    }
  }
  const brainServices = join(vaultPath, "Operations", "Brain Services");
  const currentMemoryIndexBytes = (await stat(join(brainServices, "Agent Memory Index.jsonl"))).size;
  const currentEntityIndexBytes = (await stat(join(brainServices, "Agent Memory Entity Index.jsonl"))).size;
  const generationDirectoryBytes = await directoryBytes(join(brainServices, "Index Generations", "agent-memory"));
  console.log(JSON.stringify({
    writes,
    writeSeconds: Number(writeSeconds.toFixed(3)),
    generationsRetained: listed.generations.length,
    checkpointGenerations: listed.coverage.checkpointCount,
    deltaGenerations,
    completeArtifactBytes,
    storedArtifactBytes,
    artifactStorageRatio: Number((storedArtifactBytes / Math.max(1, completeArtifactBytes)).toFixed(4)),
    generationDirectoryBytes,
    currentMemoryIndexBytes,
    currentEntityIndexBytes,
    replayCoverage: listed.coverage,
    compatibilityMirrorReadable: Boolean(await readFile(join(brainServices, "Agent Memory Index.jsonl"), "utf8")),
  }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
