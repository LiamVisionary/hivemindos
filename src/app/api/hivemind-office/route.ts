import { type NextRequest } from "next/server";

import {
  applyHivemindOfficeUpdate,
  HIVEMIND_OFFICE_MAX_FILE_BYTES,
  HIVEMIND_OFFICE_REPLACE_ORIGINAL_CONFIRMATION,
  HIVEMIND_OFFICE_SAVE_COPY_CONFIRMATION,
  HIVEMIND_OFFICE_SUPPORTED_EXTENSIONS,
  HivemindOfficeBridgeError,
  inspectHivemindOfficeDocument,
  prepareHivemindOfficeUpdate,
  type HivemindOfficeUpdateMode,
} from "@/lib/services/hivemind-office-bridge";
import {
  openHivemindOfficeApp,
  readHivemindOfficeInstallableServiceStatus,
} from "@/lib/services/hivemind-office-installable";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OfficeAction = "status" | "inspect" | "open" | "prepare-update" | "apply-update";

type OfficeRequestBody = {
  action?: unknown;
  path?: unknown;
  includeText?: unknown;
  maxChars?: unknown;
  originalPath?: unknown;
  candidatePath?: unknown;
  destinationPath?: unknown;
  mode?: unknown;
  expectedOriginalSha256?: unknown;
  expectedCandidateSha256?: unknown;
  reviewFingerprint?: unknown;
  confirmation?: unknown;
};

function officeAction(value: unknown): OfficeAction {
  if (value === "status" || value === "inspect" || value === "open" || value === "prepare-update" || value === "apply-update") {
    return value;
  }
  throw new HivemindOfficeBridgeError("Unknown Hivemind Office action.", "unknown_action", 400);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, label: string) {
  const clean = optionalString(value);
  if (!clean) throw new HivemindOfficeBridgeError(`${label} is required.`, "invalid_request", 400);
  return clean;
}

function updateMode(value: unknown): HivemindOfficeUpdateMode {
  if (value === undefined || value === null || value === "" || value === "copy") return "copy";
  if (value === "replace-original") return value;
  throw new HivemindOfficeBridgeError("mode must be copy or replace-original.", "invalid_update_mode", 400);
}

function bridgeContract() {
  return {
    supportedExtensions: [...HIVEMIND_OFFICE_SUPPORTED_EXTENSIONS],
    maxFileBytes: HIVEMIND_OFFICE_MAX_FILE_BYTES,
    defaultWriteMode: "copy",
    confirmations: {
      saveCopy: HIVEMIND_OFFICE_SAVE_COPY_CONFIRMATION,
      replaceOriginal: HIVEMIND_OFFICE_REPLACE_ORIGINAL_CONFIRMATION,
    },
    authority: "HivemindOS owns agent routing, path validation, review hashes, confirmations, and writes. The desktop companion owns visual editing only.",
  };
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return okJson({
      service: await readHivemindOfficeInstallableServiceStatus(),
      bridge: bridgeContract(),
      verdict: "conditionally-approved",
    });
  } catch (error) {
    return officeError(error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const parsed = await request.json().catch(() => null) as OfficeRequestBody | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return errorJson("A JSON request body is required.");
    }
    const action = officeAction(parsed.action ?? "status");
    if (action === "status") {
      return okJson({
        service: await readHivemindOfficeInstallableServiceStatus(),
        bridge: bridgeContract(),
        verdict: "conditionally-approved",
      });
    }
    if (action === "inspect") {
      const document = await inspectHivemindOfficeDocument({
        path: requiredString(parsed.path, "path"),
        includeText: parsed.includeText !== false,
        maxChars: typeof parsed.maxChars === "number" ? parsed.maxChars : undefined,
      });
      return okJson({ document });
    }
    if (action === "open") {
      const opened = await openHivemindOfficeApp(requiredString(parsed.path, "path"));
      return okJson({ opened });
    }
    if (action === "prepare-update") {
      const review = await prepareHivemindOfficeUpdate({
        originalPath: requiredString(parsed.originalPath, "originalPath"),
        candidatePath: requiredString(parsed.candidatePath, "candidatePath"),
        destinationPath: optionalString(parsed.destinationPath),
        mode: updateMode(parsed.mode),
      });
      return okJson({ review });
    }
    const result = await applyHivemindOfficeUpdate({
      originalPath: requiredString(parsed.originalPath, "originalPath"),
      candidatePath: requiredString(parsed.candidatePath, "candidatePath"),
      destinationPath: optionalString(parsed.destinationPath),
      mode: updateMode(parsed.mode),
      expectedOriginalSha256: requiredString(parsed.expectedOriginalSha256, "expectedOriginalSha256"),
      expectedCandidateSha256: requiredString(parsed.expectedCandidateSha256, "expectedCandidateSha256"),
      reviewFingerprint: requiredString(parsed.reviewFingerprint, "reviewFingerprint"),
      confirmation: requiredString(parsed.confirmation, "confirmation"),
    });
    return okJson({ result });
  } catch (error) {
    return officeError(error);
  }
}

function officeError(error: unknown) {
  if (error instanceof HivemindOfficeBridgeError) {
    return errorJson(error.message, error.status, { code: error.code });
  }
  const message = error instanceof Error ? error.message : "Hivemind Office action failed.";
  const status = /install a compatible|automatic install is blocked/i.test(message) ? 409 : 500;
  return errorJson(message, status);
}
