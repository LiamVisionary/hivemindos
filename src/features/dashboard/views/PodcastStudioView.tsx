"use client";

import * as React from "react";
import { Loader2, Mic, Pause, Play, Square, Sparkles } from "lucide-react";

type PodcastTurn = { speaker: "A" | "B"; name: string; text: string };
type PodcastScript = { title: string; hostA: string; hostB: string; turns: PodcastTurn[] };

const card: React.CSSProperties = {
  border: "1px solid var(--line, rgba(148,163,184,0.22))",
  borderRadius: 14,
  background: "var(--panel, rgba(255,255,255,0.02))",
  padding: 16,
};
const label: React.CSSProperties = {
  fontFamily: "var(--f-mono, ui-monospace)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "var(--fg-3, #94a3b8)",
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 9,
  border: "1px solid var(--line-2, rgba(148,163,184,0.3))",
  background: "var(--panel-2, rgba(255,255,255,0.03))",
  color: "var(--fg, inherit)",
  fontSize: 13.5,
  outline: "none",
};

function pickVoices(): { a: SpeechSynthesisVoice | null; b: SpeechSynthesisVoice | null } {
  if (typeof window === "undefined" || !window.speechSynthesis) return { a: null, b: null };
  const all = window.speechSynthesis.getVoices();
  const english = all.filter((voice) => /^en(-|_|$)/i.test(voice.lang));
  const pool = english.length ? english : all;
  if (!pool.length) return { a: null, b: null };
  // Prefer two audibly distinct voices when the platform offers named ones.
  const preferredA = pool.find((v) => /samantha|female|zira|jenny|aria|google us/i.test(v.name)) ?? pool[0];
  const preferredB = pool.find((v) => v !== preferredA && /daniel|male|david|guy|google uk/i.test(v.name))
    ?? pool.find((v) => v !== preferredA)
    ?? preferredA;
  return { a: preferredA ?? null, b: preferredB ?? null };
}

export function PodcastStudioView() {
  const [sources, setSources] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [hostA, setHostA] = React.useState("Alex");
  const [hostB, setHostB] = React.useState("Jordan");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [script, setScript] = React.useState<PodcastScript | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [activeTurn, setActiveTurn] = React.useState(-1);

  const voicesRef = React.useRef<{ a: SpeechSynthesisVoice | null; b: SpeechSynthesisVoice | null }>({ a: null, b: null });
  const playTokenRef = React.useRef(0);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return undefined;
    const load = () => { voicesRef.current = pickVoices(); };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, []);

  const stopPlayback = React.useCallback(() => {
    playTokenRef.current += 1;
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    setPlaying(false);
    setActiveTurn(-1);
  }, []);

  const generate = React.useCallback(async () => {
    setError("");
    setBusy(true);
    stopPlayback();
    setScript(null);
    try {
      const response = await fetch("/api/podcast/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources, title, hostA, hostB }),
      });
      const payload = (await response.json()) as
        | { ok: true; title: string; hostA: string; hostB: string; turns: PodcastTurn[] }
        | { ok?: false; error?: string };
      if (!response.ok || !("ok" in payload) || !payload.ok) {
        setError(("error" in payload && payload.error) || `Generation failed (${response.status}).`);
        return;
      }
      setScript({ title: payload.title, hostA: payload.hostA, hostB: payload.hostB, turns: payload.turns });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }, [sources, title, hostA, hostB, stopPlayback]);

  const playFrom = React.useCallback((startIndex: number) => {
    if (!script || typeof window === "undefined" || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    if (!voicesRef.current.a) voicesRef.current = pickVoices();
    const token = ++playTokenRef.current;
    setPlaying(true);
    const speakAt = (index: number) => {
      if (token !== playTokenRef.current) return;
      if (index >= script.turns.length) {
        setPlaying(false);
        setActiveTurn(-1);
        return;
      }
      setActiveTurn(index);
      const turn = script.turns[index];
      const utterance = new SpeechSynthesisUtterance(turn.text);
      const voice = turn.speaker === "A" ? voicesRef.current.a : voicesRef.current.b;
      if (voice) utterance.voice = voice;
      utterance.rate = 1.03;
      utterance.pitch = turn.speaker === "A" ? 1.05 : 0.95;
      utterance.onend = () => speakAt(index + 1);
      utterance.onerror = () => speakAt(index + 1);
      synth.speak(utterance);
    };
    speakAt(startIndex);
  }, [script]);

  const togglePlay = React.useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    if (playing) {
      synth.pause();
      setPlaying(false);
      return;
    }
    if (synth.paused && synth.speaking) {
      synth.resume();
      setPlaying(true);
      return;
    }
    playFrom(activeTurn >= 0 ? activeTurn : 0);
  }, [playing, playFrom, activeTurn]);

  const ttsAvailable = typeof window !== "undefined" && !!window.speechSynthesis;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 860, margin: "0 auto", padding: "8px 4px 40px" }}>
      <header style={{ display: "grid", gap: 4 }}>
        <span style={{ ...label, color: "var(--accent-strong, var(--honey, #f5b301))" }}>Podcast Studio</span>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}>Deep Dive Generator</h1>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--fg-2, #cbd5e1)", lineHeight: 1.5 }}>
          Paste any source material and generate a grounded two-host audio conversation about it, then play it back with distinct voices.
        </p>
      </header>

      <section style={{ ...card, display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={label}>Sources</span>
          <textarea
            value={sources}
            onChange={(event) => setSources(event.target.value)}
            rows={9}
            placeholder="Paste an article, notes, a doc, transcript, or any text you want a podcast about…"
            style={{ ...input, resize: "vertical", lineHeight: 1.55, fontFamily: "inherit" }}
          />
        </label>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={label}>Title (optional)</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Episode title" style={input} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={label}>Host A</span>
            <input value={hostA} onChange={(event) => setHostA(event.target.value)} style={input} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={label}>Host B</span>
            <input value={hostB} onChange={(event) => setHostB(event.target.value)} style={input} />
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={generate}
            disabled={busy || sources.trim().length < 40}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 99,
              border: "1px solid var(--honey, #f5b301)", background: "var(--honey, #f5b301)", color: "#1a1305",
              fontSize: 13.5, fontWeight: 600, cursor: busy || sources.trim().length < 40 ? "default" : "pointer",
              opacity: busy || sources.trim().length < 40 ? 0.5 : 1,
            }}
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
            {busy ? "Generating…" : "Generate podcast"}
          </button>
          {error ? <span style={{ fontSize: 12.5, color: "var(--danger, #ef4444)" }}>{error}</span> : null}
        </div>
      </section>

      {script ? (
        <section style={{ ...card, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 16, fontWeight: 600 }}>
                <Mic size={16} aria-hidden="true" /> {script.title}
              </span>
              <span style={label}>{script.hostA} & {script.hostB} · {script.turns.length} turns</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={togglePlay}
                disabled={!ttsAvailable}
                title={ttsAvailable ? undefined : "Speech synthesis is not available in this browser."}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 99, border: "1px solid var(--honey, #f5b301)", background: playing ? "var(--panel-2, rgba(255,255,255,0.05))" : "var(--honey, #f5b301)", color: playing ? "var(--fg, inherit)" : "#1a1305", fontSize: 13, fontWeight: 600, cursor: ttsAvailable ? "pointer" : "not-allowed", opacity: ttsAvailable ? 1 : 0.5 }}
              >
                {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                {playing ? "Pause" : activeTurn >= 0 ? "Resume" : "Play"}
              </button>
              <button
                type="button"
                onClick={stopPlayback}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 99, border: "1px solid var(--line-2, rgba(148,163,184,0.3))", background: "var(--panel-2, rgba(255,255,255,0.03))", color: "var(--fg-2, #cbd5e1)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
              >
                <Square size={13} aria-hidden="true" /> Stop
              </button>
            </div>
          </div>
          {!ttsAvailable ? (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--fg-3, #94a3b8)" }}>
              Read the transcript below — spoken playback needs a browser with speech synthesis.
            </p>
          ) : null}
          <ol style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
            {script.turns.map((turn, index) => {
              const isA = turn.speaker === "A";
              const active = index === activeTurn;
              return (
                <li
                  key={index}
                  onClick={() => playFrom(index)}
                  style={{
                    display: "grid", gap: 3, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                    border: `1px solid ${active ? "var(--honey-line, rgba(245,179,1,0.5))" : "transparent"}`,
                    background: active ? "var(--honey-soft, rgba(245,179,1,0.1))" : "var(--panel-2, rgba(255,255,255,0.02))",
                    borderLeft: `3px solid ${isA ? "var(--honey, #f5b301)" : "var(--live, #34d399)"}`,
                  }}
                >
                  <span style={{ ...label, color: isA ? "var(--honey, #f5b301)" : "var(--live, #34d399)" }}>{turn.name}</span>
                  <span style={{ fontSize: 14, lineHeight: 1.55, color: "var(--fg, inherit)" }}>{turn.text}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

export default PodcastStudioView;
