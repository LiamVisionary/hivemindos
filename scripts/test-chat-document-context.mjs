#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFile } from "node:fs/promises";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  ingestChatDocumentArtifacts,
  messagesWithDocumentIngestionContext,
} = await import("../src/app/api/chat/agent-runtime/document-artifacts.ts");

const artifacts = [
  { id: "pdf", kind: "file", name: "brief.pdf", mimeType: "application/pdf", sizeBytes: 200, path: "/tmp/brief.pdf" },
  { id: "image", kind: "image", name: "photo.png", mimeType: "image/png", sizeBytes: 100, path: "/tmp/photo.png" },
  { id: "bad", kind: "file", name: "broken.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 100, path: "/tmp/broken.docx" },
];

const ingestion = await ingestChatDocumentArtifacts(artifacts, {
  ingestFile: async ({ filePath, sourceName }) => {
    if (sourceName === "broken.docx") throw new Error("fixture conversion failed");
    return {
      status: "converted",
      sourceName,
      sourcePath: filePath,
      sourceBytes: 200,
      sourceSha256: "a".repeat(64),
      capability: { extension: ".pdf", kind: "document", label: "PDF", mimeTypes: ["application/pdf"] },
      converter: "hivemind-docs",
      converterVersion: "hivemind-docs-1",
      convertedAt: "2026-07-14T00:00:00.000Z",
      markdown: "# Board brief\n\nShip the product.",
      truncated: false,
      fromCache: false,
      warnings: [],
    };
  },
});

assert.equal(ingestion.converted.length, 1);
assert.equal(ingestion.failures.length, 1, "one broken document does not hide the good attachment");
assert.match(ingestion.context, /UNTRUSTED DOCUMENT CONTENT/);
assert.match(ingestion.context, /Ship the product/);

const messages = messagesWithDocumentIngestionContext([
  { role: "user", content: "Summarize the attachment." },
], ingestion.context);
assert.equal(messages.length, 1);
assert.match(messages[0].content, /Summarize the attachment/);
assert.match(messages[0].content, /UNTRUSTED DOCUMENT CONTENT/);

const runtimeRoute = await readFile("src/app/api/chat/agent-runtime/route.ts", "utf8");
assert.match(runtimeRoute, /warmBundledMarkItDown\(\)/, "ordinary chat turns prewarm the bundled converter");

console.log("chat document context test passed");
