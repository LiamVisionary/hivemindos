#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import appBuilderContract from "../contracts/app-builder/v1.json" with { type: "json" };

const appBuilder = await import("./lib/app-builder.mjs");

test("static hosting artifacts are deterministic, bounded, and secret-safe", async () => {
  assert.equal(typeof appBuilder.prepareStaticHostingArtifact, "function");
  const root = await mkdtemp(join(tmpdir(), "hive-hosting-artifact-"));
  const project = join(root, "project");
  await appBuilder.createLocalAppProject({
    directory: project,
    name: "Hosting artifact",
    confirmation: appBuilderContract.confirmations.createProject,
  });
  await mkdir(join(project, "out", "assets"), { recursive: true });
  await writeFile(join(project, "out", "index.html"), "<h1>Hello</h1>");
  await writeFile(join(project, "out", "assets", "app.js"), "console.log('ok')");

  const first = await appBuilder.prepareStaticHostingArtifact(project);
  const second = await appBuilder.prepareStaticHostingArtifact(project);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.files.map((file) => file.path), ["assets/app.js", "index.html"]);
  assert.equal(first.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), true);
  assert.equal(first.files.every((file) => typeof file.contentBase64 === "string"), true);

  await writeFile(join(project, "out", ".env"), "SECRET=do-not-publish");
  await assert.rejects(() => appBuilder.prepareStaticHostingArtifact(project), /secret|\.env/i);
});

test("static hosting artifacts reject symlinks", async () => {
  assert.equal(typeof appBuilder.prepareStaticHostingArtifact, "function");
  const root = await mkdtemp(join(tmpdir(), "hive-hosting-symlink-"));
  const project = join(root, "project");
  await appBuilder.createLocalAppProject({
    directory: project,
    name: "Hosting symlink",
    confirmation: appBuilderContract.confirmations.createProject,
  });
  await mkdir(join(project, "out"), { recursive: true });
  await writeFile(join(project, "outside.txt"), "outside");
  await writeFile(join(project, "out", "index.html"), "ok");
  await symlink(join(project, "outside.txt"), join(project, "out", "leak.txt"));
  await assert.rejects(() => appBuilder.prepareStaticHostingArtifact(project), /symbolic link/i);
});

test("temporary Cloudflare deploy uses argv execution and requires explicit confirmation", async () => {
  assert.equal(typeof appBuilder.cloudflareTemporaryDeploySpec, "function");
  const root = await mkdtemp(join(tmpdir(), "hive-temporary-deploy-"));
  const project = join(root, "project");
  await appBuilder.createLocalAppProject({
    directory: project,
    name: "Temporary deploy",
    confirmation: appBuilderContract.confirmations.createProject,
  });
  await mkdir(join(project, "out"), { recursive: true });
  await writeFile(join(project, "out", "index.html"), "ok");
  const spec = await appBuilder.cloudflareTemporaryDeploySpec(project, "demo-site");
  assert.equal(spec.command, "npx");
  assert.deepEqual(spec.args.slice(0, 5), ["--yes", "wrangler@^4.102.0", "deploy", "--temporary", "--config"]);
  assert.equal(spec.shell, false);
  await assert.rejects(
    () => appBuilder.runLocalAppBuilderAction({ action: "test_deploy", directory: project }),
    /CONFIRM_CLOUDFLARE_TEMPORARY_DEPLOY/,
  );
});

test("temporary Cloudflare deploy supports a dynamic Worker artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "hive-temporary-worker-"));
  const project = join(root, "project");
  await appBuilder.createLocalAppProject({
    directory: project,
    name: "Temporary worker",
    confirmation: appBuilderContract.confirmations.createProject,
  });
  await mkdir(join(project, "dist"), { recursive: true });
  await writeFile(join(project, "dist", "worker.mjs"), "export default { fetch() { return new Response('ok') } }");

  const spec = await appBuilder.cloudflareTemporaryDeploySpec(project, "demo-worker", "dynamic");
  const config = JSON.parse(await readFile(spec.args.at(-1), "utf8"));
  assert.equal(config.main, "../../dist/worker.mjs");
  assert.equal("assets" in config, false);
});

test("dynamic hosting artifacts package one reviewed Worker module", async () => {
  assert.equal(typeof appBuilder.prepareDynamicHostingArtifact, "function");
  const root = await mkdtemp(join(tmpdir(), "hive-dynamic-artifact-"));
  const project = join(root, "project");
  await appBuilder.createLocalAppProject({
    directory: project,
    name: "Dynamic worker",
    confirmation: appBuilderContract.confirmations.createProject,
  });
  await mkdir(join(project, "dist"));
  const code = "export default { fetch() { return new Response('dynamic') } }";
  await writeFile(join(project, "dist", "worker.mjs"), code);
  const artifact = await appBuilder.prepareDynamicHostingArtifact(project);
  assert.equal(artifact.protocol, "hivemindos.dynamic-worker/v1");
  assert.equal(artifact.code, code);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(artifact.bytes, Buffer.byteLength(code));
});

test("the public contract exposes hosting capabilities without authoritative prices", () => {
  assert.equal(appBuilderContract.confirmations.temporaryDeploy, "CONFIRM_CLOUDFLARE_TEMPORARY_DEPLOY");
  assert.equal(appBuilderContract.confirmations.publishHosting, "CONFIRM_APP_HOSTING_PURCHASE");
  assert.equal(appBuilderContract.confirmations.renewHosting, "CONFIRM_APP_HOSTING_PURCHASE");
  assert.equal(appBuilderContract.confirmations.unpublishHosting, "CONFIRM_APP_HOSTING_UNPUBLISH");
  const ids = appBuilderContract.capabilities.map((capability) => capability.id);
  for (const id of ["artifact.prepare", "deploy.temporary", "hosting.catalog", "hosting.publish", "hosting.renew", "hosting.unpublish"]) {
    assert.equal(ids.includes(id), true, `missing ${id}`);
  }
  assert.equal(JSON.stringify(appBuilderContract).includes("priceUsd"), false);
  assert.deepEqual(appBuilderContract.artifacts.static.clientLimits, {
    files: 1_000,
    totalBytes: 20 * 1024 * 1024,
    fileBytes: 5 * 1024 * 1024,
  });
  assert.equal(appBuilderContract.artifacts.dynamic.entrypoint, "dist/worker.mjs");
  assert.equal(appBuilderContract.temporaryDeploy.minimumWranglerVersion, "4.102.0");
});
