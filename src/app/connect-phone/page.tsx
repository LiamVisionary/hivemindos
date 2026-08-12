"use client";

import type { CSSProperties } from "react";
import { usePairingQr } from "@/lib/phone/usePairingQr";

// "Connect phone" page: shows a QR encoding a clawcodemobile://pair deep link for
// this machine's HivemindOS hub. The companion app scans it (Settings →
// Connection → "Scan a pairing QR") to save this machine — no typing. The QR
// generation is shared with the dashboard's Connect-phone modal via usePairingQr.

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 20,
  padding: 32,
  color: "var(--foreground, #4a3a2a)",
  background:
    "radial-gradient(circle at 22% 18%, rgba(138, 90, 42, 0.11), transparent 22rem), radial-gradient(circle at 78% 78%, rgba(107, 143, 94, 0.14), transparent 24rem), linear-gradient(180deg, var(--bg-0, #f5efe6), var(--bg-1, #f8f4ec))",
  fontFamily: "system-ui, -apple-system, sans-serif",
  textAlign: "center",
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 24,
  fontWeight: 800,
  lineHeight: 1.15,
};

const bodyCopyStyle: CSSProperties = {
  maxWidth: 440,
  margin: 0,
  color: "var(--muted, #a09080)",
  lineHeight: 1.5,
};

const errorStyle: CSSProperties = {
  ...bodyCopyStyle,
  color: "#9f2f23",
  fontWeight: 700,
};

const qrStyle: CSSProperties = {
  border: "1px solid var(--border, #d8cdbb)",
  borderRadius: 8,
  background: "var(--surface, #f8f4ee)",
  boxShadow: "0 18px 40px rgba(82, 61, 22, 0.13)",
};

const codeStyle: CSSProperties = {
  maxWidth: "min(520px, 100%)",
  color: "var(--muted, #a09080)",
  fontSize: 13,
  overflowWrap: "anywhere",
};

export default function ConnectPhonePage() {
  const { qr, hubUrl, error } = usePairingQr();

  return (
    <main style={pageStyle}>
      <h1 style={headingStyle}>Connect your phone</h1>
      <p style={bodyCopyStyle}>
        In Hivemind Mobile, open <b>Settings → Connection</b>, tap <b>Scan a pairing QR</b>, and
        point it at this code. Your phone must be on this Tailscale network.
      </p>
      {error ? (
        <p style={errorStyle}>{error}</p>
      ) : qr ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="HivemindOS pairing QR" width={320} height={320} style={qrStyle} />
          <code style={codeStyle}>{hubUrl}</code>
        </>
      ) : (
        <p style={bodyCopyStyle}>Generating…</p>
      )}
    </main>
  );
}
