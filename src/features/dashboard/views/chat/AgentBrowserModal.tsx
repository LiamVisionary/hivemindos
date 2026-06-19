"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export interface BrowsableAgent {
  slug: string;
  label: string;
  summary: string;
  domain?: string;
  source: string;
  license?: string;
  sourceUrl?: string;
  soulPrompt?: string;
}

interface AgentBrowserModalProps {
  open: boolean;
  onClose: () => void;
  onInstall: (agent: { slug: string; label: string; summary: string; soulPrompt?: string }) => void;
  installedIds?: string[];
}

// Browse and install optional packaged agents (packaged-agents/optional). Installing one adds it
// as a selectable custom worker class on the current agent. Self-contained: fetches its own data.
export function AgentBrowserModal({ open, onClose, onInstall, installedIds = [] }: AgentBrowserModalProps) {
  const [agents, setAgents] = useState<BrowsableAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [justInstalled, setJustInstalled] = useState<Set<string>>(new Set());
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    fetch("/api/agents/catalog")
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) setAgents(data.agents as BrowsableAgent[]);
        else setError(data?.error || "Failed to load agent catalog.");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load agent catalog."))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const installedSet = useMemo(() => new Set([...installedIds, ...justInstalled]), [installedIds, justInstalled]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? agents.filter((a) => [a.label, a.slug, a.summary, a.domain, a.source].join(" ").toLowerCase().includes(q))
      : agents;
    const byDomain = new Map<string, BrowsableAgent[]>();
    for (const a of filtered) {
      const key = a.domain || "other";
      if (!byDomain.has(key)) byDomain.set(key, []);
      byDomain.get(key)!.push(a);
    }
    return [...byDomain.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [agents, query]);

  if (!open) return null;

  const titleCase = (v: string) => v.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const handleInstall = async (agent: BrowsableAgent) => {
    if (installedSet.has(agent.slug) || installing) return;
    setInstalling(agent.slug);
    try {
      let soulPrompt = agent.soulPrompt;
      if (!soulPrompt) {
        const detail = await fetch(`/api/agents/catalog?slug=${encodeURIComponent(agent.slug)}`).then((r) => r.json());
        soulPrompt = detail?.ok ? (detail.agent.soulPrompt as string) : undefined;
      }
      onInstall({ slug: agent.slug, label: agent.label, summary: agent.summary, soulPrompt });
      setJustInstalled((prev) => new Set(prev).add(agent.slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Install failed.");
    } finally {
      setInstalling(null);
    }
  };

  const total = agents.length;
  const shown = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Browse agents"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(880px, 96vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", borderRadius: 14, border: "1px solid var(--line)", background: "var(--panel-bg)", color: "var(--fg-1)", overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 600 }}>Browse agents</div>
          <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{shown === total ? `${total} agents` : `${shown} of ${total}`}</div>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents, domains…"
            style={{ marginLeft: "auto", width: 260, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-bg-soft)", color: "var(--fg-1)" }}
          />
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: "var(--fg-2)", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ overflowY: "auto", padding: "8px 16px 16px" }}>
          {loading && <div style={{ padding: 24, color: "var(--fg-3)" }}>Loading agent catalog…</div>}
          {error && <div style={{ padding: 16, color: "var(--red-3, #f88)" }}>{error}</div>}
          {!loading && !error && shown === 0 && <div style={{ padding: 24, color: "var(--fg-3)" }}>No agents match “{query}”.</div>}
          {groups.map(([domain, list]) => (
            <div key={domain} style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-3)", margin: "4px 2px 8px" }}>{titleCase(domain)}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))", gap: 8 }}>
                {list.map((agent) => {
                  const installed = installedSet.has(agent.slug);
                  return (
                    <div key={agent.slug} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, background: "var(--panel-bg-soft)", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{agent.label}</div>
                      <div style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{agent.summary}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto" }}>
                        <span style={{ fontSize: 10, color: "var(--fg-3)" }}>{agent.source}{agent.license ? ` · ${agent.license}` : ""}</span>
                        <button
                          type="button"
                          disabled={installed || installing === agent.slug}
                          onClick={() => void handleInstall(agent)}
                          style={{ marginLeft: "auto", padding: "5px 12px", borderRadius: 8, border: "1px solid var(--aeon-line)", background: installed ? "transparent" : "var(--aeon-soft)", color: installed ? "var(--fg-3)" : "var(--cyan-3)", cursor: installed ? "default" : "pointer", fontSize: 12 }}
                        >
                          {installed ? "Installed" : installing === agent.slug ? "Installing…" : "Install"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
