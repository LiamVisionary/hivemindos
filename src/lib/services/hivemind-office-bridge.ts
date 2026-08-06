import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
  sep,
} from "node:path";

import { homedir } from "@/lib/home-dir";
import { documentCapabilityFor } from "@/lib/services/document-ingestion-capabilities";
import { ingestDocumentFile } from "@/lib/services/document-ingestion";
import { resolveLocalDeliverableFile } from "@/lib/services/deliverable-file-resolution";
import { expandHomePath } from "@/lib/services/obsidian/vault-path";

export const HIVEMIND_OFFICE_SUPPORTED_EXTENSIONS = [
  ".docx",
  ".xlsx",
  ".pptx",
  ".xls",
  ".csv",
  ".pdf",
] as const;

export const HIVEMIND_OFFICE_SAVE_COPY_CONFIRMATION = "CONFIRM_HIVEMIND_OFFICE_SAVE_COPY";
export const HIVEMIND_OFFICE_REPLACE_ORIGINAL_CONFIRMATION = "CONFIRM_HIVEMIND_OFFICE_REPLACE_ORIGINAL";
export const HIVEMIND_OFFICE_MAX_FILE_BYTES = 64 * 1024 * 1024;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_INSPECTION_CHARS = 30_000;
const MAX_INSPECTION_CHARS = 100_000;
const REVIEW_FINGERPRINT_VERSION = "hivemind-office-review-v1";
const SUPPORTED_EXTENSION_SET = new Set<string>(HIVEMIND_OFFICE_SUPPORTED_EXTENSIONS);

export type HivemindOfficeUpdateMode = "copy" | "replace-original";

export type HivemindOfficeFileSnapshot = {
  path: string;
  name: string;
  extension: string;
  bytes: number;
  modifiedAt: string;
  sha256: string;
  capability: {
    kind: "document" | "spreadsheet" | "presentation" | "ebook" | "archive" | "text";
    label: string;
  };
};

export type HivemindOfficeDocumentInspection = HivemindOfficeFileSnapshot & {
  extracted?: {
    markdown: string;
    truncated: boolean;
    converterVersion: string;
    warnings: string[];
  };
};

export type HivemindOfficePreparedUpdate = {
  mode: HivemindOfficeUpdateMode;
  original: HivemindOfficeFileSnapshot;
  candidate: HivemindOfficeFileSnapshot;
  destinationPath: string;
  reviewFingerprint: string;
  requiredConfirmation: typeof HIVEMIND_OFFICE_SAVE_COPY_CONFIRMATION | typeof HIVEMIND_OFFICE_REPLACE_ORIGINAL_CONFIRMATION;
  reviewSteps: string[];
};

export type HivemindOfficeAppliedUpdate = {
  mode: HivemindOfficeUpdateMode;
  path: string;
  bytes: number;
  sha256: string;
  backupPath?: string;
  recovery: string;
};

type PathBoundaryOptions = {
  allowedRoots?: string[];
};

type PrepareUpdateInput = PathBoundaryOptions & {
  originalPath: string;
  candidatePath: string;
  destinationPath?: string;
  mode?: HivemindOfficeUpdateMode;
};

type ApplyUpdateInput = PrepareUpdateInput & {
  expectedOriginalSha256: string;
  expectedCandidateSha256: string;
  reviewFingerprint: string;
  confirmation: string;
};

export class HivemindOfficeBridgeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    message: string,
    code: string,
    status: number,
  ) {
    super(message);
    this.name = "HivemindOfficeBridgeError";
    this.code = code;
    this.status = status;
  }
}

function cleanPath(value: string, label: string) {
  const cleaned = String(value || "").trim().replace(/[\0\r\n]/g, "");
  if (!cleaned) throw new HivemindOfficeBridgeError(`${label} is required.`, "path_required", 400);
  return cleaned;
}

function supportedExtension(path: string) {
  const extension = extname(path).toLowerCase();
  if (!SUPPORTED_EXTENSION_SET.has(extension)) {
    throw new HivemindOfficeBridgeError(
      `Hivemind Office supports ${HIVEMIND_OFFICE_SUPPORTED_EXTENSIONS.join(", ")}; received ${extension || "a file without an extension"}.`,
      "unsupported_document_type",
      400,
    );
  }
  return extension;
}

function withinRoot(target: string, root: string) {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return target === root || target.startsWith(normalizedRoot);
}

async function resolvedAllowedRoots(roots: string[]) {
  const values = roots.length ? roots : [homedir()];
  return Promise.all(values.map(async (root) => {
    const absolute = resolve(expandHomePath(root));
    return realpath(absolute).catch(() => absolute);
  }));
}

async function resolveTestBoundedFile(rawPath: string, roots: string[]) {
  const expanded = expandHomePath(rawPath);
  if (!isAbsolute(expanded)) return null;
  const rootPaths = await resolvedAllowedRoots(roots);
  const path = await realpath(resolve(expanded)).catch(() => "");
  if (!path || !rootPaths.some((root) => withinRoot(path, root))) return null;
  const fileStats = await stat(path).catch(() => null);
  return fileStats?.isFile() ? path : null;
}

async function resolveOfficeReadableFile(rawPath: string, options: PathBoundaryOptions = {}) {
  const cleaned = cleanPath(rawPath, "Document path");
  const path = options.allowedRoots
    ? await resolveTestBoundedFile(cleaned, options.allowedRoots)
    : (await resolveLocalDeliverableFile(cleaned))?.path;
  if (!path) {
    throw new HivemindOfficeBridgeError(
      "Document does not exist, is not a regular file, or is outside the local home/vault boundary.",
      "document_not_available",
      404,
    );
  }
  supportedExtension(path);
  return path;
}

async function resolveOfficeWriteDestination(rawPath: string, options: PathBoundaryOptions = {}) {
  const cleaned = cleanPath(rawPath, "Destination path");
  const expanded = expandHomePath(cleaned);
  if (!isAbsolute(expanded)) {
    throw new HivemindOfficeBridgeError("Destination path must be absolute.", "destination_not_absolute", 400);
  }
  const absolute = resolve(expanded);
  supportedExtension(absolute);
  const parent = await realpath(dirname(absolute)).catch(() => "");
  const roots = await resolvedAllowedRoots(options.allowedRoots ?? [homedir()]);
  if (!parent || !roots.some((root) => withinRoot(parent, root))) {
    throw new HivemindOfficeBridgeError(
      "Destination folder does not exist or is outside the local home boundary.",
      "destination_not_available",
      400,
    );
  }
  return join(parent, basename(absolute));
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(typeof chunk === "string" ? chunk : Uint8Array.from(chunk)));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function snapshotFile(path: string): Promise<HivemindOfficeFileSnapshot> {
  const fileStats = await stat(path).catch(() => null);
  if (!fileStats?.isFile()) {
    throw new HivemindOfficeBridgeError("Document is no longer available.", "document_not_available", 404);
  }
  if (fileStats.size <= 0) {
    throw new HivemindOfficeBridgeError("Document is empty.", "document_empty", 400);
  }
  if (fileStats.size > HIVEMIND_OFFICE_MAX_FILE_BYTES) {
    throw new HivemindOfficeBridgeError("Document exceeds the 64 MB Hivemind Office bridge limit.", "document_too_large", 400);
  }
  await access(path, constants.R_OK);
  const extension = supportedExtension(path);
  const capability = documentCapabilityFor(path);
  if (!capability) {
    throw new HivemindOfficeBridgeError("Document type is not available to the bundled reader.", "unsupported_document_type", 400);
  }
  return {
    path,
    name: basename(path),
    extension,
    bytes: fileStats.size,
    modifiedAt: fileStats.mtime.toISOString(),
    sha256: await sha256File(path),
    capability: { kind: capability.kind, label: capability.label },
  };
}

function boundedInspectionChars(value: number | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_INSPECTION_CHARS;
  return Math.max(1_000, Math.min(MAX_INSPECTION_CHARS, Math.floor(Number(value))));
}

export async function inspectHivemindOfficeDocument(input: PathBoundaryOptions & {
  path: string;
  includeText?: boolean;
  maxChars?: number;
}): Promise<HivemindOfficeDocumentInspection> {
  const path = await resolveOfficeReadableFile(input.path, input);
  const snapshot = await snapshotFile(path);
  if (input.includeText === false) return snapshot;
  const converted = await ingestDocumentFile({
    filePath: path,
    sourceName: snapshot.name,
    maxInputBytes: HIVEMIND_OFFICE_MAX_FILE_BYTES,
    maxOutputChars: boundedInspectionChars(input.maxChars),
  });
  return {
    ...snapshot,
    extracted: {
      markdown: converted.markdown,
      truncated: converted.truncated,
      converterVersion: converted.converterVersion,
      warnings: converted.warnings,
    },
  };
}

async function pathExists(path: string) {
  return access(path).then(() => true, () => false);
}

async function availableCopyPath(originalPath: string) {
  const directory = dirname(originalPath);
  const extension = extname(originalPath);
  const stem = basename(originalPath, extension);
  for (let index = 0; index < 1_000; index += 1) {
    const suffix = index === 0 ? "" : ` ${index + 1}`;
    const candidate = join(directory, `${stem} (Hivemind Office Copy${suffix})${extension}`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new HivemindOfficeBridgeError("Could not reserve a copy name in the document folder.", "copy_name_unavailable", 409);
}

function updateFingerprint(input: {
  mode: HivemindOfficeUpdateMode;
  originalPath: string;
  originalSha256: string;
  candidatePath: string;
  candidateSha256: string;
  destinationPath: string;
}) {
  return createHash("sha256").update(JSON.stringify({
    version: REVIEW_FINGERPRINT_VERSION,
    ...input,
  })).digest("hex");
}

function requiredConfirmation(mode: HivemindOfficeUpdateMode) {
  return mode === "replace-original"
    ? HIVEMIND_OFFICE_REPLACE_ORIGINAL_CONFIRMATION
    : HIVEMIND_OFFICE_SAVE_COPY_CONFIRMATION;
}

function normalizeUpdateMode(mode: HivemindOfficeUpdateMode | undefined): HivemindOfficeUpdateMode {
  if (!mode || mode === "copy") return "copy";
  if (mode === "replace-original") return mode;
  throw new HivemindOfficeBridgeError("Update mode must be copy or replace-original.", "invalid_update_mode", 400);
}

export async function prepareHivemindOfficeUpdate(input: PrepareUpdateInput): Promise<HivemindOfficePreparedUpdate> {
  const mode = normalizeUpdateMode(input.mode);
  const [originalPath, candidatePath] = await Promise.all([
    resolveOfficeReadableFile(input.originalPath, input),
    resolveOfficeReadableFile(input.candidatePath, input),
  ]);
  if (originalPath === candidatePath) {
    throw new HivemindOfficeBridgeError("Candidate must be a separate file from the original.", "candidate_matches_original", 400);
  }
  const [original, candidate] = await Promise.all([snapshotFile(originalPath), snapshotFile(candidatePath)]);
  if (original.extension !== candidate.extension) {
    throw new HivemindOfficeBridgeError(
      `Candidate must keep the original ${original.extension} format.`,
      "candidate_format_mismatch",
      400,
    );
  }

  if (mode === "replace-original" && input.destinationPath) {
    throw new HivemindOfficeBridgeError("replace-original always targets the original path; omit destinationPath.", "unexpected_destination", 400);
  }
  const destinationPath = mode === "replace-original"
    ? originalPath
    : input.destinationPath
      ? await resolveOfficeWriteDestination(input.destinationPath, input)
      : await availableCopyPath(originalPath);
  if (mode === "copy" && (destinationPath === originalPath || destinationPath === candidatePath)) {
    throw new HivemindOfficeBridgeError("Copy destination must differ from the original and candidate.", "unsafe_destination", 400);
  }
  if (mode === "copy" && await pathExists(destinationPath)) {
    throw new HivemindOfficeBridgeError("Copy destination already exists; choose a new path.", "destination_exists", 409);
  }

  const reviewFingerprint = updateFingerprint({
    mode,
    originalPath,
    originalSha256: original.sha256,
    candidatePath,
    candidateSha256: candidate.sha256,
    destinationPath,
  });
  return {
    mode,
    original,
    candidate,
    destinationPath,
    reviewFingerprint,
    requiredConfirmation: requiredConfirmation(mode),
    reviewSteps: [
      "Open the candidate in Hivemind Office and inspect layout, formulas, media, and pagination.",
      "Confirm that the original and candidate hashes still match this review receipt.",
      mode === "copy"
        ? "Save the reviewed candidate as a new file; the original remains unchanged."
        : "Replace the original only after explicit confirmation; HivemindOS creates a sibling backup first.",
    ],
  };
}

function validateExpectedHash(value: string, label: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new HivemindOfficeBridgeError(`${label} must be a complete SHA-256 digest.`, "invalid_expected_hash", 400);
  }
  return normalized;
}

function assertReviewedSnapshot(
  prepared: HivemindOfficePreparedUpdate,
  input: ApplyUpdateInput,
) {
  const expectedOriginal = validateExpectedHash(input.expectedOriginalSha256, "Expected original hash");
  const expectedCandidate = validateExpectedHash(input.expectedCandidateSha256, "Expected candidate hash");
  if (prepared.original.sha256 !== expectedOriginal) {
    throw new HivemindOfficeBridgeError(
      "The original changed after review. Prepare the update again; no file was written.",
      "original_conflict",
      409,
    );
  }
  if (prepared.candidate.sha256 !== expectedCandidate) {
    throw new HivemindOfficeBridgeError(
      "The candidate changed after review. Inspect it and prepare the update again; no file was written.",
      "candidate_conflict",
      409,
    );
  }
  if (prepared.reviewFingerprint !== String(input.reviewFingerprint || "").trim().toLowerCase()) {
    throw new HivemindOfficeBridgeError(
      "Review fingerprint does not match the current paths, mode, and file hashes.",
      "review_fingerprint_mismatch",
      409,
    );
  }
  const confirmation = requiredConfirmation(prepared.mode);
  if (String(input.confirmation || "").trim() !== confirmation) {
    throw new HivemindOfficeBridgeError(
      `${prepared.mode === "copy" ? "Saving a copy" : "Replacing the original"} requires ${confirmation}.`,
      "confirmation_required",
      409,
    );
  }
}

async function verifiedExclusiveCopy(source: string, destination: string, expectedSha256: string) {
  await copyFile(source, destination, constants.COPYFILE_EXCL).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST") {
      throw new HivemindOfficeBridgeError("Destination appeared after review; no file was overwritten.", "destination_exists", 409);
    }
    throw error;
  });
  const actualSha256 = await sha256File(destination).catch(async (error) => {
    await rm(destination, { force: true });
    throw error;
  });
  if (actualSha256 !== expectedSha256) {
    await rm(destination, { force: true });
    throw new HivemindOfficeBridgeError("Candidate changed during copy; incomplete output was removed.", "candidate_copy_conflict", 409);
  }
}

async function unusedBackupPath(originalPath: string) {
  const extension = extname(originalPath);
  const stem = basename(originalPath, extension);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = join(dirname(originalPath), `${stem}.hivemind-office-backup-${stamp}${suffix}${extension}`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new HivemindOfficeBridgeError("Could not reserve a backup path.", "backup_path_unavailable", 409);
}

export async function applyHivemindOfficeUpdate(input: ApplyUpdateInput): Promise<HivemindOfficeAppliedUpdate> {
  const prepared = await prepareHivemindOfficeUpdate(input);
  assertReviewedSnapshot(prepared, input);

  if (prepared.mode === "copy") {
    await verifiedExclusiveCopy(prepared.candidate.path, prepared.destinationPath, prepared.candidate.sha256);
    const copied = await snapshotFile(prepared.destinationPath);
    return {
      mode: prepared.mode,
      path: copied.path,
      bytes: copied.bytes,
      sha256: copied.sha256,
      recovery: `Delete ${copied.path} to undo this save-copy action; the original was not changed.`,
    };
  }

  const backupPath = await unusedBackupPath(prepared.original.path);
  await verifiedExclusiveCopy(prepared.original.path, backupPath, prepared.original.sha256);
  const temporaryPath = join(
    dirname(prepared.original.path),
    `.${basename(prepared.original.path)}.hivemind-office-${process.pid}-${randomUUID()}.tmp`,
  );
  try {
    await verifiedExclusiveCopy(prepared.candidate.path, temporaryPath, prepared.candidate.sha256);
    const originalMode = (await stat(prepared.original.path)).mode;
    await chmod(temporaryPath, originalMode & 0o777);
    if (await sha256File(prepared.original.path) !== prepared.original.sha256) {
      throw new HivemindOfficeBridgeError(
        "The original changed while the replacement was being prepared. The original was preserved and the backup remains available.",
        "original_conflict",
        409,
      );
    }
    await rename(temporaryPath, prepared.original.path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  const replaced = await snapshotFile(prepared.original.path);
  if (replaced.sha256 !== prepared.candidate.sha256) {
    throw new HivemindOfficeBridgeError(
      `Replacement verification failed. Restore the original from ${backupPath}.`,
      "replacement_verification_failed",
      500,
    );
  }
  return {
    mode: prepared.mode,
    path: replaced.path,
    bytes: replaced.bytes,
    sha256: replaced.sha256,
    backupPath,
    recovery: `Restore ${backupPath} over ${replaced.path} to roll back this replacement.`,
  };
}
