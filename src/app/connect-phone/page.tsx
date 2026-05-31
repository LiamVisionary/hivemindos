"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

// "Connect phone" page: shows a QR encoding a clawcodemobile://pair deep link for
// this machine's HivemindOS hub. The companion app scans it (Settings →
// Connection → "Scan a pairing QR") to save this machine — no typing. Reuses the
// existing /api/tailscale/devices to find this machine's stable tailnet address.
const DASHBOARD_PORT = 5020;

export default function ConnectPhonePage() {
  const [qr, setQr] = useState<string | null>(null);
  const [hubUrl, setHubUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/tailscale/devices");
        const data = await res.json();
        const devices: any[] = data?.devices ?? [];
        const self = devices.find((d) => d?.self) ?? devices[0];
        // Prefer the raw tailnet IP over the MagicDNS name: the companion app's
        // fetch can't rely on MagicDNS resolving on-device (Tailscale DNS may be
        // off for the app), but a 100.x tailnet IP always routes over the tunnel.
        // The name only resolves in some setups; the IP resolves in all of them.
        const host = self?.ip || (self?.dnsName ? String(self.dnsName).replace(/\.$/, "") : "") || "";
        if (!host) {
          setError("Couldn't determine this machine's tailnet address. Is Tailscale up?");
          return;
        }
        const url = `http://${host}:${DASHBOARD_PORT}`;
        const name = (self?.dnsName ? String(self.dnsName).split(".")[0] : "") || host;
        setHubUrl(url);
        const pair = `clawcodemobile://pair?hub=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
        setQr(await QRCode.toDataURL(pair, { width: 320, margin: 2 }));
      } catch (e: any) {
        setError(e?.message || "Failed to build the pairing code.");
      }
    })();
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: 32,
        fontFamily: "system-ui, -apple-system, sans-serif",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Connect your phone</h1>
      <p style={{ color: "#666", maxWidth: 440, lineHeight: 1.5 }}>
        In Claw Code Mobile, open <b>Settings → Connection</b>, tap <b>Scan a pairing QR</b>, and
        point it at this code. Your phone must be on this Tailscale network.
      </p>
      {error ? (
        <p style={{ color: "#b00020" }}>{error}</p>
      ) : qr ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="HivemindOS pairing QR" width={320} height={320} style={{ borderRadius: 12 }} />
          <code style={{ color: "#888", fontSize: 13 }}>{hubUrl}</code>
        </>
      ) : (
        <p style={{ color: "#888" }}>Generating…</p>
      )}
    </main>
  );
}
