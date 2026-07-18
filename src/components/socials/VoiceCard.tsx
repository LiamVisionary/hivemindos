"use client";

import { useState } from "react";

import { useSocialsDesk, type SocialsAccountView } from "@/components/socials/socials-context";
import { SocialsSpinner } from "@/components/socials/skeletons";

/**
 * Posting voice: a pointer to a soul stack (vault Skills/<slug> or a saved
 * agent soul). Souls are edited where they live (the shared brain), not here —
 * this card only binds one to the account.
 */
export function VoiceCard({ account }: { account: SocialsAccountView }) {
  const desk = useSocialsDesk();
  const [saving, setSaving] = useState(false);
  const current = account.soulPath ?? "";

  const onPick = async (soulPath: string) => {
    if (soulPath === current) return;
    setSaving(true);
    try {
      await desk.setSoulPath(account.id, soulPath);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="sc-card">
      <div className="sc-card-head">
        <span className="sc-card-title">Posting voice</span>
        <span className="sc-card-hint">The soul file every draft for this account is written with</span>
      </div>
      <div className="sc-row" style={{ alignItems: "center" }}>
        <select
          className="sc-select"
          style={{ flex: 1, minWidth: 220 }}
          value={current}
          disabled={saving}
          onChange={(event) => void onPick(event.target.value)}
        >
          <option value="">No soul bound (drafting falls back to generic voice guides)</option>
          {desk.souls.map((soul) => (
            <option key={soul.path} value={soul.path}>{soul.label}</option>
          ))}
        </select>
        {saving ? <SocialsSpinner /> : null}
      </div>
      {current ? (
        <div className="sc-note" style={{ marginTop: 8 }}>
          Bound to <code>{current}</code>. Edit the soul in the shared brain (SOUL.md / STYLE.md / examples) and every future draft picks it up.
        </div>
      ) : null}
    </section>
  );
}
