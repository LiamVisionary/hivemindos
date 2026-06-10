"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { usePairingQr } from "@/lib/phone/usePairingQr";

// Pairing QR shown over the dashboard so a phone can be connected without
// leaving the current view. Mirrors the standalone /connect-phone page; both
// share the same QR generation via usePairingQr.
export function ConnectPhoneModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { qr, hubUrl, error } = usePairingQr(open);
  const portalTarget = typeof document === "undefined" ? null : document.body;

  // Dismiss on Escape, matching the app's other overlays.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !portalTarget) return null;

  return createPortal(
    (
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 py-8"
        role="dialog"
        aria-modal="true"
        aria-label="Connect your phone"
        onClick={onClose}
      >
        <div
          className="grid w-full max-w-md gap-5 overflow-hidden rounded-md border border-[rgba(148,163,184,0.20)] bg-[rgba(5,8,13,0.98)] p-7 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Phone</p>
              <h3 className="m-0 text-2xl font-bold">Connect your phone</h3>
            </div>
            <CloseIconButton aria-label="Close connect phone" onClick={onClose} />
          </div>
          <p className="m-0 text-sm leading-6 text-[var(--muted)]">
            In Hivemind Mobile, open <b>Settings → Connection</b>, tap <b>Scan a pairing QR</b>, and
            point it at this code. Your phone must be on this Tailscale network.
          </p>
          <div className="grid place-items-center gap-3">
            {error ? (
              <p className="m-0 text-sm text-[var(--danger)]">{error}</p>
            ) : qr ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  alt="HivemindOS pairing QR"
                  width={256}
                  height={256}
                  className="rounded-xl bg-white p-3"
                />
                <code className="text-xs text-[var(--muted)]">{hubUrl}</code>
              </>
            ) : (
              <p className="m-0 text-sm text-[var(--muted)]">Generating…</p>
            )}
          </div>
        </div>
      </div>
    ),
    portalTarget,
  );
}
