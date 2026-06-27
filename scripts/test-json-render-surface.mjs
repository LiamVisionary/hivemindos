#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const payload = await import("../src/components/json-render/payload.ts");
const catalog = await import("../src/components/json-render/catalog.ts");

const validSpec = {
  root: "root",
  state: { score: 72, enabled: true },
  elements: {
    root: {
      type: "Panel",
      props: { title: "Generated status", tone: "info" },
      children: ["metric", "progress", "input"],
    },
    metric: {
      type: "Metric",
      props: {
        label: "Score",
        value: { $template: "${/score}%" },
        tone: { $cond: { $state: "/enabled" }, $then: "success", $else: "muted" },
      },
      children: [],
    },
    progress: {
      type: "Progress",
      props: { value: { $state: "/score" }, max: 100, label: "Readiness" },
      visible: { $and: [{ $state: "/enabled" }, { $state: "/score", gte: 70 }] },
      watch: {
        "/score": { action: "emit", params: { event: "scoreChanged", value: { $state: "/score" } } },
      },
      children: [],
    },
    input: {
      type: "Input",
      props: { label: "Name", value: { $bindState: "/name" }, placeholder: "Agent" },
      children: [],
    },
  },
};

const objectPayload = payload.extractJsonRenderPayload(validSpec);
assert.equal(objectPayload?.source, "object");
assert.equal(objectPayload?.spec.elements.progress.watch?.["/score"]?.action, "emit");

const computedFormatSpec = {
  root: "root",
  state: { score: 74 },
  elements: {
    root: {
      type: "Metric",
      props: {
        label: "Computed average",
        value: { $format: "number", value: { $computed: "average", args: { values: [{ $state: "/score" }, 100] } } },
      },
      children: [],
    },
  },
};
const computedFormatPayload = payload.extractJsonRenderPayload(computedFormatSpec);
assert.deepEqual(computedFormatPayload?.spec.elements.root.props?.value, computedFormatSpec.elements.root.props.value);

const fenced = [
  "Here is the interface:",
  "```json-render",
  JSON.stringify(validSpec, null, 2),
  "```",
  "Rendered above.",
].join("\n");
const fencedPayload = payload.extractJsonRenderPayload(fenced);
assert.equal(fencedPayload?.source, "fence");
assert.equal(fencedPayload?.remainingText, "Here is the interface:\nRendered above.");

const directJsonPayload = payload.extractJsonRenderPayload(JSON.stringify(validSpec));
assert.equal(directJsonPayload?.source, "json");
assert.equal(payload.stripJsonRenderPayload(JSON.stringify(validSpec)), "");

const stream = [
  "Streaming text before patches.",
  JSON.stringify({ op: "add", path: "/root", value: "root" }),
  JSON.stringify({ op: "add", path: "/elements", value: {} }),
  JSON.stringify({ op: "add", path: "/state", value: { ready: true } }),
  JSON.stringify({
    op: "add",
    path: "/elements/root",
    value: { type: "Callout", props: { title: "Ready", body: { $t: "All systems {state}", values: { state: "green" } }, tone: "success" }, children: [] },
  }),
].join("\n");
const streamPayload = payload.extractJsonRenderPayload(stream);
assert.equal(streamPayload?.source, "stream");
assert.equal(streamPayload?.spec.elements.root.type, "Callout");
assert.equal(streamPayload?.remainingText, "Streaming text before patches.");

assert.equal(payload.extractJsonRenderPayload({
  root: "root",
  elements: {
    root: { type: "Unknown", props: {}, children: [] },
  },
}), null);

assert.equal(payload.extractJsonRenderPayload({
  root: "root",
  elements: {
    root: { type: "Panel", props: { title: "Missing child" }, children: ["missing"] },
  },
}), null);

assert.deepEqual(catalog.validateJsonRenderProps("Slider", { value: 50 }).success, true);
assert.deepEqual(catalog.validateJsonRenderProps("Slider", { value: "fifty" }).success, false);
assert.ok(catalog.JSON_RENDER_COMPONENT_NAMES.includes("Pagination"));
assert.ok(catalog.JSON_RENDER_COMPONENT_NAMES.includes("DataTable"));
assert.ok(payload.hiveJsonRenderCatalog.prompt.includes("SpecStream"));

console.log("json-render catalog and payload tests passed.");
