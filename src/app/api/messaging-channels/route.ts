import { NextRequest, NextResponse } from "next/server";
import {
  deleteMessagingChannel,
  listMessagingChannels,
  sendHiveMessage,
  upsertMessagingChannel,
} from "@/lib/services/messaging/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const result = await listMessagingChannels(optionsFromRequest(request));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const options = optionsFromRequest(request, body);
    if (body.action === "send" || body.action === "test") {
      const result = await sendHiveMessage({
        ...options,
        channelId: String(body.channelId || ""),
        message: body.message || "HivemindOS test message.",
      });
      return NextResponse.json({ ok: true, result });
    }
    const result = await upsertMessagingChannel(body.channel ?? body, options);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const options = optionsFromRequest(request, body);
    const result = await upsertMessagingChannel(body.channel ?? body, options);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const options = optionsFromRequest(request, body);
    const id = request.nextUrl.searchParams.get("id") || body.id;
    const result = await deleteMessagingChannel(String(id || ""), options);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

function optionsFromRequest(request: NextRequest, body?: { vaultPath?: string; brainServicesFolder?: string }) {
  return {
    vaultPath: request.nextUrl.searchParams.get("vaultPath") ?? body?.vaultPath,
    brainServicesFolder: request.nextUrl.searchParams.get("brainServicesFolder") ?? body?.brainServicesFolder,
  };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Messaging channels request failed.";
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}
