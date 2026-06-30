"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

import { saveDashboardStateValue } from "@/lib/services/dashboard-state-client";
import styles from "./ClawBankOnboardingModal.module.css";

/**
 * Optional post-setup step that offers to enable ClawBank for the user's agents.
 *
 * Self-contained like ProgressRewardPopup: on mount it checks one-time "shown"
 * state + live ClawBank readiness, and only surfaces when ClawBank is not yet
 * configured and the user hasn't dismissed it. The whole flow (request code ->
 * verify code -> mint + persist the API key) runs against /api/clawbank/auth;
 * the long-lived key is minted and saved to the shared hive env server-side and
 * never returns to the browser.
 */

const CLAWBANK_SETUP_STATE_KEY = "hivemindos.clawbankSetup.shown.v1";
// ClawBank is BUTTON-ONLY: it never auto-pops (it used to surface mid-setup).
// Open it on demand by dispatching this window event from a button, e.g.
//   window.dispatchEvent(new Event(CLAWBANK_OPEN_EVENT))
export const CLAWBANK_OPEN_EVENT = "hivemindos.clawbank.open";
const CLAWBANK_LOGO_PATH = "/icons/runtimes/clawbank.svg";

type Step = "intro" | "email" | "code" | "verified" | "initializing" | "success";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Progress-rail position for each step, and the per-dot "on" thresholds
// (intro · email · code · verified · success — initializing folds into the
// verified→success span and lights the last dot's live state).
const STEP_INDEX: Record<Step, number> = { intro: 0, email: 1, code: 2, verified: 3, initializing: 4, success: 5 };
const RAIL_THRESHOLDS = [0, 1, 2, 3, 5];

// The biggest things ClawBank gives an agent — shown on the intro and (present
// tense) on the success screen.
const CAPABILITIES: Array<{ icon: ReactNode; title: string; blurb: string }> = [
  { icon: <BankIcon />, title: "A real US bank account", blurb: "USD balance, deposits, and ACH — KYC banking rails." },
  { icon: <WalletIcon />, title: "A self-custody crypto wallet", blurb: "Base + XRPL, with gas-sponsored USDC sends." },
  { icon: <ChartIcon />, title: "Autonomous trading", blurb: "One-off spot swaps and long-running strategies." },
  { icon: <BuildingIcon />, title: "Their own US company", blurb: "Form a real LLC on demand, paid on-chain." },
  { icon: <CashOutIcon />, title: "Cash out to USD", blurb: "Off-ramp on-chain funds to a linked bank." },
];

type ClawBankOnboardingModalProps = {
  enabled?: boolean;
};

export function ClawBankOnboardingModal({ enabled = true }: ClawBankOnboardingModalProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("intro");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bootstrapTokenRef = useRef<string>("");
  const codeInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  // Button-only: open ONLY when a button dispatches CLAWBANK_OPEN_EVENT — never
  // automatically. (It used to auto-pop on dashboard hydration, which surfaced it
  // before/during the machine-setup wizard.)
  useEffect(() => {
    if (!enabled) return;
    const onOpen = () => setOpen(true);
    window.addEventListener(CLAWBANK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CLAWBANK_OPEN_EVENT, onOpen);
  }, [enabled]);

  const dismiss = useCallback((reason: "skipped" | "enabled") => {
    void saveDashboardStateValue(CLAWBANK_SETUP_STATE_KEY, reason);
    setOpen(false);
  }, []);

  // Lock background scroll + Escape-to-skip (but never interrupt the mint).
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && step !== "initializing") dismiss("skipped");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, step, dismiss]);

  // Autofocus the right field as steps change.
  useEffect(() => {
    if (step === "email") emailInputRef.current?.focus();
    if (step === "code") codeInputRef.current?.focus();
  }, [step]);

  const sendCode = useCallback(async () => {
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/clawbank/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request_code", email: value }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not send a login code. Check the email and try again.");
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a login code.");
    } finally {
      setBusy(false);
    }
  }, [email]);

  const verifyCode = useCallback(async () => {
    const value = code.trim();
    if (value.length < 4) {
      setError("Enter the code from your email.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/clawbank/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify_code", email: email.trim(), code: value }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "That code didn't work. Request a new one and try again.");
      const bootstrap = String(data?.data?.bootstrap_token ?? data?.data?.bootstrapToken ?? "").trim();
      if (!bootstrap) throw new Error("ClawBank verified the code but returned no session. Try again.");
      bootstrapTokenRef.current = bootstrap;
      setStep("verified");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work.");
    } finally {
      setBusy(false);
    }
  }, [code, email]);

  const initialize = useCallback(async () => {
    if (!bootstrapTokenRef.current) {
      setError("Your verification expired. Start again.");
      setStep("email");
      return;
    }
    setStep("initializing");
    setError("");
    try {
      const res = await fetch("/api/clawbank/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mint_and_store", bootstrapToken: bootstrapTokenRef.current }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not finish enabling ClawBank.");
      bootstrapTokenRef.current = "";
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish enabling ClawBank.");
      setStep("verified");
    }
  }, []);

  if (!open || typeof document === "undefined") return null;

  const lockBackdrop = step === "initializing";
  const stepIndex = STEP_INDEX[step];
  const tone = step === "verified" || step === "initializing" || step === "success" ? "live" : undefined;

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      data-step={step}
      onMouseDown={(event) => {
        if (!lockBackdrop && event.target === event.currentTarget) dismiss("skipped");
      }}
    >
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clawbank-onboarding-title"
      >
        {step !== "initializing" && step !== "success" ? (
          <button className={styles.close} type="button" aria-label="Skip ClawBank setup" onClick={() => dismiss("skipped")}>
            <CloseIcon />
          </button>
        ) : null}

        <header className={styles.hero} data-tone={tone}>
          <span className={styles.mark} aria-hidden="true">
            <Image src={CLAWBANK_LOGO_PATH} alt="" aria-hidden="true" width={30} height={30} unoptimized />
          </span>
          <span className={styles.heroText}>
            <span className={styles.heroEyebrow}>ClawBank</span>
            <span className={styles.heroTitle}>Banking for your agents</span>
          </span>
          <span className={styles.rail} aria-hidden="true">
            {RAIL_THRESHOLDS.map((threshold, index) => (
              <i key={index} data-on={stepIndex >= threshold ? "true" : undefined} data-live={step === "initializing" && index === 4 ? "true" : undefined} />
            ))}
          </span>
        </header>

        <div className={styles.body}>
          {step === "intro" ? (
            <IntroStep />
          ) : step === "email" ? (
            <EmailStep email={email} setEmail={setEmail} inputRef={emailInputRef} busy={busy} onSend={sendCode} />
          ) : step === "code" ? (
            <CodeStep email={email} code={code} setCode={setCode} inputRef={codeInputRef} busy={busy} onVerify={verifyCode} />
          ) : step === "verified" ? (
            <VerifiedStep />
          ) : step === "initializing" ? (
            <InitializingStep />
          ) : (
            <SuccessStep />
          )}

          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>

        <footer className={styles.foot}>
          {step === "intro" ? (
            <p className={styles.disclaimer}>ClawBank capabilities require email registration.</p>
          ) : null}
          <div className={styles.footActions}>
            {step === "intro" ? (
              <>
                <button className={styles.ghost} type="button" onClick={() => dismiss("skipped")}>
                  Skip for now
                </button>
                <button className={styles.primary} type="button" onClick={() => setStep("email")}>
                  Of course
                </button>
              </>
            ) : step === "email" ? (
              <>
                <button className={`${styles.text} ${styles.grow}`} type="button" onClick={() => setStep("intro")} disabled={busy}><ChevLeftIcon /> Back</button>
                <button className={styles.primary} type="button" onClick={sendCode} disabled={busy || !EMAIL_RE.test(email.trim())}>
                  {busy ? <><Spinner /> Sending…</> : "Send code"}
                </button>
              </>
            ) : step === "code" ? (
              <>
                <button className={`${styles.text} ${styles.grow}`} type="button" onClick={() => setStep("email")} disabled={busy}><ChevLeftIcon /> Back</button>
                <button className={styles.primary} type="button" onClick={verifyCode} disabled={busy || code.trim().length < 4}>
                  {busy ? <><Spinner /> Verifying…</> : "Verify"}
                </button>
              </>
            ) : step === "verified" ? (
              <button className={styles.primary} type="button" data-tone="live" onClick={initialize}>
                Initialize ClawBank
              </button>
            ) : (
              <button className={styles.primary} type="button" data-tone="live" data-ready={step === "success" ? "true" : undefined} disabled={step !== "success"} onClick={() => dismiss("enabled")}>
                {step === "success" ? <><BeeIcon /> Buzz on</> : <><Spinner /> Initializing…</>}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Step views
// ---------------------------------------------------------------------------

function IntroStep() {
  return (
    <div className={styles.step}>
      <h2 id="clawbank-onboarding-title" className={styles.title}>Give your agents a bank.</h2>
      <p className={styles.lede}>Turn on ClawBank and every agent in your hive gets:</p>
      <ul className={styles.capList}>
        {CAPABILITIES.map((cap) => (
          <li key={cap.title} className={styles.capItem}>
            <span className={styles.capIcon} aria-hidden="true">{cap.icon}</span>
            <span className={styles.capText}>
              <strong>{cap.title}</strong>
              <small>{cap.blurb}</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmailStep({ email, setEmail, inputRef, busy, onSend }: {
  email: string;
  setEmail: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  onSend: () => void;
}) {
  return (
    <div className={styles.step}>
      <h2 id="clawbank-onboarding-title" className={styles.title}>Where should we send your code?</h2>
      <p className={styles.lede}>ClawBank emails a one-time login code to register your account.</p>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Email</span>
        <input
          ref={inputRef}
          className={styles.input}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSend();
            }
          }}
        />
      </label>
    </div>
  );
}

function CodeStep({ email, code, setCode, inputRef, busy, onVerify }: {
  email: string;
  code: string;
  setCode: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  onVerify: () => void;
}) {
  return (
    <div className={styles.step}>
      <h2 id="clawbank-onboarding-title" className={styles.title}>Enter your code.</h2>
      <p className={styles.lede}>We sent a login code to <strong>{email}</strong>. Codes expire quickly.</p>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Login code</span>
        <input
          ref={inputRef}
          className={`${styles.input} ${styles.codeInput}`}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          value={code}
          disabled={busy}
          onChange={(event) => setCode(event.target.value.replace(/[^0-9a-zA-Z]/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onVerify();
            }
          }}
        />
      </label>
    </div>
  );
}

function VerifiedStep() {
  return (
    <div className={`${styles.step} ${styles.centerStep}`}>
      <div className={styles.verifiedMark} aria-hidden="true">
        <span className={styles.verifiedRing} />
        <span className={styles.verifiedRing} data-delay="true" />
        <svg className={styles.verifiedCheck} viewBox="0 0 52 52" width="60" height="60">
          <circle className={styles.verifiedCircle} cx="26" cy="26" r="23" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <path className={styles.verifiedTick} d="M15 27 L23 34.5 L38 18" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 id="clawbank-onboarding-title" className={styles.title}>Verified.</h2>
      <p className={styles.lede}>Your agents are about to get a powerup. Ready to wire it up?</p>
    </div>
  );
}

function InitializingStep() {
  return (
    <div className={`${styles.step} ${styles.centerStep}`}>
      <div className={styles.initOrbit} aria-hidden="true">
        <span className={styles.orbitRing} />
        <span className={styles.orbitRing} data-reverse="true" />
        <span className={styles.orbitCore}>
          <Image src={CLAWBANK_LOGO_PATH} alt="" aria-hidden="true" width={30} height={30} unoptimized />
        </span>
        <span className={styles.spark} style={{ "--i": 0 } as React.CSSProperties} />
        <span className={styles.spark} style={{ "--i": 1 } as React.CSSProperties} />
        <span className={styles.spark} style={{ "--i": 2 } as React.CSSProperties} />
      </div>
      <h2 id="clawbank-onboarding-title" className={styles.title}>Initializing ClawBank…</h2>
      <p className={styles.lede}>Minting your account key and wiring it into the hive. One moment.</p>
    </div>
  );
}

function SuccessStep() {
  return (
    <div className={`${styles.step} ${styles.centerStep}`}>
      <div className={styles.successMark} aria-hidden="true">
        <span className={styles.successRing} />
        <svg className={styles.successCheck} viewBox="0 0 52 52" width="56" height="56">
          <path d="M14 27 L23 36 L39 18" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 id="clawbank-onboarding-title" className={styles.title}>Your agents got a powerup!</h2>
      <p className={styles.lede}>They can now:</p>
      <ul className={styles.successList}>
        <li><BankIcon /> Open a real bank account &amp; move USD</li>
        <li><WalletIcon /> Hold crypto &amp; send gas-free USDC</li>
        <li><ChartIcon /> Trade tokens autonomously</li>
        <li><BuildingIcon /> Form their own US company</li>
        <li><CashOutIcon /> Cash out on-chain funds to USD</li>
      </ul>
      <p className={styles.swarmLine}>Time to get swarming.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline icons (stroke-based, inherit currentColor)
// ---------------------------------------------------------------------------

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function BankIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" {...stroke}>
      <path d="M3 9.5 12 4l9 5.5M5 10v8M9 10v8M15 10v8M19 10v8M3.5 21h17" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="6" width="18" height="13" rx="2.4" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" {...stroke}>
      <path d="M4 19V5M4 19h16M8 16l3.5-4 3 2.5L20 8" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" {...stroke}>
      <path d="M5 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16M14 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3M3.5 21h17" />
    </svg>
  );
}

function CashOutIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" {...stroke}>
      <path d="M12 3v10m0 0 3.5-3.5M12 13 8.5 9.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function BeeIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" {...stroke}>
      <ellipse cx="12" cy="14" rx="4" ry="5.5" />
      <path d="M8.4 11h7.2M8.2 14h7.6M9 17h6M12 8.5V6M10 6 8.4 4.4M14 6l1.6-1.6" />
      <path d="M8 9.5C5.5 8 4 9 4 10.5S6 13 8 12M16 9.5c2.5-1.5 4-.5 4 1s-2 2.5-4 1.5" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className={styles.spin} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" {...stroke} strokeWidth={1.9}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ChevLeftIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" {...stroke}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
