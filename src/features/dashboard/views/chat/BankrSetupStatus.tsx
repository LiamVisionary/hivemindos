"use client";

import { LoaderCircle, Repeat2, ShieldCheck } from "lucide-react";
import { Btn } from "@/components/aeon/parts";

type BankrSetupStatusProps = {
  detail?: string;
  busy?: boolean;
  onRefresh: () => void | Promise<void>;
};

export function BankrSetupStatus({ detail = "", busy = false, onRefresh }: BankrSetupStatusProps) {
  const checking = busy || !detail.trim();
  return (
    <section style={{ display: "grid", gap: 10, border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-bg-soft)", padding: 13 }}>
      <p className="eyebrow">Bankr setup</p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.45 }}>
        {checking ? <LoaderCircle className="animate-spin" size={18} color="var(--cyan-3)" aria-hidden="true" /> : <ShieldCheck size={18} color="var(--cyan-3)" aria-hidden="true" />}
        <div>
          <strong style={{ display: "block", color: "var(--fg)", fontSize: 13 }}>
            {checking ? "Checking Bankr setup" : "Bankr setup needs attention"}
          </strong>
          <span>
            {checking
              ? "Loading Bankr provider diagnostics before showing the next setup step."
              : "Reload providers after updating credentials or credits."}
          </span>
          {detail ? <span style={{ display: "block", marginTop: 5 }}>{detail}</span> : null}
        </div>
      </div>
      <Btn variant="ghost" disabled={busy} onClick={() => void onRefresh()}>
        <Repeat2 size={14} aria-hidden="true" /> Reload providers
      </Btn>
    </section>
  );
}
