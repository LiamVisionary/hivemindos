import { NextRequest } from "next/server";

import {
  managedXReturnMessage,
  managedXReturnPayloadFromSearchParams,
} from "@/lib/services/managed-x-return";
import { storeManagedXDesktopReturn } from "@/lib/services/managed-x-desktop-return-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const payload = managedXReturnPayloadFromSearchParams(request.nextUrl.searchParams, request.nextUrl.toString());
  storeManagedXDesktopReturn(payload);
  const message = managedXReturnMessage(payload) || "X sign-in returned to HivemindOS.";

  return new Response(returnPageHtml({ message }), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}

function returnPageHtml(input: { message: string }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Return to HivemindOS</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #070b12; color: #edfdf9; }
      main { width: min(440px, calc(100vw - 32px)); border: 1px solid rgba(94, 234, 212, 0.22); border-radius: 14px; padding: 28px; background: rgba(13, 18, 31, 0.92); box-shadow: 0 28px 80px rgba(0, 0, 0, 0.4); }
      .eyebrow { margin: 0 0 10px; color: #5eead4; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
      h1 { margin: 0; font-size: 28px; line-height: 1.1; }
      p { margin: 14px 0 0; color: #b9c5ce; line-height: 1.55; }
      .receipt { display: inline-flex; align-items: center; gap: 10px; margin-top: 22px; color: #5eead4; font-weight: 800; }
      .pulse { width: 10px; height: 10px; border-radius: 999px; background: #5eead4; box-shadow: 0 0 0 0 rgba(94, 234, 212, 0.4); animation: pulse 1.4s ease-out infinite; }
      @keyframes pulse { to { box-shadow: 0 0 0 14px rgba(94, 234, 212, 0); } }
      @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">HivemindOS</p>
      <h1>Return received</h1>
      <p>${escapeHtml(input.message)}</p>
      <p>Return to the HivemindOS desktop window. It will refresh the managed X account automatically.</p>
      <div class="receipt"><span class="pulse" aria-hidden="true"></span>Ready in HivemindOS</div>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] ?? char));
}
