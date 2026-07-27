import { NextRequest } from "next/server";
import { resolveBeelineBrokerCredential } from "@/lib/services/beeline/broker-account";
import {
  getBeelineBrokerConnections,
  revokeBeelineBrokerConnection,
} from "@/lib/services/beeline/broker-client";
import {
  BeelineProfileNotFoundError,
  deleteBeelineProfile,
  readBeelineProfiles,
  updateBeelineProfile,
} from "@/lib/services/beeline/profile-store";
import {
  deleteLocalBeelineProfileCredentials,
  NativeBeelineCredentialBrokerUnavailableError,
} from "@/lib/services/beeline/local-credential-broker";
import type { BeelineBrokerConnection } from "@/lib/types/beeline";
import type { BeelineProfileUpdateInput } from "@/lib/types/beeline";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { verifyAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(request: NextRequest) {
  const auth = await verifyAuth(request);
  return auth.userId ? null : errorJson(auth.reason ?? "Dashboard authentication is required.", 401);
}

function failure(error: unknown, fallback: string) {
  return errorJson(
    error instanceof Error ? error.message : fallback,
    error instanceof BeelineProfileNotFoundError ? 404 : 400,
  );
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as BeelineProfileUpdateInput;
    return okJson({ profile: await updateBeelineProfile(id, body) });
  } catch (error) {
    return failure(error, "Could not update the Beeline profile.");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const profileExists = (await readBeelineProfiles()).profiles.some((profile) => profile.id === id);
    if (!profileExists) throw new BeelineProfileNotFoundError(id);
    const cleanupFailure = await revokeHostedConnections(id);
    if (cleanupFailure) return cleanupFailure;
    try {
      await deleteLocalBeelineProfileCredentials(id);
    } catch (error) {
      if (!(error instanceof NativeBeelineCredentialBrokerUnavailableError)) throw error;
    }
    await deleteBeelineProfile(id);
    return okJson({ deleted: true });
  } catch (error) {
    return failure(error, "Could not delete the Beeline profile.");
  }
}

async function revokeHostedConnections(profileId: string) {
  const credential = await resolveBeelineBrokerCredential("default");
  if (!credential.token) return null;
  const response = await getBeelineBrokerConnections(credential.token, profileId, credential.slug);
  const data = await response.json().catch(() => ({})) as {
    connections?: BeelineBrokerConnection[];
    error?: string;
  };
  if (!response.ok) {
    return errorJson(data.error || "Could not inspect hosted Beeline connections before deleting the profile.", 502);
  }
  for (const connection of data.connections || []) {
    const revoked = await revokeBeelineBrokerConnection(credential.token, profileId, connection.id, credential.slug);
    if (!revoked.ok) {
      const failure = await revoked.json().catch(() => ({})) as { error?: string };
      return errorJson(failure.error || `Could not revoke the hosted connection ${connection.id}.`, 502);
    }
  }
  return null;
}
