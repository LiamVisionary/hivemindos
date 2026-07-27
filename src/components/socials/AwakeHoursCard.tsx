"use client";

import { useState } from "react";

import { useSocialsDesk, type SocialsAccountView } from "@/components/socials/socials-context";
import { SocialsSpinner } from "@/components/socials/skeletons";

/** Monday-first render order, JS day numbers (AgentCallPreferences convention). */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_LABELS: Record<number, string> = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Asia/Makassar",
];

export function AwakeHoursCard({ account }: { account: SocialsAccountView }) {
  const desk = useSocialsDesk();
  const [draft, setDraft] = useState(account.awakeHours);
  const [saving, setSaving] = useState(false);
  // Reset the draft when the server truth changes (account switch or a saved
  // update landing) — adjust-during-render, not an effect (set-state-in-effect rule).
  const serverSignature = `${account.id}:${JSON.stringify(account.awakeHours)}`;
  const [seenSignature, setSeenSignature] = useState(serverSignature);
  if (seenSignature !== serverSignature) {
    setSeenSignature(serverSignature);
    setDraft(account.awakeHours);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(account.awakeHours);
  const windowValid = Boolean(draft.start && draft.end && draft.timezone && draft.days.length);
  const timezones = COMMON_TIMEZONES.includes(draft.timezone) ? COMMON_TIMEZONES : [draft.timezone, ...COMMON_TIMEZONES];

  const save = async () => {
    setSaving(true);
    try {
      await desk.setAwakeHours(account.id, draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="sc-card">
      <div className="sc-card-head">
        <span className="sc-card-title">Awake hours</span>
        <span className="sc-card-hint">Posts only go out inside this window; queued items wait for it to open</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--fg-2)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          Restrict posting to a window
        </label>
        {draft.enabled ? (
          <>
            <div className="sc-row">
              <div className="sc-field">
                <span className="sc-label">From</span>
                <input className="sc-input" type="time" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
              </div>
              <div className="sc-field">
                <span className="sc-label">Until</span>
                <input className="sc-input" type="time" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
              </div>
              <div className="sc-field" style={{ flex: 1 }}>
                <span className="sc-label">Timezone</span>
                <select className="sc-select" value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}>
                  {timezones.map((zone) => (
                    <option key={zone} value={zone}>{zone}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="sc-field">
              <span className="sc-label">Days</span>
              <div className="sc-daychips">
                {DAY_ORDER.map((day) => {
                  const on = draft.days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      className="sc-daychip"
                      data-on={on}
                      onClick={() =>
                        setDraft({ ...draft, days: on ? draft.days.filter((d) => d !== day) : [...draft.days, day] })
                      }
                    >
                      {DAY_LABELS[day]}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
        {dirty ? (
          <div>
            {!windowValid ? <div className="sc-error" style={{ marginBottom: 8 }}>Select at least one posting day.</div> : null}
            <button type="button" className="sc-btn" data-tone="primary" disabled={saving || !windowValid} onClick={() => void save()}>
              {saving ? <SocialsSpinner /> : null} Save window
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
