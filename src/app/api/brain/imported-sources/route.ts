import { createHash } from "crypto";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";

import { NextRequest } from "next/server";

import { importDocumentsToBrain } from "@/lib/services/brain-document-import";
import {
  acceptedDocumentExtensions,
  BUNDLED_MARKITDOWN_VERSION,
  documentCapabilityFor,
  warmBundledMarkItDown,
} from "@/lib/services/document-ingestion";
import { homedir } from "@/lib/home-dir";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MAX_UPLOAD_FILES = 20;
const MAX_UPLOAD_BYTES_PER_FILE = 16 * 1024 * 1024;
const MAX_UPLOAD_BYTES_TOTAL = 64 * 1024 * 1024;

type UploadedDocument = {
  name?: string;
  mimeType?: string;
  dataBase64?: string;
};

type ImportBody = {
  vaultPath?: string;
  files?: UploadedDocument[];
};

function cleanSourceName(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim()
    .slice(0, 240);
}

function decodeBase64(value: unknown) {
  if (typeof value !== "string") throw new Error("Uploaded document data is missing.");
  const raw = value.replace(/^data:[^,]*;base64,/i, "").replace(/\s+/g, "");
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new Error("Uploaded document data is not valid base64.");
  const data = Buffer.from(raw, "base64");
  if (!data.length) throw new Error("Uploaded document is empty.");
  return data;
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  void warmBundledMarkItDown().catch(() => undefined);
  return okJson({
    bundled: true,
    converter: "hivemind-docs",
    converterVersion: BUNDLED_MARKITDOWN_VERSION,
    acceptedExtensions: acceptedDocumentExtensions(),
    limits: {
      files: MAX_UPLOAD_FILES,
      bytesPerFile: MAX_UPLOAD_BYTES_PER_FILE,
      bytesTotal: MAX_UPLOAD_BYTES_TOTAL,
    },
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null) as ImportBody | null;
  const files = Array.isArray(body?.files) ? body.files : [];
  if (!files.length) return errorJson("Choose at least one document to import.", 400);
  if (files.length > MAX_UPLOAD_FILES) return errorJson(`Import at most ${MAX_UPLOAD_FILES} documents at once.`, 400);

  const stagingRoot = join(homedir(), ".hivemindos", "cache", "document-import-staging");
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(stagingRoot, "brain-"));
  try {
    let totalBytes = 0;
    const sources = [];
    for (let index = 0; index < files.length; index += 1) {
      const upload = files[index];
      const sourceName = cleanSourceName(upload.name);
      const capability = documentCapabilityFor(sourceName);
      if (!sourceName || !capability) {
        throw new Error(`${sourceName || `Document ${index + 1}`} is not a supported document format.`);
      }
      const data = decodeBase64(upload.dataBase64);
      if (data.length > MAX_UPLOAD_BYTES_PER_FILE) throw new Error(`${sourceName} exceeds the 16 MB upload limit.`);
      totalBytes += data.length;
      if (totalBytes > MAX_UPLOAD_BYTES_TOTAL) throw new Error("Selected documents exceed the 64 MB batch limit.");
      const hash = createHash("sha256").update(new Uint8Array(data)).digest("hex");
      const filePath = join(staging, `${String(index + 1).padStart(3, "0")}-${hash.slice(0, 16)}${capability.extension}`);
      await writeFile(filePath, new Uint8Array(data), { mode: 0o600, flag: "wx" });
      sources.push({ filePath, sourceName });
    }

    const result = await importDocumentsToBrain({
      vaultPath: typeof body?.vaultPath === "string" ? body.vaultPath : undefined,
      files: sources,
    });
    return okJson(result);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Document import failed.", 400);
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}
