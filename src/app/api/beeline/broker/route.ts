import { NextRequest } from "next/server";
import { normalizeHivemindosWalletPaidSlug } from "@/lib/config/hivemindos-wallet-paid-models";
import { resolveBeelineBrokerCredential } from "@/lib/services/beeline/broker-account";
import {
  createBeelineMcpConnection,
  getBeelineBrokerConnections,
  getBeelineBrokerStatus,
  revokeBeelineBrokerConnection,
  runBeelineCalendarAction,
  runBeelineMcpAction,
  startBeelineGoogleOAuth,
} from "@/lib/services/beeline/broker-client";
import { readBeelineProfiles } from "@/lib/services/beeline/profile-store";
import type { BeelineBrokerConnection, BeelineCapability, BeelineProfile } from "@/lib/types/beeline";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { verifyAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BrokerBody = {
  action?: string;
  profileId?: string;
  returnUrl?: string;
  connectionId?: string;
  label?: string;
  capability?: BeelineCapability;
  endpointUrl?: string;
  bearerToken?: string;
  operation?: string;
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  event?: unknown;
  request?: unknown;
  confirmation?: string;
  idempotencyKey?: string;
  slug?: string;
};

export async function GET(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  const status = await getBeelineBrokerStatus();
  const profileId = new URL(request.url).searchParams.get("profileId")?.trim() || "";
  const profile = profileId ? await profileById(profileId) : null;
  if (profileId && !profile) return errorJson("Beeline profile was not found.", 404);
  const credential = await resolveBeelineBrokerCredential("default");
  if (!profile) return okJson({ status, credentialConfigured: Boolean(credential.token), connections: [] });
  if (profile.consent.status !== "confirmed") {
    return okJson({ status, credentialConfigured: Boolean(credential.token), connections: [], authority: profile.consent.status });
  }
  if (!credential.token) return okJson({ status, credentialConfigured: false, connections: [] });
  return proxyConnections(status, credential.token, profile.id, credential.slug);
}

export async function POST(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({})) as BrokerBody;
  const profile = await profileById(body.profileId?.trim() || "");
  if (!profile) return errorJson("Beeline profile was not found.", 404);
  if (profile.consent.status !== "confirmed") return errorJson("Confirm Beeline authority before connecting or using family services.", 403);
  const slug = normalizeHivemindosWalletPaidSlug(body.slug);
  const credential = await resolveBeelineBrokerCredential(slug);
  if (!credential.token) return errorJson("No HivemindOS hosted account credential is available for the Beeline broker.", 424);

  switch (body.action) {
    case "google-oauth-start":
      if (!hasCapability(profile, "calendar")) return capabilityError("calendar");
      return startBeelineGoogleOAuth({
        request,
        creditToken: credential.token,
        profileId: profile.id,
        slug: credential.slug,
        returnUrl: body.returnUrl,
      });
    case "mcp-connect":
      if (!body.capability || !hasCapability(profile, body.capability)) return capabilityError(body.capability || "selected");
      return createBeelineMcpConnection({
        creditToken: credential.token,
        profileId: profile.id,
        slug: credential.slug,
        label: body.label?.trim() || "",
        capability: body.capability,
        endpointUrl: body.endpointUrl?.trim() || "",
        bearerToken: body.bearerToken,
      });
    case "disconnect":
      return revokeBeelineBrokerConnection(
        credential.token,
        profile.id,
        body.connectionId?.trim() || "",
        credential.slug,
      );
    case "calendar-list":
      if (!hasCapability(profile, "calendar")) return capabilityError("calendar");
      return runBeelineCalendarAction({ request, creditToken: credential.token, slug: credential.slug, body: {
        profileId: profile.id,
        connectionId: body.connectionId,
        operation: "list",
        calendarId: body.calendarId,
        timeMin: body.timeMin,
        timeMax: body.timeMax,
        maxResults: body.maxResults,
      } });
    case "calendar-create":
      if (!hasCapability(profile, "calendar")) return capabilityError("calendar");
      if (body.confirmation !== "CONFIRM_BEELINE_CALENDAR") {
        return errorJson("Calendar creation requires CONFIRM_BEELINE_CALENDAR.", 409);
      }
      if (!validIdempotencyKey(body.idempotencyKey)) return idempotencyError();
      return runBeelineCalendarAction({ request, creditToken: credential.token, slug: credential.slug, idempotencyKey: body.idempotencyKey, body: {
        profileId: profile.id,
        connectionId: body.connectionId,
        operation: "create",
        calendarId: body.calendarId,
        event: body.event,
        confirmation: body.confirmation,
      } });
    case "mcp-read":
    case "mcp-call": {
      const connection = await brokerConnection(credential.token, credential.slug, profile.id, body.connectionId || "");
      if (!connection) return errorJson("MCP connection was not found for this Beeline profile.", 404);
      if (!hasCapability(profile, connection.capability)) return capabilityError(connection.capability);
      if (body.action === "mcp-call" && body.confirmation !== "CONFIRM_BEELINE_MCP_ACTION") {
        return errorJson("MCP tools/call requires CONFIRM_BEELINE_MCP_ACTION.", 409);
      }
      if (body.action === "mcp-call" && !validIdempotencyKey(body.idempotencyKey)) return idempotencyError();
      return runBeelineMcpAction({ request, creditToken: credential.token, slug: credential.slug, idempotencyKey: body.idempotencyKey, body: {
        profileId: profile.id,
        connectionId: connection.id,
        request: body.request,
        confirmation: body.confirmation,
      } });
    }
    default:
      return errorJson(`Unknown Beeline broker action "${body.action || ""}".`);
  }
}

async function authorize(request: NextRequest) {
  const auth = await verifyAuth(request);
  return auth.userId ? null : errorJson(auth.reason || "Dashboard authentication is required.", 401);
}

async function profileById(profileId: string): Promise<BeelineProfile | null> {
  if (!profileId) return null;
  return (await readBeelineProfiles()).profiles.find((profile) => profile.id === profileId) || null;
}

async function proxyConnections(
  status: Awaited<ReturnType<typeof getBeelineBrokerStatus>>,
  token: string,
  profileId: string,
  slug: string,
) {
  const response = await getBeelineBrokerConnections(token, profileId, slug);
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    return errorJson(
      typeof data.error === "string" ? data.error : "Could not load Beeline connections.",
      response.status,
      { status, credentialConfigured: true, connections: [] },
    );
  }
  return okJson({
    status,
    credentialConfigured: true,
    connections: Array.isArray(data.connections) ? data.connections : [],
  });
}

async function brokerConnection(token: string, slug: string, profileId: string, connectionId: string) {
  const response = await getBeelineBrokerConnections(token, profileId, slug);
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({})) as { connections?: BeelineBrokerConnection[] };
  return data.connections?.find((connection) => connection.id === connectionId && connection.provider === "mcp") || null;
}

function hasCapability(profile: BeelineProfile, capability: string): capability is BeelineCapability {
  return profile.capabilities.includes(capability as BeelineCapability);
}

function capabilityError(capability: string) {
  return errorJson(`This Beeline profile does not allow the ${capability} capability.`, 403);
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,200}$/.test(value);
}

function idempotencyError() {
  return errorJson("Write actions require an idempotencyKey of 8–200 letters, numbers, dots, colons, underscores, or hyphens.", 400);
}
