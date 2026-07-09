"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { clawMobilePairingUrl, hubUrlForPairingHost } from "@/lib/phone/pairing-url";
import { nativeDashboardToken, nativePairingHost } from "@/lib/native/setup";

// Builds the clawcodemobile://pair QR for this machine's HivemindOS hub. Shared
// by the /connect-phone page and the dashboard's Connect-phone modal so the
// pairing logic (and its tailnet-address quirks) lives in one place. Pass
// `enabled` (e.g. a modal's open state) to defer the fetch until it's shown.
export function usePairingQr(enabled = true) {
  const [qr, setQr] = useState<string | null>(null);
  const [hubUrl, setHubUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        // Prefer the desktop app's own bridge address (system-Tailscale IP the
        // phone bridge binds). The dashboard device list can report a different
        // "self" — hivemind-linkd runs a separate embedded tsnet node — and a QR
        // built from that node has no bridge on the dashboard port, so the phone
        // times out. Fall back to the device list off-desktop / Tailscale-down.
        let host = (await nativePairingHost()) ?? "";
        let name = host;
        let machineId: string | undefined;

        if (!host) {
          const res = await fetch("/api/tailscale/devices");
          const data = await res.json();
          const devices: any[] = data?.devices ?? [];
          const self = devices.find((d) => d?.self) ?? devices[0];
          // Prefer the raw tailnet IP over the MagicDNS name: the companion app's
          // fetch can't rely on MagicDNS resolving on-device (Tailscale DNS may be
          // off for the app), but a 100.x tailnet IP always routes over the tunnel.
          // The name only resolves in some setups; the IP resolves in all of them.
          host = self?.ip || (self?.dnsName ? String(self.dnsName).replace(/\.$/, "") : "") || "";
          name = (self?.dnsName ? String(self.dnsName).split(".")[0] : "") || host;
          machineId = self?.machineId;
        }

        if (!host) {
          if (!cancelled) setError("Couldn't determine this machine's tailnet address. Is Tailscale up?");
          return;
        }
        // Provision the dashboard device token into the QR so the paired phone
        // authenticates to this hub's /api gate with no user-visible token step.
        // Native-first: the desktop webview has NO /api session in dev (its data
        // comes via native commands), so a bare /api/phone/pairing-token fetch
        // 401s and the QR would silently ship token-less — that produced the
        // "hub rejected your device token" the phone now surfaces. Read the token
        // straight from the native app; fall back to the gated route only when
        // native is unavailable (off-desktop / packaged webview WITH a session).
        let token: string | undefined;
        let authConfirmedOff = false;
        const nativeTok = await nativeDashboardToken();
        if (nativeTok) {
          token = nativeTok;
        } else {
          try {
            const tokRes = await fetch("/api/phone/pairing-token");
            if (tokRes.ok) {
              const tokData = await tokRes.json();
              if (typeof tokData?.token === "string" && tokData.token) token = tokData.token;
              // Route answered 200 with no token ⇒ this hub has auth genuinely
              // off; a token-less QR is CORRECT (not a silent failure).
              else if (tokData?.ok === true) authConfirmedOff = true;
            }
          } catch {
            // fetch failed → couldn't determine; handled by the fail-loud below.
          }
        }
        // The phone no longer has a gateway token fallback, so a token-less QR
        // against an auth-ON hub silently pairs a dead code. Only pair token-less
        // when auth is CONFIRMED off; otherwise fail loud so the user retries
        // instead of scanning a QR the hub will reject.
        if (!token && !authConfirmedOff) {
          if (!cancelled)
            setError(
              "Couldn't read this hub's pairing token. Reopen this screen (or restart HivemindOS) and try again.",
            );
          return;
        }
        const url = hubUrlForPairingHost(host);
        const pair = clawMobilePairingUrl({ hubUrl: url, name, machineId, token });
        const dataUrl = await QRCode.toDataURL(pair, { width: 320, margin: 2 });
        if (!cancelled) {
          setError(null);
          setHubUrl(url);
          setQr(dataUrl);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to build the pairing code.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { qr, hubUrl, error };
}
