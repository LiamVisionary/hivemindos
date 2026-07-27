"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import {
  COMPANION_ASSETS,
  COMPANION_TOTAL_APPROX_BYTES,
} from "./companion-assets";
import {
  installCompanion,
  uninstallCompanion,
  type CompanionDownloadProgress,
} from "./companion-install";
import { setCompanionPopoverOpen } from "./companion-popover";
import { requestCompanionView } from "./companion-events";
import { useCompanionSettings } from "./use-companion-settings";

function formatMegabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

/** A labelled switch row for the companion's few boolean settings. */
function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs leading-5 text-[var(--muted)]">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-8 accent-[var(--accent)]"
      />
    </label>
  );
}

/**
 * Download-and-set-up flow for the hologram companion module. Opened from the
 * app nav shelf; the 3D model + animation clips (~40 MB) only download here,
 * so the app carries no 3D weight until the user opts in.
 */
export function CompanionSetupModal({ open, onClose, onOpenCompanionView }: {
  open: boolean;
  onClose: () => void;
  /** Navigate the dashboard to the fleet view (the companion tab lives there). */
  onOpenCompanionView?: () => void;
}) {
  const { settings, hydrated, setPopoverEnabled, setHologramEnabled } = useCompanionSettings();
  const [progress, setProgress] = useState<CompanionDownloadProgress | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const desktop = isTauriDesktopRuntime();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const startInstall = useCallback(async () => {
    setInstalling(true);
    setError(null);
    try {
      await installCompanion(setProgress);
    } catch (installError) {
      setError(
        installError instanceof Error
          ? installError.message
          : "The download did not finish. Check your connection and try again.",
      );
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  }, []);

  const removeCompanion = useCallback(async () => {
    setConfirmingRemove(false);
    setError(null);
    await setCompanionPopoverOpen(false);
    await uninstallCompanion();
  }, []);

  const togglePopover = useCallback(async (enabled: boolean) => {
    await setPopoverEnabled(enabled);
    await setCompanionPopoverOpen(enabled);
  }, [setPopoverEnabled]);

  if (!open || !portalTarget) return null;

  const fraction = progress?.fraction ?? 0;

  return createPortal(
    (
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-[rgba(34,29,20,0.34)] px-4 py-8 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-label="Hologram companion setup"
        onClick={onClose}
      >
        <div
          className="grid w-full max-w-md gap-5 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)] p-7 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Companion</p>
              <h3 className="m-0 text-2xl font-bold">Hologram companion</h3>
            </div>
            <CloseIconButton aria-label="Close companion setup" onClick={onClose} />
          </div>

          {!settings.installed ? (
            <>
              <p className="m-0 text-sm leading-6 text-[var(--muted)]">
                A 3D companion for your hive — Sara renders as a hologram in the
                Fleet view, idles, gestures, and lip-syncs while the Queen speaks.
                Setting up downloads the character model and animations
                ({formatMegabytes(COMPANION_TOTAL_APPROX_BYTES)},{" "}
                {COMPANION_ASSETS.length} files) so the app stays light until you
                want her.
              </p>
              {installing ? (
                <div className="grid gap-2">
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(fraction * 100)}
                    className="h-2 w-full overflow-hidden rounded-full bg-[var(--line)]"
                  >
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
                      style={{ width: `${Math.round(fraction * 100)}%` }}
                    />
                  </div>
                  <p className="m-0 text-xs text-[var(--muted)]">
                    {progress?.currentAsset
                      ? `Downloading ${progress.currentAsset.kind === "model" ? "Sara" : "animations"} · ${formatMegabytes(progress.downloadedBytes)} of ${formatMegabytes(progress.totalBytes)}`
                      : "Finishing up…"}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { void startInstall(); }}
                  disabled={!hydrated}
                  className="justify-self-start rounded-md border border-[var(--accent)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--surface)] disabled:opacity-50"
                >
                  Download &amp; set up
                </button>
              )}
            </>
          ) : (
            <>
              <p className="m-0 text-sm leading-6 text-[var(--muted)]">
                Sara is installed. Find her in the <b>Fleet</b> view under the new{" "}
                <b>companion</b> tab — she listens to the Queen&apos;s voice and
                speaks along.
              </p>
              <button
                type="button"
                onClick={() => {
                  onOpenCompanionView?.();
                  requestCompanionView();
                  onClose();
                }}
                className="justify-self-start rounded-md border border-[var(--accent)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--surface)]"
              >
                Open companion view
              </button>
              <div className="grid gap-4 border-t border-[var(--line)] pt-4">
                <ToggleRow
                  label="Hologram style"
                  hint="Render Sara as a scanline hologram (her signature look). Off shows her solid."
                  checked={settings.hologramEnabled}
                  onChange={(next) => { void setHologramEnabled(next); }}
                />
                <ToggleRow
                  label="Floating popover"
                  hint={desktop
                    ? "Keep a small always-on-top companion window floating over your desktop."
                    : "Available in the HivemindOS desktop app."}
                  checked={settings.popoverEnabled && desktop}
                  disabled={!desktop}
                  onChange={(next) => { void togglePopover(next); }}
                />
              </div>
              <div className="border-t border-[var(--line)] pt-4">
                {confirmingRemove ? (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-[var(--muted)]">
                      Remove the downloaded model and animations?
                    </span>
                    <button
                      type="button"
                      onClick={() => { void removeCompanion(); }}
                      className="rounded-md border border-[var(--danger)] px-3 py-1.5 text-xs font-semibold text-[var(--danger)]"
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingRemove(false)}
                      className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]"
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingRemove(true)}
                    className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)]"
                  >
                    Uninstall companion…
                  </button>
                )}
              </div>
            </>
          )}

          {error ? <p className="m-0 text-sm text-[var(--danger)]">{error}</p> : null}
        </div>
      </div>
    ),
    portalTarget,
  );
}

export default CompanionSetupModal;
