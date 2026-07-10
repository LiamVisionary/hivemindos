"use client";

import * as React from "react";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AeonControlPlaneSnapshot } from "@/lib/types/aeon-control-plane";
import { AEON_GATEWAYS, AEON_HARNESSES, AEON_MODELS } from "@/lib/services/runtime-adapters/aeon-capabilities";
import { LoadingBar, Skeleton, SkeletonText, Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";
import { Btn, Card, Pill, SectionHead, StatusRow, aeonStyles as styles } from "./parts";

type ControlResponse = { ok?: boolean; error?: string; controlPlane?: AeonControlPlaneSnapshot; result?: unknown };

async function controlRequest(agent: AgentProfile, body: Record<string, unknown>) {
  const response = await fetch("/api/runtimes/aeon/control-plane", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, agent }),
  });
  const data = await response.json().catch(() => null) as ControlResponse | null;
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `AEON request failed with HTTP ${response.status}.`);
  return data ?? {};
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 9,
  border: "1px solid var(--line-2)",
  background: "rgba(2,6,23,0.5)",
  color: "var(--fg)",
  fontSize: 12,
};

const inputStyle: React.CSSProperties = { ...selectStyle, fontFamily: "var(--f-mono)" };

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ padding: 12, borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel-bg-soft)" }}>
      <div style={{ fontSize: 20, fontFamily: "var(--f-mono)", color: "var(--cyan-2)", fontWeight: 700 }}>{value}</div>
      <div className={styles.monoCap} style={{ color: "var(--fg-4)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

function ControlPlaneSkeleton() {
  return (
    <div role="status" aria-label="Loading AEON control plane" style={{ display: "grid", gap: 14 }}>
      <LoadingBar />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {[0, 1, 2, 3].map((key) => (
          <Card key={key}>
            <Skeleton style={{ width: 150, height: 18, marginBottom: 16 }} />
            <SkeletonText lines={4} />
          </Card>
        ))}
      </div>
    </div>
  );
}

export function AeonControlPlane({ agent, onToast, onChanged }: { agent?: AgentProfile; onToast: (message: string) => void; onChanged?: () => void }) {
  const [snapshot, setSnapshot] = React.useState<AeonControlPlaneSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [strategy, setStrategy] = React.useState("");
  const [strategyGoal, setStrategyGoal] = React.useState("");
  const [communityRepo, setCommunityRepo] = React.useState("");

  const load = React.useCallback(async () => {
    if (!agent) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const data = await controlRequest(agent, { action: "summary" });
      setSnapshot(data.controlPlane ?? null);
      setStrategy(data.controlPlane?.strategy.content ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the AEON control plane.");
    } finally {
      setLoading(false);
    }
  }, [agent]);

  React.useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const mutate = React.useCallback(async (key: string, body: Record<string, unknown>, success: string) => {
    if (!agent) return;
    setBusy(key);
    setError("");
    try {
      await controlRequest(agent, body);
      onToast(success);
      await load();
      onChanged?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "AEON update failed.";
      setError(message);
      onToast(message);
    } finally {
      setBusy("");
    }
  }, [agent, load, onChanged, onToast]);

  if (loading) return <ControlPlaneSkeleton />;
  if (!agent) return <Card><p style={{ margin: 0, color: "var(--fg-3)" }}>Link an AEON v0.1 workspace to use the control plane.</p></Card>;
  if (!snapshot) return <Card><SectionHead eyebrow="AEON v0.1" title="Control plane unavailable" icon="shield" /><p style={{ color: "var(--danger-2)" }}>{error}</p><Btn icon="refresh" onClick={() => void load()}>Try again</Btn></Card>;

  const activeMcp = Object.entries(snapshot.mcpServers);
  const installedMcp = new Set(activeMcp.map(([name]) => name));
  const installedSecrets = snapshot.secrets.filter((secret) => secret.isSet).length;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {busy ? <div role="status" aria-label="Saving AEON changes"><LoadingBar /></div> : null}
      {error ? <div style={{ padding: "9px 12px", borderRadius: 9, color: "var(--danger-2)", border: "1px solid rgba(251,113,133,0.35)", background: "rgba(251,113,133,0.10)" }}>{error}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
        <Metric label="chains" value={`${snapshot.chains.definitions}/${snapshot.chains.artifacts}`} />
        <Metric label="reactive rules" value={snapshot.reactive.rules} />
        <Metric label="attestations" value={snapshot.provenance.attestations} />
        <Metric label="health records" value={snapshot.health.scoreRecords} />
        <Metric label="OKF knowledge" value={snapshot.okf.markdownFiles} />
        <Metric label="secrets set" value={`${installedSecrets}/${snapshot.secrets.length}`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <SectionHead eyebrow="Runtime" title="Model, harness & gateway" icon="bot" action={<Pill tone="green">AEON {snapshot.layout.generation}</Pill>} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}><span className={styles.monoCap}>Model</span><select style={selectStyle} value={snapshot.config.model} disabled={Boolean(busy)} onChange={(event) => void mutate("model", { action: "config-set", field: "model", value: event.target.value }, "Updated AEON model.")}>{AEON_MODELS.map((model) => <option key={model}>{model}</option>)}</select></label>
            <label style={{ display: "grid", gap: 6 }}><span className={styles.monoCap}>Harness</span><select style={selectStyle} value={snapshot.config.harness} disabled={Boolean(busy)} onChange={(event) => void mutate("harness", { action: "config-set", field: "harness", value: event.target.value }, "Updated AEON harness.")}>{AEON_HARNESSES.map((harness) => <option key={harness}>{harness}</option>)}</select></label>
            <label style={{ display: "grid", gap: 6 }}><span className={styles.monoCap}>Gateway</span><select style={selectStyle} value={snapshot.config.gateway} disabled={Boolean(busy)} onChange={(event) => void mutate("gateway", { action: "config-set", field: "gateway", value: event.target.value }, "Updated AEON gateway.")}>{AEON_GATEWAYS.map((gateway) => <option key={gateway}>{gateway}</option>)}</select></label>
          </div>
          <div style={{ display: "grid", gap: 7, marginTop: 14 }}>
            <StatusRow label="CLI" value={snapshot.layout.hasCli ? "Available" : "Missing"} ok={snapshot.layout.hasCli} />
            <StatusRow label="Catalog" value={snapshot.layout.hasCatalog ? "catalog/skills.json" : "Missing"} ok={snapshot.layout.hasCatalog} mono />
            <StatusRow label="JSON render" value={snapshot.config.jsonrenderEnabled ? "Enabled" : "Disabled"} ok={snapshot.config.jsonrenderEnabled} />
            <StatusRow label="Self-healing" value={snapshot.health.enabled ? `${snapshot.health.issues} issue record(s)` : "skill-health disabled"} ok={snapshot.health.enabled} />
            <StatusRow label="OKF" value={snapshot.okf.configured && snapshot.okf.validatorAvailable ? `${snapshot.okf.version || "v0.1"} · ${snapshot.okf.markdownFiles} Markdown files` : "Not configured"} ok={snapshot.okf.configured && snapshot.okf.validatorAvailable} />
          </div>
        </Card>

        <Card>
          <SectionHead eyebrow="Packs" title="Skill packs" icon="layers" action={<Pill tone="cyan">{snapshot.packs.firstParty.length + snapshot.packs.community.length}</Pill>} />
          <div className={styles.scroll} style={{ display: "grid", gap: 7, maxHeight: 190, overflow: "auto" }}>
            {snapshot.packs.firstParty.map((pack) => <StatusRow key={pack.key} label={pack.name} value={`${pack.enabled ?? 0}/${pack.total ?? 0} enabled`} ok={(pack.enabled ?? 0) > 0} />)}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <select aria-label="Community pack" style={selectStyle} value={communityRepo} onChange={(event) => setCommunityRepo(event.target.value)}>
              <option value="">Choose community pack</option>
              {snapshot.packs.community.filter((pack) => pack.repo).map((pack) => <option key={pack.repo} value={pack.repo}>{pack.name}</option>)}
            </select>
            <Btn variant="secondary" disabled={!communityRepo || Boolean(busy)} onClick={() => void mutate("pack", { action: "pack-install", repo: communityRepo }, `Installed ${communityRepo}.`)}>{busy === "pack" ? <><Spinner />Installing</> : "Install"}</Btn>
          </div>
        </Card>

        <Card>
          <SectionHead eyebrow="Tools" title="MCP servers" icon="sparkles" action={<Pill tone="cyan">{activeMcp.length} active</Pill>} />
          <div style={{ display: "grid", gap: 7 }}>
            {activeMcp.length ? activeMcp.map(([name]) => (
              <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 9 }}>
                <code style={{ color: "var(--fg-2)" }}>{name}</code>
                <Btn size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void mutate(`mcp-rm-${name}`, { action: "mcp-remove", name }, `Removed ${name}.`)}>Remove</Btn>
              </div>
            )) : <p style={{ margin: 0, color: "var(--fg-4)", fontSize: 12 }}>No MCP servers configured.</p>}
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 12 }}>
            {snapshot.mcpCatalog.filter((entry) => !installedMcp.has(entry.slug)).slice(0, 8).map((entry) => <Btn key={entry.slug} size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void mutate(`mcp-${entry.slug}`, { action: "mcp-add", name: entry.slug }, `Added ${entry.name}.`)}>+ {entry.name}</Btn>)}
          </div>
        </Card>

        <Card>
          <SectionHead eyebrow="Identity" title="Strategy & soul" icon="memory" action={<Pill tone={snapshot.strategy.exists && snapshot.soul.soul.exists ? "green" : "honey"}>{snapshot.strategy.exists && snapshot.soul.soul.exists ? "Ready" : "Needs build"}</Pill>} />
          <label style={{ display: "grid", gap: 6 }}><span className={styles.monoCap}>Strategy document</span><textarea value={strategy} onChange={(event) => setStrategy(event.target.value)} rows={5} style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--f-body)", lineHeight: 1.5 }} /></label>
          <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
            <Btn size="sm" variant="secondary" disabled={!strategy.trim() || Boolean(busy)} onClick={() => void mutate("strategy-set", { action: "strategy-set", content: strategy }, "Saved AEON strategy.")}>Save strategy</Btn>
            <Btn size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void mutate("soul", { action: "soul-build" }, "Built AEON soul and style.")}>{busy === "soul" ? <><Spinner />Building</> : "Build soul"}</Btn>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input value={strategyGoal} onChange={(event) => setStrategyGoal(event.target.value)} placeholder="Goal for a generated strategy" style={inputStyle} />
            <Btn size="sm" variant="primary" disabled={!strategyGoal.trim() || Boolean(busy)} onClick={() => void mutate("strategy-build", { action: "strategy-build", goal: strategyGoal }, "Built AEON strategy.")}>{busy === "strategy-build" ? <><Spinner />Building</> : "Build"}</Btn>
          </div>
        </Card>
      </div>

      <Card>
        <SectionHead eyebrow="Notifications" title="Telegram delivery" icon="send" action={<Btn size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void mutate("telegram", { action: "telegram-register" }, "Registered AEON Telegram delivery.")}>{busy === "telegram" ? <><Spinner />Registering</> : "Register webhook"}</Btn>} />
        <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.55 }}>Uses AEON’s own Telegram registration flow and its secret catalog. The token value remains in GitHub secrets and is never returned here.</p>
      </Card>
    </div>
  );
}
