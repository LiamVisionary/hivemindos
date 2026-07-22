"use client";

import { X } from "lucide-react";

import { BrowserProfileConnectFlow } from "@/components/socials/BrowserProfileConnectFlow";

import { useMarketplaceDesk } from "./marketplace-context";

/** Marketplace wrapper around the shared browser-profile connect flow. */
export function ConnectFacebookModal() {
  const desk = useMarketplaceDesk();
  if (!desk.connectOpen) return null;
  const facebook = desk.providers.find((provider) => provider.provider === "facebook");
  const label = facebook?.label ?? "Facebook Marketplace";
  const close = () => desk.setConnectOpen(false);
  return (
    <div
      className="mkt-root"
      data-theme={desk.theme}
      role="dialog"
      aria-modal="true"
      aria-label={`Connect ${label}`}
      onClick={close}
      style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", padding: 20, background: "color-mix(in srgb, var(--bg) 62%, transparent)", backdropFilter: "blur(14px)" }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ width: "min(520px, 94vw)", borderRadius: 18, border: "1px solid var(--line-2)", background: "var(--panel)", boxShadow: "var(--shadow)", padding: "22px 24px", color: "var(--fg)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 600, margin: 0 }}>Connect {label}</h2>
          <button type="button" aria-label="Close" onClick={close} style={{ background: "transparent", border: "none", color: "var(--fg-3)", cursor: "pointer", padding: 4 }}>
            <X aria-hidden width={16} height={16} />
          </button>
        </div>
        <BrowserProfileConnectFlow
          provider="facebook"
          providerLabel={label}
          onDone={async ({ accountId, importCatalog }) => {
            if (importCatalog) {
              await desk.runListingsAction({ action: "sync-catalog", accountId });
            } else {
              await desk.refresh();
            }
            close();
          }}
          onCancel={close}
        />
      </div>
    </div>
  );
}
