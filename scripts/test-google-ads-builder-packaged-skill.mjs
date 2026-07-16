#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageDir = join(root, "packaged-skills/optional/gtm/mikefutia/google-ads-builder");
const commit = "1518b766bc9fe5af6ce6595987e4c8318b1997e4";
const archiveHash = "92630aa8f2da388c40b8f107c3856f85594dc7d98822725fc9390905d8f3022e";
const tempRoot = await mkdtemp(join(tmpdir(), "hivemind-google-ads-builder-"));
process.env.HOME = join(tempRoot, "home");
await mkdir(process.env.HOME, { recursive: true });

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const { auditSkillInput, getSkillCatalog } = await import("../src/lib/services/skills/skill-os.ts");
const { importRemoteBrainSkill } = await import("../src/lib/services/obsidian/brain-skills.ts");

try {
  const catalog = await getSkillCatalog({ query: "google ads", includeRegistry: false });
  const entry = catalog.find((item) => item.slug === "google-ads-builder");
  assert(entry, "Google Ads Builder should be discoverable in the optional catalog");
  assert.equal(entry.source, "Mike Futia");
  assert.equal(entry.category, "GTM");
  assert.equal(entry.packagedPath, "packaged-skills/optional/gtm/mikefutia/google-ads-builder");
  assert.deepEqual(entry.capabilities, ["analytics", "browser", "chat", "filesystem", "http", "shell"]);

  const auditFiles = await Promise.all([
    "README.md",
    "SKILL.md",
    "scripts/render_report.py",
  ].map(async (path) => ({ path, content: await readFile(join(packageDir, path), "utf8") })));
  const audit = await auditSkillInput({ slug: entry.slug, files: auditFiles, sourceRef: commit, engine: "regex" });
  assert.equal(audit.status, "restricted", "the executable helper should require review without blocking install");
  assert.deepEqual(audit.findings.map((finding) => finding.id), ["helper-executable"]);
  assert.deepEqual(audit.requiredApprovals, ["executable-helper"]);
  assert.deepEqual(audit.envKeys, ["CLAUDE_SKILL_DIR"]);

  const vaultPath = join(tempRoot, "vault");
  await importRemoteBrainSkill({
    vaultPath,
    skill: {
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      source: entry.source,
      githubUrl: entry.githubUrl,
      packagedPath: entry.packagedPath,
    },
  });

  const installedDir = join(vaultPath, "Skills", "google-ads-builder");
  const installedSource = JSON.parse(await readFile(join(installedDir, ".hivemind-skill-source.json"), "utf8"));
  const installedManifest = JSON.parse(await readFile(join(installedDir, ".hivemind-skill.json"), "utf8"));
  assert.equal(installedSource.commit, commit, "shared-brain install should retain the pinned commit");
  assert.equal(installedSource.sourceArchiveSha256, archiveHash, "shared-brain install should retain the source archive hash");
  assert.match(installedSource.securityVerdict, /^Approved for optional, draft-only/);
  assert.equal(installedSource.provider, "packaged-optional");
  assert.equal(typeof installedSource.installedAt, "string");
  assert.equal(installedManifest.source.ref, commit);
  assert.equal(installedManifest.audit.status, "restricted");
  assert.deepEqual(installedManifest.audit.requiredApprovals, ["executable-helper"]);
  assert.equal(
    await readFile(join(installedDir, "scripts/render_report.py"), "utf8"),
    await readFile(join(packageDir, "scripts/render_report.py"), "utf8"),
    "shared-brain install should copy the audited renderer exactly",
  );
  await assert.rejects(stat(join(installedDir, ".git")), "shared-brain install must not include upstream Git metadata");

  const sourceMetadata = JSON.parse(await readFile(join(packageDir, ".hivemind-skill-source.json"), "utf8"));
  const skillsLock = JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
  assert.equal(sourceMetadata.commit, commit);
  assert.equal(sourceMetadata.sourceArchiveSha256, archiveHash);
  assert.equal(skillsLock.skills[entry.slug].ref, commit);
  assert.match(await readFile(join(root, "packaged-skills/README.md"), "utf8"), /gtm\/mikefutia\/google-ads-builder/);
  assert.match(await readFile(join(root, "docs/for-users/packaged-skills/third-party-skills.md"), "utf8"), /gtm\/mikefutia\/google-ads-builder/);

  console.log("Google Ads Builder is pinned, audited, cataloged, and installable with provenance preserved.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
