"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Bot, CheckCircle2, ShieldCheck } from "lucide-react";

import { TermsDocument } from "@/features/legal/TermsDocument";
import {
  HIVEMINDOS_TERMS_ACCEPTANCE_KEY,
  HIVEMINDOS_TERMS_EFFECTIVE_DATE,
  HIVEMINDOS_TERMS_VERSION,
  currentTermsAcceptance,
  serializeTermsAcceptance,
} from "@/features/legal/terms-contract";
import {
  loadDashboardStateSnapshot,
  saveDashboardStateValue,
} from "@/lib/services/dashboard-state-client";
import styles from "./TermsAcceptanceGate.module.css";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

type GateState = "checking" | "required" | "accepted";

export function TermsAcceptanceGate({ children }: { children: ReactNode }) {
  const [gateState, setGateState] = useState<GateState>("checking");
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [connectionDetail, setConnectionDetail] = useState("Checking this device for an existing acceptance…");
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDashboardStateSnapshot((retry) => {
      if (cancelled || retry.attempt < 3) return;
      setConnectionDetail("Still connecting to this device’s protected state. Acceptance cannot be skipped while it reconnects.");
    }).then((snapshot) => {
      if (cancelled) return;
      setGateState(currentTermsAcceptance(snapshot[HIVEMINDOS_TERMS_ACCEPTANCE_KEY]) ? "accepted" : "required");
    }).catch((loadError) => {
      if (cancelled) return;
      setConnectionDetail(loadError instanceof Error ? loadError.message : "Could not verify terms acceptance on this device.");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (gateState === "required") titleRef.current?.focus();
  }, [gateState]);

  async function acceptTerms() {
    if (!agreed || saving) return;
    setSaving(true);
    setError("");
    const saved = await saveDashboardStateValue(
      HIVEMINDOS_TERMS_ACCEPTANCE_KEY,
      serializeTermsAcceptance(),
    );
    if (!saved) {
      setError("Acceptance could not be saved to this device. Check the dashboard connection and try again.");
      setSaving(false);
      return;
    }
    setGateState("accepted");
  }

  async function quitWithoutAccepting() {
    if (isTauriDesktopRuntime()) {
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
      return;
    }
    window.close();
  }

  if (gateState === "accepted") return children;

  if (gateState === "checking") {
    return (
      <main className={styles.loadingShell} aria-busy="true" aria-live="polite">
        <section className={styles.loadingCard} role="status" aria-label="Checking terms acceptance">
          <div className={styles.loadingEmblem} aria-hidden="true">
            <div className={styles.brandMark}><ShieldCheck /></div>
          </div>
          <p className={styles.loadingEyebrow}><span aria-hidden="true" /> HivemindOS secure startup</p>
          <h1>Opening your control room</h1>
          <p className={styles.loadingDetail}>{connectionDetail}</p>
          <div className={styles.loadingBar} aria-hidden="true"><span /></div>
          <p className={styles.loadingFootnote}>Protected device state</p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.gateShell}>
      <div className={styles.ambient} aria-hidden="true" />
      <section className={styles.gateCard} role="dialog" aria-modal="true" aria-labelledby="terms-gate-title">
        <header className={styles.hero}>
          <div className={styles.brandLine}>
            <div className={styles.brandMark}><ShieldCheck aria-hidden="true" /></div>
            <div>
              <p className={styles.eyebrow}>Before you enter HivemindOS</p>
              <p className={styles.version}>Effective {HIVEMINDOS_TERMS_EFFECTIVE_DATE} · Version {HIVEMINDOS_TERMS_VERSION}</p>
            </div>
          </div>
          <h1 id="terms-gate-title" ref={titleRef} tabIndex={-1}>Powerful tools. Your judgment.</h1>
          <p className={styles.intro}>
            HivemindOS has a private, local-first core and can coordinate AI across your files, accounts, machines,
            automations, and financial tools. Review the privacy boundaries and risks before any dashboard operation starts.
          </p>
        </header>

        <div className={styles.riskGrid}>
          <article>
            <ShieldCheck aria-hidden="true" />
            <div><strong>Private local core</strong><span>Local workflows can stay on machines you control. Connected services are your choice.</span></div>
          </article>
          <article>
            <Bot aria-hidden="true" />
            <div><strong>Imperfect intelligence</strong><span>AI can sound confident while making mistakes, inventing facts, or misunderstanding you.</span></div>
          </article>
          <article>
            <AlertTriangle aria-hidden="true" />
            <div><strong>Your responsibility</strong><span>You choose what to connect and authorize. Review consequential work and assume the risks.</span></div>
          </article>
        </div>

        <div className={styles.termsToolbar}>
          <div>
            <h2>Terms &amp; Conditions and Privacy Policy</h2>
            <p>
              Read the agreement below, <Link href="/terms" target="_blank" rel="noreferrer">open the Terms</Link>, or review the
              {" "}<Link href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</Link>.
            </p>
          </div>
          <span><CheckCircle2 aria-hidden="true" /> Acceptance is saved on this device</span>
        </div>

        <div className={styles.termsScroll} tabIndex={0} aria-label="HivemindOS Terms and Conditions">
          <TermsDocument compact showTitle={false} />
        </div>

        <footer className={styles.acceptanceFooter}>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            <span>
              I have read and agree to the HivemindOS Terms &amp; Conditions and acknowledge the Privacy Policy.
              I understand that the core is local-first, connected features may send data to selected providers,
              AI can make mistakes, results and earnings are not guaranteed, and I use HivemindOS-powered operations
              at my discretion and risk.
            </span>
          </label>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <div className={styles.actions}>
            <p>If you do not agree, close HivemindOS and do not use the Services.</p>
            <div className={styles.actionButtons}>
              <button className={styles.secondaryAction} type="button" onClick={() => void quitWithoutAccepting()}>Quit without accepting</button>
              <button type="button" disabled={!agreed || saving} onClick={() => void acceptTerms()}>
                {saving ? <span className={styles.spinner} aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
                {saving ? "Saving acceptance" : "Accept and continue"}
              </button>
            </div>
          </div>
        </footer>
      </section>
    </main>
  );
}
