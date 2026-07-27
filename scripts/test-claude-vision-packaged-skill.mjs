#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageDir = join(root, "packaged-skills/optional/media/mikefutia/video-analyzer");
const scriptPath = join(packageDir, "scripts/analyze_video.py");
const commit = "0665eb3f782f92cd50179e61ac66e6c504cd754e";
const archiveHash = "eba0e7725f035c52fa401e0cdd83229249241949c572d0e8ded4b56f5f46e2fb";
const tempRoot = await mkdtemp(join(tmpdir(), "hivemind-claude-vision-"));
process.env.HOME = join(tempRoot, "home");
await mkdir(process.env.HOME, { recursive: true });

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const { auditSkillInput, getSkillCatalog } = await import("../src/lib/services/skills/skill-os.ts");
const { importRemoteBrainSkill } = await import("../src/lib/services/obsidian/brain-skills.ts");

function findPython() {
  const candidates = [process.env.PYTHON, "python3.14", "python3.13", "python3.12", "python3.11", "python3.10", "python3"]
    .filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"], {
      encoding: "utf8",
    });
    if (probe.status === 0) return candidate;
  }
  throw new Error("Claude Vision verification requires Python 3.10 or newer.");
}

const pythonHarness = String.raw`
import importlib.util
import os
import pathlib
import sys
import tempfile
import types as stdlib_types

script_path = sys.argv[1]

class Box:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)

sdk_types = stdlib_types.ModuleType("google.genai.types")
for name in ("Blob", "Content", "FileData", "Part", "VideoMetadata"):
    setattr(sdk_types, name, Box)

class FakeFiles:
    def __init__(self):
        self.deleted = []
        self.uploaded = []
        self.state = "ACTIVE"
        self.raise_on_get = False

    def upload(self, file):
        self.uploaded.append(file)
        return stdlib_types.SimpleNamespace(name="files/mock-video")

    def get(self, name):
        if self.raise_on_get:
            raise RuntimeError("mock polling failure")
        return stdlib_types.SimpleNamespace(
            state=stdlib_types.SimpleNamespace(name=self.state),
            uri="https://example.invalid/mock-video",
            mime_type="video/mp4",
        )

    def delete(self, name):
        self.deleted.append(name)

class FakeModels:
    def generate_content(self, **kwargs):
        return stdlib_types.SimpleNamespace(text="# Mock report")

class FakeClient:
    instances = []

    def __init__(self, api_key):
        self.api_key = api_key
        self.files = FakeFiles()
        self.models = FakeModels()
        self.__class__.instances.append(self)

google = stdlib_types.ModuleType("google")
genai = stdlib_types.ModuleType("google.genai")
genai.Client = FakeClient
genai.types = sdk_types
google.genai = genai
sys.modules["google"] = google
sys.modules["google.genai"] = genai
sys.modules["google.genai.types"] = sdk_types

spec = importlib.util.spec_from_file_location("packaged_video_analyzer", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as temp_dir:
    sample = pathlib.Path(temp_dir) / "sample.mp4"
    sample.write_bytes(b"mock video")

    sys.argv = [script_path, str(sample)]
    try:
        module.main()
    except SystemExit as error:
        assert error.code == 2
    else:
        raise AssertionError("main should require --confirm-upload")
    assert not FakeClient.instances

    for key_name in ("GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_API_KEY"):
        os.environ.pop(key_name, None)
    os.environ["GOOGLE_AI_STUDIO_API_KEY"] = "mock-key"

    module.INLINE_SIZE_LIMIT_BYTES = 1024
    assert module.analyze(sample, "prompt", None, "gemini-3-flash") == "# Mock report"
    inline_client = FakeClient.instances[-1]
    assert inline_client.api_key == "mock-key"
    assert inline_client.files.uploaded == []
    assert inline_client.files.deleted == []

    module.INLINE_SIZE_LIMIT_BYTES = 0
    assert module.analyze(sample, "prompt", 1.0, "gemini-3-flash") == "# Mock report"
    files_client = FakeClient.instances[-1]
    assert files_client.files.uploaded == [str(sample)]
    assert files_client.files.deleted == ["files/mock-video"]

    failed_client = FakeClient("mock-key")
    failed_client.files.state = "FAILED"
    try:
        module.build_video_part(failed_client, sample, None)
    except SystemExit as error:
        assert error.code == 1
    else:
        raise AssertionError("failed Files API processing should exit")
    assert failed_client.files.deleted == ["files/mock-video"]

    polling_error_client = FakeClient("mock-key")
    polling_error_client.files.raise_on_get = True
    try:
        module.build_video_part(polling_error_client, sample, None)
    except RuntimeError as error:
        assert str(error) == "mock polling failure"
    else:
        raise AssertionError("Files API polling error should propagate")
    assert polling_error_client.files.deleted == ["files/mock-video"]

    timeout_client = FakeClient("mock-key")
    module.FILE_PROCESSING_TIMEOUT_SEC = 0
    try:
        module.build_video_part(timeout_client, sample, None)
    except SystemExit as error:
        assert error.code == 1
    else:
        raise AssertionError("Files API timeout should exit")
    assert timeout_client.files.deleted == ["files/mock-video"]
`;

try {
  const catalog = await getSkillCatalog({ query: "video analyzer", includeRegistry: false });
  const entry = catalog.find((item) => item.slug === "video-analyzer");
  assert(entry, "Video Analyzer should be discoverable in the optional catalog");
  assert.equal(entry.source, "Mike Futia");
  assert.equal(entry.category, "Media");
  assert.equal(entry.packagedPath, "packaged-skills/optional/media/mikefutia/video-analyzer");
  assert.deepEqual(entry.capabilities, ["chat", "filesystem", "http", "publishing", "shell"]);

  const skillMarkdown = await readFile(join(packageDir, "SKILL.md"), "utf8");
  const packagedReadme = await readFile(join(packageDir, "README.md"), "utf8");
  assert.doesNotMatch(skillMarkdown, /\$ARGUMENTS|disable-model-invocation|allowed-tools|~\/\.claude/);
  assert.doesNotMatch(packagedReadme, /Claude Code|~\/\.claude/);
  assert.match(packagedReadme, /agent-agnostic/i);
  assert.match(packagedReadme, /adapted from Mike Futia's Claude Vision/i);

  const auditFiles = await Promise.all([
    "README.md",
    "SECURITY_AUDIT.md",
    "SKILL.md",
    "scripts/analyze_video.py",
  ].map(async (path) => ({ path, content: await readFile(join(packageDir, path), "utf8") })));
  const audit = await auditSkillInput({ slug: entry.slug, files: auditFiles, sourceRef: commit, engine: "regex" });
  assert.equal(audit.status, "restricted", "external upload and executable helper should require approval without blocking install");
  assert(!audit.findings.some((finding) => finding.severity === "high"));
  assert(!audit.findings.some((finding) => finding.id === "credential-exfiltration"));
  for (const findingId of ["publishing-action", "network-action", "helper-executable"]) {
    assert(audit.findings.some((finding) => finding.id === findingId), `expected ${findingId} finding`);
  }
  for (const approval of ["external-action", "network-access", "executable-helper"]) {
    assert(audit.requiredApprovals.includes(approval), `expected ${approval} approval`);
  }
  for (const envKey of ["GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_API_KEY"]) {
    assert(audit.envKeys.includes(envKey), `expected ${envKey} env key`);
  }

  const python = findPython();
  const pythonResult = spawnSync(python, ["-c", pythonHarness, scriptPath], {
    encoding: "utf8",
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH ?? "",
      PYTHONDONTWRITEBYTECODE: "1",
    },
  });
  assert.equal(pythonResult.status, 0, pythonResult.stderr || pythonResult.stdout);

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

  const installedDir = join(vaultPath, "Skills", "video-analyzer");
  const installedSource = JSON.parse(await readFile(join(installedDir, ".hivemind-skill-source.json"), "utf8"));
  const installedManifest = JSON.parse(await readFile(join(installedDir, ".hivemind-skill.json"), "utf8"));
  assert.equal(installedSource.commit, commit);
  assert.equal(installedSource.sourceArchiveSha256, archiveHash);
  assert.match(installedSource.securityVerdict, /^Conditionally approved/);
  assert.equal(installedSource.provider, "packaged-optional");
  assert.equal(typeof installedSource.installedAt, "string");
  assert.equal(installedManifest.source.ref, commit);
  assert.equal(installedManifest.audit.status, "restricted");
  assert.equal(
    await readFile(join(installedDir, "scripts/analyze_video.py"), "utf8"),
    await readFile(scriptPath, "utf8"),
  );
  await assert.rejects(stat(join(installedDir, ".git")), "shared-brain install must not include upstream Git metadata");

  const sourceMetadata = JSON.parse(await readFile(join(packageDir, ".hivemind-skill-source.json"), "utf8"));
  const skillsLock = JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
  assert.equal(sourceMetadata.commit, commit);
  assert.equal(sourceMetadata.sourceArchiveSha256, archiveHash);
  assert.match(sourceMetadata.normalized, /^agent-agnostic-/);
  assert.match(sourceMetadata.auditSummary.licenseReview, /no standalone license file/);
  assert.equal(skillsLock.skills[entry.slug].ref, commit);
  assert.match(await readFile(join(packageDir, "SECURITY_AUDIT.md"), "utf8"), /--confirm-upload/);
  assert.match(await readFile(join(root, "packaged-skills/README.md"), "utf8"), /media\/mikefutia\/video-analyzer/);
  assert.match(await readFile(join(root, "docs/for-users/packaged-skills/third-party-skills.md"), "utf8"), /media\/mikefutia\/video-analyzer/);

  console.log("Claude Vision is pinned, consent-gated, cleanup-hardened, cataloged, and installable with provenance preserved.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
