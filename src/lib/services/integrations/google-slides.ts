import { z } from "zod";

import { mintGoogleAccessToken } from "@/lib/services/integrations/google-oauth";

const GOOGLE_SLIDES_ORIGIN = "https://slides.googleapis.com";
const GOOGLE_DRIVE_ORIGIN = "https://www.googleapis.com";
const GOOGLE_API_TIMEOUT_MS = 30_000;
const MAX_GOOGLE_API_RESPONSE_BYTES = 8_000_000;
const MAX_BATCH_REQUESTS = 100;

export const GOOGLE_SLIDES_EDIT_CONFIRMATION = "CONFIRM_GOOGLE_SLIDES_EDIT";

const presentationIdSchema = z
  .string()
  .trim()
  .min(10)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/, "Google presentation IDs may contain only letters, numbers, underscores, and hyphens.");

const pageObjectIdSchema = z.string().trim().min(1).max(256);
const googleSlidesRequestSchema = z.record(z.string(), z.unknown());

export const googleSlidesReadSchema = z.object({
  action: z.enum(["list", "get", "thumbnail"]).default("list"),
  presentationId: presentationIdSchema.optional(),
  pageObjectId: pageObjectIdSchema.optional(),
  search: z.string().trim().max(200).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().trim().max(2_000).optional(),
  thumbnailSize: z.enum(["SMALL", "MEDIUM", "LARGE"]).optional(),
  thumbnailMimeType: z.enum(["PNG", "JPG"]).optional(),
}).superRefine((input, context) => {
  if ((input.action === "get" || input.action === "thumbnail") && !input.presentationId) {
    context.addIssue({ code: "custom", path: ["presentationId"], message: `${input.action} requires presentationId.` });
  }
  if (input.action === "thumbnail" && !input.pageObjectId) {
    context.addIssue({ code: "custom", path: ["pageObjectId"], message: "thumbnail requires pageObjectId." });
  }
});

const replacementSchema = z.object({
  find: z.string().min(1).max(10_000),
  replace: z.string().max(100_000),
  matchCase: z.boolean().optional(),
  pageObjectIds: z.array(pageObjectIdSchema).min(1).max(100).optional(),
});

export const googleSlidesEditSchema = z.object({
  action: z.enum(["create", "replace-all-text", "batch-update"]),
  presentationId: presentationIdSchema.optional(),
  title: z.string().trim().min(1).max(1_000).optional(),
  replacements: z.array(replacementSchema).min(1).max(MAX_BATCH_REQUESTS).optional(),
  requests: z.array(googleSlidesRequestSchema).min(1).max(MAX_BATCH_REQUESTS).optional(),
  requiredRevisionId: z.string().trim().min(1).max(256).optional(),
  confirmation: z.string().optional(),
}).superRefine((input, context) => {
  if (input.action === "create" && !input.title) {
    context.addIssue({ code: "custom", path: ["title"], message: "create requires title." });
  }
  if (input.action !== "create" && !input.presentationId) {
    context.addIssue({ code: "custom", path: ["presentationId"], message: `${input.action} requires presentationId.` });
  }
  if (input.action === "replace-all-text" && !input.replacements?.length) {
    context.addIssue({ code: "custom", path: ["replacements"], message: "replace-all-text requires replacements." });
  }
  if (input.action === "batch-update" && !input.requests?.length) {
    context.addIssue({ code: "custom", path: ["requests"], message: "batch-update requires requests." });
  }
});

export type GoogleSlidesReadInput = z.infer<typeof googleSlidesReadSchema>;
export type GoogleSlidesEditInput = z.infer<typeof googleSlidesEditSchema>;

type GoogleSlidesDependencies = {
  mintAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
};

type GoogleApiErrorPayload = {
  error?: { message?: string; status?: string; code?: number } | string;
  error_description?: string;
};

export async function readGoogleSlides(
  input: GoogleSlidesReadInput,
  dependencies: GoogleSlidesDependencies = {},
): Promise<unknown> {
  if (input.action === "list") {
    const query = [
      "mimeType = 'application/vnd.google-apps.presentation'",
      "trashed = false",
      ...(input.search ? [`name contains '${escapeDriveQueryLiteral(input.search)}'`] : []),
    ].join(" and ");
    const params = new URLSearchParams({
      q: query,
      pageSize: String(input.pageSize ?? 25),
      orderBy: "modifiedTime desc",
      fields: "nextPageToken,files(id,name,modifiedTime,createdTime,webViewLink,owners(displayName,emailAddress))",
    });
    if (input.pageToken) params.set("pageToken", input.pageToken);
    return googleApiJson(`${GOOGLE_DRIVE_ORIGIN}/drive/v3/files?${params}`, {}, dependencies);
  }

  const presentationId = input.presentationId as string;
  if (input.action === "get") {
    return googleApiJson(
      `${GOOGLE_SLIDES_ORIGIN}/v1/presentations/${encodeURIComponent(presentationId)}`,
      {},
      dependencies,
    );
  }

  const params = new URLSearchParams({
    "thumbnailProperties.mimeType": input.thumbnailMimeType ?? "PNG",
    "thumbnailProperties.thumbnailSize": input.thumbnailSize ?? "LARGE",
  });
  return googleApiJson(
    `${GOOGLE_SLIDES_ORIGIN}/v1/presentations/${encodeURIComponent(presentationId)}/pages/${encodeURIComponent(input.pageObjectId as string)}/thumbnail?${params}`,
    {},
    dependencies,
  );
}

export async function editGoogleSlides(
  input: GoogleSlidesEditInput,
  dependencies: GoogleSlidesDependencies = {},
): Promise<unknown> {
  if (input.confirmation !== GOOGLE_SLIDES_EDIT_CONFIRMATION) {
    throw new Error(`Google Slides edits require confirmation ${GOOGLE_SLIDES_EDIT_CONFIRMATION}.`);
  }

  if (input.action === "create") {
    return googleApiJson(
      `${GOOGLE_SLIDES_ORIGIN}/v1/presentations`,
      googleJsonInit("POST", { title: input.title }),
      dependencies,
    );
  }

  const requests = input.action === "replace-all-text"
    ? input.replacements?.map((replacement) => ({
        replaceAllText: {
          containsText: {
            text: replacement.find,
            matchCase: replacement.matchCase ?? false,
          },
          replaceText: replacement.replace,
          ...(replacement.pageObjectIds ? { pageObjectIds: replacement.pageObjectIds } : {}),
        },
      }))
    : input.requests;

  return googleApiJson(
    `${GOOGLE_SLIDES_ORIGIN}/v1/presentations/${encodeURIComponent(input.presentationId as string)}:batchUpdate`,
    googleJsonInit("POST", {
      requests,
      ...(input.requiredRevisionId
        ? { writeControl: { requiredRevisionId: input.requiredRevisionId } }
        : {}),
    }),
    dependencies,
  );
}

function googleJsonInit(method: "POST", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function googleApiJson(
  url: string,
  init: RequestInit,
  dependencies: GoogleSlidesDependencies,
): Promise<unknown> {
  const mintAccessToken = dependencies.mintAccessToken ?? mintGoogleAccessToken;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const accessToken = await mintAccessToken();
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS),
  });

  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > MAX_GOOGLE_API_RESPONSE_BYTES) {
    throw new Error("Google Slides returned more data than HivemindOS can safely process in one call.");
  }
  const text = await response.text();
  if (text.length > MAX_GOOGLE_API_RESPONSE_BYTES) {
    throw new Error("Google Slides returned more data than HivemindOS can safely process in one call.");
  }
  const payload = text ? safeJson(text) : null;
  if (!response.ok) {
    throw new Error(googleApiError(payload, response.status));
  }
  return payload;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Google returned a non-JSON response.");
  }
}

function googleApiError(payload: unknown, status: number): string {
  const record = payload && typeof payload === "object" ? payload as GoogleApiErrorPayload : null;
  const nestedError = record?.error && typeof record.error === "object" ? record.error : null;
  const message = nestedError?.message
    || (typeof record?.error === "string" ? record.error : "")
    || record?.error_description;
  if (message) return message;
  if (status === 403) {
    return "Google denied Slides access. Reconnect Google in Integrations to grant the presentation editing scope.";
  }
  return `Google Slides returned HTTP ${status}.`;
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
