#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const modulePath = new URL("./lib/app-builder.mjs", import.meta.url);
const appBuilder = await import(modulePath.href).catch(() => null);
assert.ok(appBuilder, "the shared local app-builder adapter must exist");

const confirmations = {
  create: "CONFIRM_APP_PROJECT_CREATE",
  write: "CONFIRM_APP_FILE_WRITE",
  delete: "CONFIRM_APP_FILE_DELETE",
  runtime: "CONFIRM_APP_RUNTIME",
};

test("local project creation is approval-gated, idempotent, and confined to the selected directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "hivemind-local-app-"));
  const project = join(root, "portal");
  try {
    await assert.rejects(
      appBuilder.createLocalAppProject({ directory: project, name: "Portal", templateId: "nextjs" }),
      /CONFIRM_APP_PROJECT_CREATE/,
    );
    const created = await appBuilder.createLocalAppProject({
      directory: project,
      name: "Portal",
      templateId: "nextjs",
      confirmation: confirmations.create,
    });
    assert.equal(created.created, true);
    assert.equal(created.project.status, "stopped");
    assert.equal(JSON.parse(await readFile(join(project, "package.json"), "utf8")).dependencies.next, "16.2.6");

    const nested = join(root, "scratchpad", "nested-app");
    const nestedProject = await appBuilder.createLocalAppProject({
      directory: nested,
      workspaceDirectory: root,
      name: "Nested",
      templateId: "static",
      confirmation: confirmations.create,
    });
    assert.equal(nestedProject.created, true, "confirmed project creation may create safe parent folders inside the selected workspace");
    await assert.rejects(
      appBuilder.createLocalAppProject({
        directory: join(root, "..", "outside-app"),
        workspaceDirectory: root,
        name: "Outside",
        templateId: "static",
        confirmation: confirmations.create,
      }),
      /inside the selected chat workspace/,
    );

    const replay = await appBuilder.createLocalAppProject({
      directory: project,
      name: "Portal",
      templateId: "nextjs",
      confirmation: confirmations.create,
    });
    assert.equal(replay.created, false);

    await mkdir(join(root, "empty-target"));
    await symlink("empty-target", join(root, "alias"));
    await assert.rejects(
      appBuilder.createLocalAppProject({
        directory: join(root, "alias"),
        name: "Alias",
        templateId: "nextjs",
        confirmation: confirmations.create,
      }),
      /symbolic link/,
    );
    assert.deepEqual(await readdir(join(root, "empty-target")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local file operations enforce project boundaries and write/delete approvals", async () => {
  const root = await mkdtemp(join(tmpdir(), "hivemind-local-files-"));
  const project = join(root, "portal");
  try {
    await appBuilder.createLocalAppProject({
      directory: project,
      name: "Portal",
      templateId: "nextjs",
      confirmation: confirmations.create,
    });
    await assert.rejects(
      appBuilder.writeLocalAppFile({ directory: project, path: "src/app/page.tsx", content: "changed" }),
      /CONFIRM_APP_FILE_WRITE/,
    );
    const written = await appBuilder.writeLocalAppFile({
      directory: project,
      path: "src/app/message.txt",
      content: "hello hive\n",
      confirmation: confirmations.write,
    });
    assert.equal(written.content, "hello hive\n");
    assert.equal((await appBuilder.readLocalAppFile({ directory: project, path: "src/app/message.txt" })).content, "hello hive\n");
    assert.ok((await appBuilder.listLocalAppFiles({ directory: project, path: "src/app" })).entries.some((item) => item.name === "message.txt"));
    await assert.rejects(
      appBuilder.readLocalAppFile({ directory: project, path: "../secret" }),
      /escapes/,
    );
    await assert.rejects(
      appBuilder.deleteLocalAppFile({ directory: project, path: "src/app/message.txt" }),
      /CONFIRM_APP_FILE_DELETE/,
    );
    await appBuilder.deleteLocalAppFile({
      directory: project,
      path: "src/app/message.txt",
      confirmation: confirmations.delete,
    });
    assert.equal(existsSync(join(project, "src/app/message.txt")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("static projects start without dependencies and serve only project-owned files", async () => {
  const root = await mkdtemp(join(tmpdir(), "hivemind-static-runtime-"));
  const project = join(root, "arcade");
  const outside = join(root, "outside.txt");
  try {
    const created = await appBuilder.createLocalAppProject({
      directory: project,
      name: "Arcade",
      templateId: "static",
      confirmation: confirmations.create,
    });
    assert.equal(created.project.templateId, "static");
    assert.equal(created.project.dependenciesReady, true);
    assert.equal(existsSync(join(project, "index.html")), true);
    await writeFile(outside, "private-value");
    await symlink(outside, join(project, "linked-secret.txt"));
    const started = await appBuilder.startLocalAppProject({ directory: project, confirmation: confirmations.runtime });
    try {
      const preview = await fetch(started.project.previewUrl);
      assert.equal(preview.status, 200);
      assert.match(await preview.text(), /HivemindOS App/);
      const linked = await fetch(`${started.project.previewUrl}/linked-secret.txt`);
      assert.doesNotMatch(await linked.text(), /private-value/);
    } finally {
      const stopped = await appBuilder.stopLocalAppProject({ directory: project, confirmation: confirmations.runtime });
      assert.equal(stopped.project.status, "stopped");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("status reconciles a stale running manifest after the preview process exits", async () => {
  const root = await mkdtemp(join(tmpdir(), "hivemind-stale-static-runtime-"));
  const project = join(root, "arcade");
  try {
    await appBuilder.createLocalAppProject({
      directory: project,
      name: "Arcade",
      templateId: "static",
      confirmation: confirmations.create,
    });
    const started = await appBuilder.startLocalAppProject({ directory: project, confirmation: confirmations.runtime });
    assert.equal(started.project.status, "running");
    assert.ok(Number.isInteger(started.project.pid));

    process.kill(started.project.pid, "SIGKILL");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        process.kill(started.project.pid, 0);
      } catch {
        break;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    }

    const status = await appBuilder.getLocalAppProject({ directory: project });
    assert.equal(status.status, "stopped");
    assert.equal(status.pid, null);
    assert.equal(status.port, null);
    assert.equal(status.previewUrl, null);
  } finally {
    await appBuilder.stopLocalAppProject({ directory: project, confirmation: confirmations.runtime }).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("existing static apps can be adopted inside the selected chat workspace without overwriting files", async () => {
  const root = await mkdtemp(join(tmpdir(), "hivemind-static-adopt-"));
  const workspace = join(root, "workspace");
  const project = join(workspace, "scratchpad", "flappy-bird-clone");
  const outside = join(root, "outside-app");
  try {
    await mkdir(project, { recursive: true });
    await mkdir(outside);
    await writeFile(join(project, "index.html"), "<!doctype html><title>Flappy</title>");
    await writeFile(join(outside, "index.html"), "<!doctype html><title>Outside</title>");
    await assert.rejects(
      appBuilder.adoptLocalAppProject({ directory: project, workspaceDirectory: workspace, name: "Flappy" }),
      /CONFIRM_APP_PROJECT_CREATE/,
    );
    const adopted = await appBuilder.adoptLocalAppProject({
      directory: project,
      workspaceDirectory: workspace,
      name: "Flappy",
      confirmation: confirmations.create,
    });
    assert.equal(adopted.adopted, true);
    assert.equal(adopted.project.templateId, "static");
    assert.equal(await readFile(join(project, "index.html"), "utf8"), "<!doctype html><title>Flappy</title>");
    const replay = await appBuilder.adoptLocalAppProject({
      directory: project,
      workspaceDirectory: workspace,
      name: "Ignored on replay",
      confirmation: confirmations.create,
    });
    assert.equal(replay.adopted, false);
    assert.equal(replay.project.id, adopted.project.id);
    await assert.rejects(
      appBuilder.adoptLocalAppProject({
        directory: outside,
        workspaceDirectory: workspace,
        confirmation: confirmations.create,
      }),
      /inside the selected chat workspace/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local runtime start and stop use the project-owned Next binary and loopback preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "hivemind-local-runtime-"));
  const project = join(root, "portal");
  try {
    await appBuilder.createLocalAppProject({
      directory: project,
      name: "Portal",
      templateId: "nextjs",
      confirmation: confirmations.create,
    });
    const nextBin = join(project, "node_modules", "next", "dist", "bin", "next");
    await mkdir(join(nextBin, ".."), { recursive: true });
    await writeFile(nextBin, [
      "const http = require('node:http');",
      "const args = process.argv.slice(2);",
      "const port = Number(args[args.indexOf('--port') + 1]);",
      "http.createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end(process.env.APP_BUILDER_TEST_SECRET || '<title>Portal</title>'); }).listen(port, '127.0.0.1');",
    ].join("\n"));
    await assert.rejects(appBuilder.startLocalAppProject({ directory: project }), /CONFIRM_APP_RUNTIME/);
    process.env.APP_BUILDER_TEST_SECRET = "must-not-reach-generated-code";
    try {
      const started = await appBuilder.startLocalAppProject({ directory: project, confirmation: confirmations.runtime });
      assert.equal(started.project.status, "running");
      assert.match(started.project.previewUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
      const preview = await fetch(started.project.previewUrl);
      assert.equal(preview.status, 200);
      assert.doesNotMatch(await preview.text(), /must-not-reach-generated-code/);
      const stopped = await appBuilder.stopLocalAppProject({ directory: project, confirmation: confirmations.runtime });
      assert.equal(stopped.project.status, "stopped");
    } finally {
      delete process.env.APP_BUILDER_TEST_SECRET;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
