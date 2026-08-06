"use client";

import { CheckCircle2, KeyRound, Laptop, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { useSocialsDesk, type SocialsAccountView } from "@/components/socials/socials-context";
import { SharedHiveEnvCredentialInput, type SharedHiveEnvCredential } from "@/features/env/SharedHiveEnvCredentialInput";
import {
  socialXSessionBinding,
  suggestedSocialXSessionEnvKeys,
  type SocialXSessionBinding,
} from "@/lib/services/socials/social-x-session-binding";

type SessionMode = SocialXSessionBinding["mode"];

export function XSessionCard({ account }: { account: SocialsAccountView }) {
  const desk = useSocialsDesk();
  const existing = socialXSessionBinding(account);
  const suggested = useMemo(() => suggestedSocialXSessionEnvKeys(account.handle), [account.handle]);
  const [mode, setMode] = useState<SessionMode>(existing.mode);
  const [authTokenEnvKey, setAuthTokenEnvKey] = useState(
    existing.mode === "account-env" ? existing.authTokenEnvKey : suggested.authTokenEnvKey,
  );
  const [ct0EnvKey, setCt0EnvKey] = useState(
    existing.mode === "account-env" ? existing.ct0EnvKey : suggested.ct0EnvKey,
  );
  const [authReady, setAuthReady] = useState(existing.mode === "account-env");
  const [ct0Ready, setCt0Ready] = useState(existing.mode === "account-env");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  if (account.platform !== "x") return null;

  const bindCredential = (
    credential: SharedHiveEnvCredential,
    setter: (value: string) => void,
    readySetter: (value: boolean) => void,
  ) => {
    setter(credential.envKey);
    readySetter(true);
    setStatus("");
  };

  const save = async () => {
    const session: SocialXSessionBinding = mode === "machine-default"
      ? { mode }
      : { mode, authTokenEnvKey, ct0EnvKey };
    setSaving(true);
    setStatus("");
    try {
      const result = await desk.setXSessionBinding(account.id, session);
      setStatus(result.ok
        ? mode === "account-env"
          ? `Bound Comment finder to @${account.handle}'s saved X session.`
          : "Using the machine-default Agent Reach X session."
        : result.error ?? "Could not save the Agent Reach X session.");
    } finally {
      setSaving(false);
    }
  };

  const accountCredentialsReady = authReady && ct0Ready
    && Boolean(authTokenEnvKey)
    && Boolean(ct0EnvKey)
    && authTokenEnvKey !== ct0EnvKey;

  return (
    <section className="sc-card" data-testid="social-x-session">
      <div className="sc-card-head">
        <div>
          <span className="sc-card-title">Agent Reach X session</span>
          <div className="sc-card-hint" style={{ marginTop: 3 }}>
            Choose which signed-in X session Comment finder and reviewed replies use for @{account.handle}.
          </div>
        </div>
        <span className="sc-mode-badge">
          {existing.mode === "account-env" ? "account isolated" : "machine default"}
        </span>
      </div>

      <label className="sc-field">
        <span className="sc-label"><KeyRound aria-hidden="true" width={13} /> Session source</span>
        <select
          className="sc-select"
          value={mode}
          disabled={saving}
          onChange={(event) => {
            const nextMode = event.target.value as SessionMode;
            setMode(nextMode);
            setStatus("");
            if (nextMode === "account-env" && existing.mode !== "account-env") {
              setAuthReady(false);
              setCt0Ready(false);
            }
          }}
        >
          <option value="account-env">Per-account credentials</option>
          <option value="machine-default">Machine default</option>
        </select>
      </label>

      {mode === "account-env" ? (
        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          <div className="sc-note">
            Save this account&apos;s <code>auth_token</code> and <code>ct0</code> cookie values under unique Shared Hive Env names.
            Socials stores only those names and maps the selected pair into an isolated Agent Reach process.
          </div>
          <label className="sc-field">
            <span className="sc-label">auth_token cookie</span>
            <SharedHiveEnvCredentialInput
              preferredEnvKeys={[authTokenEnvKey, suggested.authTokenEnvKey]}
              defaultEnvKey={authTokenEnvKey || suggested.authTokenEnvKey}
              valuePlaceholder="Paste auth_token cookie"
              continueLabel="Use auth token"
              saveLabel="Save auth token"
              disabled={saving}
              onSaved={(credential) => bindCredential(credential, setAuthTokenEnvKey, setAuthReady)}
            />
          </label>
          <label className="sc-field">
            <span className="sc-label">ct0 cookie</span>
            <SharedHiveEnvCredentialInput
              preferredEnvKeys={[ct0EnvKey, suggested.ct0EnvKey]}
              defaultEnvKey={ct0EnvKey || suggested.ct0EnvKey}
              valuePlaceholder="Paste ct0 cookie"
              continueLabel="Use ct0"
              saveLabel="Save ct0"
              disabled={saving}
              onSaved={(credential) => bindCredential(credential, setCt0EnvKey, setCt0Ready)}
            />
          </label>
          <div className="sc-note">
            Recommended names: <code>{suggested.authTokenEnvKey}</code> and <code>{suggested.ct0EnvKey}</code>.
            Existing Shared Hive Env variables can be selected without re-entering their values.
          </div>
        </div>
      ) : (
        <div className="sc-discovery-status" style={{ marginTop: 14 }}>
          <Laptop aria-hidden="true" width={14} />
          <span>
            Use the one Agent Reach X login configured for this machine. This legacy mode is convenient for one X account,
            but it cannot isolate multiple accounts.
          </span>
        </div>
      )}

      <div className="sc-drafting-footer" style={{ marginTop: 14 }}>
        <div className="sc-note">
          <ShieldCheck aria-hidden="true" width={13} style={{ verticalAlign: -2, marginRight: 5 }} />
          Cookie values remain in Shared Hive Env and are never written into the Socials account record or returned by this page.
        </div>
        <button
          type="button"
          className="sc-btn"
          data-tone="primary"
          disabled={saving || (mode === "account-env" && !accountCredentialsReady)}
          onClick={() => void save()}
        >
          {existing.mode === mode && !status ? <CheckCircle2 aria-hidden="true" width={13} /> : null}
          {saving ? "Saving session" : mode === "account-env" ? "Bind account session" : "Use machine default"}
        </button>
      </div>

      {status ? <div className={status.startsWith("Could not") ? "sc-error" : "sc-note"} style={{ marginTop: 10 }}>{status}</div> : null}
    </section>
  );
}
