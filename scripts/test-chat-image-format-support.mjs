#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "production";
process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = "chat-image-format-test-secret-32-bytes-minimum";
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { isImageAttachment } = await import("../src/features/chat/chat-file-references.ts");
const { materializeChatMediaArtifacts } = await import("../src/app/api/chat/agent-runtime/media-artifacts.ts");
const { resolveVideoGenerationFollowUp } = await import("../src/lib/services/chat/video-generation-follow-up.ts");
const { signedGeneratedMediaUrl } = await import("../src/lib/services/chat/generated-media-signing.ts");
const { GET: getGeneratedMedia } = await import("../src/app/api/chat/generated-media/route.ts");

function pngBytes() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function jpegBytes() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
}

function isoImageBytes(brand) {
  return Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftyp"), Buffer.from(brand), Buffer.alloc(12)]);
}

const formats = [
  { extension: "apng", mimeType: "image/apng", bytes: pngBytes() },
  { extension: "avif", mimeType: "image/avif", bytes: isoImageBytes("avif") },
  { extension: "bmp", mimeType: "image/bmp", bytes: Buffer.from("BMimage") },
  { extension: "dib", mimeType: "image/bmp", bytes: Buffer.from("BMimage") },
  { extension: "gif", mimeType: "image/gif", bytes: Buffer.from("GIF89a") },
  { extension: "heic", mimeType: "image/heic", bytes: isoImageBytes("heic") },
  { extension: "heif", mimeType: "image/heif", bytes: isoImageBytes("mif1") },
  { extension: "ico", mimeType: "image/vnd.microsoft.icon", bytes: Buffer.from([0, 0, 1, 0, 1, 0]) },
  { extension: "jpe", mimeType: "image/jpeg", bytes: jpegBytes() },
  { extension: "jpeg", mimeType: "image/jpeg", bytes: jpegBytes() },
  { extension: "jfif", mimeType: "image/jpeg", bytes: jpegBytes() },
  { extension: "jpg", mimeType: "image/jpeg", bytes: jpegBytes() },
  { extension: "pjp", mimeType: "image/jpeg", bytes: jpegBytes() },
  { extension: "pjpeg", mimeType: "image/jpeg", bytes: jpegBytes() },
  { extension: "png", mimeType: "image/png", bytes: pngBytes() },
  { extension: "svg", mimeType: "image/svg+xml", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') },
  { extension: "tif", mimeType: "image/tiff", bytes: Buffer.from([0x49, 0x49, 0x2a, 0]) },
  { extension: "tiff", mimeType: "image/tiff", bytes: Buffer.from([0x4d, 0x4d, 0, 0x2a]) },
  { extension: "webp", mimeType: "image/webp", bytes: Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]) },
];

const root = await mkdtemp(join(tmpdir(), "hmos-chat-image-formats-"));
try {
  for (const format of formats) {
    const name = `source.${format.extension}`;
    const path = join(root, name);
    await writeFile(path, format.bytes);

    assert.equal(isImageAttachment({
      id: `attachment-${format.extension}`,
      kind: "file",
      name,
      mimeType: "application/octet-stream",
      size: format.bytes.length,
      dataUrl: "",
      referencePath: path,
      referenceKind: "file",
      referenceOnly: true,
    }), true, `composer should recognize .${format.extension} as an image`);

    const artifacts = await materializeChatMediaArtifacts({
      runtimeSessionId: `format-${format.extension}`,
      attachments: [{
        id: `reference-${format.extension}`,
        kind: "file",
        name,
        mimeType: "application/octet-stream",
        size: format.bytes.length,
        dataUrl: "",
        referencePath: path,
        referenceKind: "file",
        referenceOnly: true,
      }],
      messages: [{ role: "user", content: "generate a video from this image" }],
    });
    assert.equal(artifacts[0]?.kind, "image", `.${format.extension} should remain an image-to-video input`);
    assert.equal(artifacts[0]?.mimeType, format.mimeType, `.${format.extension} should use ${format.mimeType}`);
    assert.ok(artifacts[0]?.dataUrl?.startsWith(`data:${format.mimeType};base64,`), `.${format.extension} should expose image bytes`);

    const followUp = resolveVideoGenerationFollowUp("now with softer motion", [
      {
        role: "user",
        content: `create a video Attached file references:\n- ${name} (kind: file; path: ${path}; type: application/octet-stream)`,
      },
      {
        role: "assistant",
        applicationGeneration: { id: `video-${format.extension}`, kind: "video", status: "ready", prompt: "create a video" },
      },
    ]);
    assert.equal(followUp?.inputImages[0]?.mimeType, format.mimeType, `.${format.extension} follow-ups should recover the source image`);

    const signedUrl = await signedGeneratedMediaUrl(path);
    const response = await getGeneratedMedia(new Request(`http://hivemind.test${signedUrl}`));
    assert.equal(response.status, 200, `.${format.extension} source thumbnails should be served`);
    assert.equal(response.headers.get("content-type"), format.mimeType);
    if (format.extension === "svg") {
      assert.match(response.headers.get("content-security-policy") ?? "", /sandbox/, "SVG thumbnails must be sandboxed");
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(`Chat image formats stay usable from composer through video follow-up and source preview (${formats.length} extensions).`);
