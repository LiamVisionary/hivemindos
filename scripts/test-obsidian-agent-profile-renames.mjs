import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function exists(path) {
  return access(path).then(() => true).catch(() => false);
}

async function loadAgentProfileModule(tempRoot) {
  const sourcePath = join(process.cwd(), "src/lib/services/obsidian/agent-profiles.ts");
  const source = await readFile(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const modulePath = join(tempRoot, "agent-profiles.mjs");
  await writeFile(modulePath, output);
  return import(pathToFileURL(modulePath).href);
}

const tempRoot = await mkdtemp(join(tmpdir(), "hivemindos-agent-profile-renames-"));

try {
  const { mirrorAgentProfilesToVault, readVaultAgentProfiles } = await loadAgentProfileModule(tempRoot);
  const vaultPath = join(tempRoot, "vault");
  const oldProfilePath = join(vaultPath, "Agents", "Local OpenAI", "UsePod-on-This-Mac", "profile.json");
  const renamedProfilePath = join(vaultPath, "Agents", "Local OpenAI", "Mr.-UsePod", "profile.json");
  const legacyRuntimeProfilePath = join(vaultPath, "AGENTS", "Hermes", "UsePod-on-This-Mac", "profile.json");
  const lowercaseAeonDir = join(vaultPath, "Agents", "AEON", "aeon");
  const lowercaseAeonProfilePath = join(lowercaseAeonDir, "profile.json");
  const baseAgent = {
    id: "openai-compatible-usepod-on-this-mac-91b11c",
    name: "UsePod on This Mac",
    runtime: "openai-compatible",
    gatewayUrl: "http://127.0.0.1:1234",
    chatPath: "/v1/chat/completions",
    statusPath: "/v1/models",
    agentId: "usepod-on-this-mac",
    provider: "usepod",
    model: "deepseek/deepseek-v4-pro",
    localDataDir: "",
    machineName: "This Mac",
    telemetryUrl: "http://127.0.0.1:8789",
    useSharedVault: true,
    usePod: {
      tokenEnvName: "USEPOD_TOKEN_EXAMPLE",
      dashboardUrl: "https://usepod.ai/fund/example",
    },
  };

  await mirrorAgentProfilesToVault({ vaultPath, agents: [baseAgent] });
  assert.equal(await exists(oldProfilePath), true, "initial default-name profile should be mirrored");

  const renamedAgent = { ...baseAgent, name: "Mr. UsePod" };
  await mirrorAgentProfilesToVault({ vaultPath, agents: [renamedAgent] });
  assert.equal(await exists(renamedProfilePath), true, "renamed profile should be mirrored");
  assert.equal(await exists(oldProfilePath), false, "stale default-name profile record should be pruned");

  await mkdir(dirname(oldProfilePath), { recursive: true });
  await writeFile(oldProfilePath, JSON.stringify({
    ...baseAgent,
    mirroredAt: "2099-01-01T00:00:00.000Z",
    managedBy: "hivemindos",
  }, null, 2) + "\n");
  await mkdir(dirname(legacyRuntimeProfilePath), { recursive: true });
  await writeFile(legacyRuntimeProfilePath, JSON.stringify({
    ...baseAgent,
    runtime: "hermes",
    provider: "openai-codex",
    mirroredAt: "2099-01-02T00:00:00.000Z",
    managedBy: "hivemindos",
  }, null, 2) + "\n");

  const profiles = await readVaultAgentProfiles(vaultPath);
  const usePodProfiles = profiles.filter((profile) => profile.id === baseAgent.id);
  assert.equal(usePodProfiles.length, 1, "duplicate profile records should collapse to one profile");
  assert.equal(usePodProfiles[0]?.name, "Mr. UsePod", "custom renamed profile should win over stale default-name duplicate");

  await mirrorAgentProfilesToVault({ vaultPath, agents: [baseAgent] });
  assert.equal(await exists(oldProfilePath), true, "renaming back to the default name should still mirror");
  assert.equal(await exists(renamedProfilePath), false, "renaming back should prune the prior custom profile record");
  assert.equal(await exists(legacyRuntimeProfilePath), false, "renaming back should prune stale legacy runtime records with the same id");

  const renamedBackProfiles = await readVaultAgentProfiles(vaultPath);
  const renamedBackUsePodProfiles = renamedBackProfiles.filter((profile) => profile.id === baseAgent.id);
  assert.equal(renamedBackUsePodProfiles.length, 1, "renamed-back profile records should stay deduped");
  assert.equal(renamedBackUsePodProfiles[0]?.name, "UsePod on This Mac", "renaming back should return the default-name profile");

  const aeonAgent = {
    id: "aeon-this-mac",
    name: "Aeonitis",
    runtime: "aeon",
    aeonRepoName: "Aeon",
    aeonRepo: "aaronjmars/aeon",
    aeonLocalPath: "~/aeon-test",
    localDataDir: "~/aeon-test",
  };

  await mkdir(lowercaseAeonDir, { recursive: true });
  await mirrorAgentProfilesToVault({ vaultPath, agents: [aeonAgent] });
  const aeonProfileExists = await exists(lowercaseAeonProfilePath)
    || await exists(join(vaultPath, "Agents", "AEON", "Aeon", "profile.json"));
  assert.equal(aeonProfileExists, true, "existing AEON folder casing should not prune its own freshly written profile");

  const aeonProfiles = await readVaultAgentProfiles(vaultPath);
  const thisMacAeonProfiles = aeonProfiles.filter((profile) => profile.id === aeonAgent.id);
  assert.equal(thisMacAeonProfiles.length, 1, "AEON profile should be readable after folder casing reconciliation");
  assert.equal(thisMacAeonProfiles[0]?.name, "Aeonitis", "AEON custom rename should persist");

  console.log("obsidian agent profile rename regression passed");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
