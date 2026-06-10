"use client";

import { usePairingQr } from "@/lib/phone/usePairingQr";

// "Connect phone" page: shows a QR encoding a clawcodemobile://pair deep link for
// this machine's HivemindOS hub. The companion app scans it (Settings →
// Connection → "Scan a pairing QR") to save this machine — no typing. The QR
// generation is shared with the dashboard's Connect-phone modal via usePairingQr.

export default function ConnectPhonePage() {
  const { qr, hubUrl, error } = usePairingQr();

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
        In Hivemind Mobile, open <b>Settings → Connection</b>, tap <b>Scan a pairing QR</b>, and
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
