import { NextRequest } from "next/server";
import { deleteAppPreference, readAppPreferences, saveAppPreference } from "@/lib/services/fleet/app-preferences";

export const runtime = "nodejs";

export async function GET() {
  const preferences = await readAppPreferences();
  return Response.json({ ok: true, preferences });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  try {
    const preference = await saveAppPreference(body);
    return Response.json({ ok: true, preference });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not save app preference.",
    }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const appId = request.nextUrl.searchParams.get("appId") ?? "";
  try {
    await deleteAppPreference(appId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not delete app preference.",
    }, { status: 400 });
  }
}
