#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const catalog = await read("src/lib/services/app-builder/web-template-catalog.ts");
const initializer = await read("src/lib/services/app-builder/web-template-client.ts");
const hook = await read("src/features/dashboard/views/chat/exchange/use-chat-web-template.ts");
const modal = await read("src/features/dashboard/views/chat/exchange/ChatTemplateModal.tsx");
const modalCss = await read("src/features/dashboard/views/chat/exchange/ChatTemplateModal.module.css");
const composer = await read("src/features/dashboard/views/chat/exchange/ExchangeComposer.tsx");
const panel = await read("src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx");
const motion = await read("src/features/dashboard/views/chat/exchange/chat-exchange-motion.css");
const engine = await read("public/app-builder-templates/scroll-world/scrub-engine.js");
const starter = await read("public/app-builder-templates/scroll-world/script.js");
const templateReadme = await read("public/app-builder-templates/scroll-world/TEMPLATE.md");

assert.match(catalog, /id: "websites"[\s\S]*?readyCount: 1/, "Websites must be a ready top-level template group");
assert.match(
  catalog,
  /WEB_TEMPLATE_CATALOG[\s\S]*?=\s*\[\s*\{\s*id: "scroll-world"/,
  "Scroll World must remain the first web template",
);
assert.match(catalog, /2912048246d057cdfe134dfc0b4dfb7e6a12f30e/, "the audited upstream commit must be pinned");
assert.match(catalog, /license: "MIT"/, "the donor license must be explicit");

for (const path of [
  "index.html",
  "styles.css",
  "script.js",
  "scrub-engine.js",
  "TEMPLATE.md",
  "LICENSE.txt",
  "assets/arrival.svg",
  "assets/workshop.svg",
  "assets/finale.svg",
]) {
  assert.equal(
    existsSync(new URL(`../public/app-builder-templates/scroll-world/${path}`, import.meta.url)),
    true,
    `reviewed template asset ${path} must ship`,
  );
}

assert.ok(
  initializer.indexOf("loadTemplateFiles(template, fetchImpl)") < initializer.indexOf('action: "create"'),
  "all reviewed assets must load before App Builder creates a project",
);
assert.match(initializer, /requestAppBuilderWithCollectorRecovery/, "template creation must keep linked-machine recovery");
assert.match(initializer, /APP_BUILDER_CONFIRMATIONS\.createProject/, "project creation must use the canonical confirmation");
assert.match(initializer, /APP_BUILDER_CONFIRMATIONS\.writeFile/, "starter writes must use the canonical confirmation");
assert.match(initializer, /templateId: "static"/, "Scroll World must use the dependency-free static runtime");
assert.doesNotMatch(initializer, /git clone|child_process|exec\(|spawn\(/, "template attachment must not execute donor repository commands");

assert.match(composer, /label="Templates"/, "the plus menu must expose Templates");
assert.match(composer, /<ChatTemplateModal/, "the composer must open the template modal");
assert.match(modal, /APP_TEMPLATE_GROUPS\.map/, "the first modal view must render grouped cards");
assert.match(modal, /setView\("websites"\)/, "pressing Websites must open its template grid");
assert.match(modal, /Initializing in App Builder…/, "template selection must have an animated loading label");
assert.match(modal, /Preparing the reviewed files and creating this chat’s App Builder project/, "loading must explain the real operation");
assert.doesNotMatch(modalCss, /text-overflow|line-clamp/, "template cards must not silently truncate user-facing text");

assert.match(hook, /10_000/, "preview attention must last ten seconds");
assert.match(hook, /your web template is ready! what would you like me to change\?/, "the requested agent message must remain exact");
assert.match(hook, /appArtifact: artifact/, "the ready agent message must attach the real App Builder artifact");
assert.match(panel, /data-preview-attention=\{webTemplates\.previewAttention/, "the eye icon must expose its attention state");
assert.match(panel, /const toggleThreadWorkspace = useCallback\(\(\) => \{\s*acknowledgePreviewAttention\(\)/, "pressing the eye must stop its attention state");
assert.match(motion, /fr-chat-preview-attention[\s\S]*?translateY\(-5px\)/, "the eye attention state must visibly bounce");

assert.match(engine, /function mountScrollWorld/, "the adapted portable engine must ship");
assert.match(engine, /prefers-reduced-motion/, "the template must respect reduced-motion preferences");
assert.match(engine, /clipMobile|mobileClip/, "the template must retain mobile video support");
assert.doesNotMatch(engine, /\beval\(|new Function|child_process|process\.env|https?:\/\//, "the browser engine must not execute code, read secrets, or call fixed remote hosts");
assert.match(starter, /assets\/arrival\.svg/, "the starter must preview with local assets");
assert.match(templateReadme, /does not install or run those workflows/, "the project must explain that paid/tooling workflows are not automatic");

console.log("chat web-template catalog, initialization, safety, loading, and preview-attention checks passed");
