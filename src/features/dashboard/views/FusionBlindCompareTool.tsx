"use client";

import { useMemo, useState } from "react";

type BlindSlot = { slotId: string; answer: string; latencyMs?: number };
type BlindReveal = { slotId: string; candidateId: string; modelLabel: string };
type BlindSession = { id: string; createdAt: string; slots: BlindSlot[]; reveal: BlindReveal[] };

const defaultRows = [
  { id: "candidate-a", modelLabel: "", answer: "" },
  { id: "candidate-b", modelLabel: "", answer: "" },
  { id: "candidate-c", modelLabel: "", answer: "" },
];

export function FusionBlindCompareTool() {
  const [rows, setRows] = useState(defaultRows);
  const [session, setSession] = useState<BlindSession | null>(null);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [revealed, setRevealed] = useState<BlindReveal[] | null>(null);
  const [status, setStatus] = useState("");
  const readyCount = useMemo(() => rows.filter((row) => row.answer.trim()).length, [rows]);

  const updateRow = (index: number, patch: Partial<(typeof defaultRows)[number]>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const prepare = async () => {
    setStatus("Preparing...");
    setRevealed(null);
    setSelectedSlot("");
    const candidates = rows
      .filter((row) => row.answer.trim())
      .map((row, index) => ({
        id: row.id,
        modelLabel: row.modelLabel.trim() || `Candidate ${index + 1}`,
        answer: row.answer,
      }));
    const response = await fetch("/api/fusion/blind-compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates }),
    });
    const data = await response.json();
    if (!response.ok || !data?.session) {
      setStatus(data?.error ?? "Blind compare failed.");
      return;
    }
    setSession(data.session);
    setStatus("");
  };

  const reveal = async (slotId: string) => {
    if (!session) return;
    setSelectedSlot(slotId);
    const response = await fetch("/api/fusion/blind-compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reveal", session, slotId }),
    });
    const data = await response.json();
    if (!response.ok || !data?.result?.reveal) {
      setStatus(data?.error ?? "Reveal failed.");
      return;
    }
    setRevealed(data.result.reveal);
    setStatus("");
  };

  return (
    <section className="mb-5 grid gap-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Hive Fusion</p>
          <h2 className="m-0 text-lg font-bold">Blind compare</h2>
        </div>
        <button
          type="button"
          className="rounded-md border border-[rgba(94,234,212,0.28)] px-3 py-2 text-sm font-bold text-[var(--accent-strong)] disabled:opacity-50"
          disabled={readyCount < 2}
          onClick={() => void prepare()}
        >
          Prepare
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {rows.map((row, index) => (
          <label key={row.id} className="grid gap-2">
            <input
              value={row.modelLabel}
              onChange={(event) => updateRow(index, { modelLabel: event.target.value })}
              placeholder={`Model ${index + 1}`}
              className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.52)] px-3 py-2 text-sm text-[var(--foreground)] outline-none"
            />
            <textarea
              value={row.answer}
              onChange={(event) => updateRow(index, { answer: event.target.value })}
              placeholder={`Answer ${index + 1}`}
              className="min-h-32 rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.52)] px-3 py-2 text-sm text-[var(--foreground)] outline-none"
            />
          </label>
        ))}
      </div>
      {status ? <p className="m-0 text-xs text-[var(--muted)]">{status}</p> : null}
      {session ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {session.slots.map((slot) => {
            const revealEntry = revealed?.find((entry) => entry.slotId === slot.slotId);
            return (
              <article key={slot.slotId} className={`rounded-md border p-3 ${selectedSlot === slot.slotId ? "border-[rgba(94,234,212,0.42)] bg-[rgba(20,184,166,0.10)]" : "border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.48)]"}`}>
                <div className="flex items-center justify-between gap-2">
                  <strong>{slot.slotId.replace("slot-", "Slot ")}</strong>
                  <button type="button" className="rounded-md px-2 py-1 text-xs font-bold text-[var(--accent-strong)] hover:bg-[rgba(94,234,212,0.10)]" onClick={() => void reveal(slot.slotId)}>
                    Choose
                  </button>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground)]">{slot.answer}</p>
                {revealEntry ? <p className="m-0 mt-2 text-xs text-[var(--accent-strong)]">{revealEntry.modelLabel}</p> : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
