"use client";

import * as React from "react";
import type { GitLawbStatus } from "@/lib/types/gitlawb";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { openExternalUrl } from "@/lib/native/open-external-url";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";
import {
  MANAGED_X_RETURN_EVENT,
  managedXReturnMessage,
  type ManagedXReturnPayload,
} from "@/lib/services/managed-x-return";
import {
  RESEARCH_SYNC_CODE_EVENT,
  stashResearchSyncCode,
  type ResearchSyncCodePayload,
} from "@/lib/services/research-sync-code";
import {
  Badge,
  BBtn,
  BIcon,
  McpGlyph,
  Pill,
  Toggle,
} from "./integrations-primitives";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { XAccountMcpPanel, type ManagedXPanelStatus, type XMcpStatus } from "./XAccountMcpPanel";
import { RobinhoodMcpPanel } from "./RobinhoodMcpPanel";
import { XTranscriptPanel } from "./XTranscriptPanel";
import {
  managedXReturnUrl,
  managedXStatusUrl,
  readJson,
  showManagedXReturnMessage,
  splitArgs,
  summarizeRegistrarOutput,
  tabFromLocation,
  timeAgo,
} from "./integrations-view-helpers";

type TabId = "connections" | "mcp" | "transcript" | "codeproof";

type HiveMcpCatalogItem = {
  id: string;
  name: string;
  source: "awesome-mcp-servers" | "official" | "hivemindos";
  repoUrl: string;
  summary: string;
  categories: string[];
  capabilities: string[];
  credentialKeys: string[];
  sideEffects: Array<"read" | "write" | "network" | "payments" | "browser" | "filesystem">;
  installHint: string;
  safetyNote: string;
};

type McpServerStatus = {
  id: string;
  transport: "stdio" | "http";
  connectedAt: number;
  tools: Array<{ name: string; description?: string }>;
};

type McpTransportDefaults =
  | { transport: "stdio"; command: string; args: string[] }
  | { transport: "http"; url: string };

type McpCatalogCardItem = HiveMcpCatalogItem & McpTransportDefaults & {
  accent: string;
  mono: string;
};

type FetchErrorPayload = { error?: string; message?: string };

type ManagedXReturnPoll = {
  creditAccountId: string;
  slug: string;
  since: number;
  until: number;
};

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "connections", label: "Connections" },
  { id: "mcp", label: "MCP Servers" },
  { id: "transcript", label: "Transcript" },
  { id: "codeproof", label: "Code Proof" },
];

const MCP_DEFAULTS: Record<string, McpTransportDefaults & { accent: string; mono: string }> = {
  "robinhood-trading": { transport: "http", url: "https://agent.robinhood.com/mcp/trading", accent: "#62c78f", mono: "Rh" },
  xapi: { transport: "stdio", command: "node", args: ["scripts/x-mcp-bridge.mjs"], accent: "#f3f0e9", mono: "X" },
  "x-docs": { transport: "http", url: "https://docs.x.com/mcp", accent: "#6f9bd6", mono: "Xd" },
  github: { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], accent: "#c7ccd4", mono: "Gh" },
  "browser-use": { transport: "stdio", command: "npx", args: ["-y", "browser-use-mcp"], accent: "#6f9bd6", mono: "Br" },
  "palmier-pro": { transport: "http", url: "http://127.0.0.1:19789/mcp", accent: "#e09a86", mono: "Pp" },
  rentahuman: { transport: "stdio", command: "npx", args: ["-y", "rentahuman-mcp"], accent: "#7fb98f", mono: "Rh" },
  postgres: { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres"], accent: "#6f9bd6", mono: "Pg" },
  slack: { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"], accent: "#e09a86", mono: "Sl" },
  linear: { transport: "stdio", command: "npx", args: ["-y", "linear-mcp"], accent: "#9b8cf0", mono: "Li" },
  stripe: { transport: "stdio", command: "npx", args: ["-y", "@stripe/mcp"], accent: "#9b8cf0", mono: "St" },
  notion: { transport: "stdio", command: "npx", args: ["-y", "@notionhq/notion-mcp-server"], accent: "#d8d6cf", mono: "No" },
  notebooklm: { transport: "stdio", command: "node", args: ["scripts/notebooklm-mcp.mjs"], accent: "#f0b24d", mono: "Nl" },
};

const MCP_SOURCE = {
  official: { label: "Official", tone: "live" },
  "awesome-mcp-servers": { label: "Community", tone: "" },
  hivemindos: { label: "HivemindOS", tone: "honey" },
} as const;

const MCP_SIDE_EFFECTS = {
  read: { label: "read", tone: "" },
  network: { label: "network", tone: "" },
  write: { label: "write", tone: "warn" },
  filesystem: { label: "filesystem", tone: "warn" },
  browser: { label: "browser", tone: "warn" },
  payments: { label: "payments", tone: "danger" },
} as const;

const MANAGED_X_RETURN_POLL_INTERVAL_MS = 1500;
const MANAGED_X_RETURN_POLL_WINDOW_MS = 5 * 60 * 1000;
const MANAGED_X_RETURN_POLL_GRACE_MS = 5000;

export type IntegrationsViewProps = {
  embedded?: boolean;
  defaultTab?: TabId;
};

export function IntegrationsView({ embedded = false, defaultTab = "connections" }: IntegrationsViewProps) {
  const [tab, setTab] = React.useState<TabId>(() => tabFromLocation(defaultTab, TABS));
  const [managedXReturn, setManagedXReturn] = React.useState<ManagedXReturnPayload | null>(null);

  React.useEffect(() => {
    if (!isTauriDesktopRuntime()) return undefined;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen<ManagedXReturnPayload>(MANAGED_X_RETURN_EVENT, (event) => {
        setTab("mcp");
        setManagedXReturn(event.payload ?? {});
      }))
      .then((unlisten) => {
        const safeUnlisten = createSafeTauriUnlisten(unlisten);
        if (cancelled) {
          safeUnlisten();
          return;
        }
        cleanup = safeUnlisten;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // Deep-linked hivemindos://research/sync pairing code: surface the
  // Connections tab so the Hive Research card mounts and claims the parked
  // code. The stash dedupes against the dashboard-root listener, so the
  // single-use code is still redeemed exactly once.
  React.useEffect(() => {
    if (!isTauriDesktopRuntime()) return undefined;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen<ResearchSyncCodePayload>(RESEARCH_SYNC_CODE_EVENT, (event) => {
        setTab("connections");
        stashResearchSyncCode(event.payload?.code);
      }))
      .then((unlisten) => {
        const safeUnlisten = createSafeTauriUnlisten(unlisten);
        if (cancelled) {
          safeUnlisten();
          return;
        }
        cleanup = safeUnlisten;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className={`fr-root ${embedded ? "ni-embedded" : ""}`} style={{ position: "relative", minHeight: embedded ? undefined : "100vh", background: embedded ? "transparent" : "var(--bg)" }}>
      <div className="ni-wrap">
        <div className="fb-seg" style={{ alignSelf: "flex-start" }}>
          {TABS.map((item) => (
            <button key={item.id} type="button" data-active={tab === item.id ? "" : undefined} onClick={() => setTab(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        {tab === "connections" ? <ConnectionsPanel /> : null}
        {tab === "mcp" ? (
          <>
            <TabHeader eyebrow="Model Context Protocol" title="MCP Servers" sub="Tool servers the hive connects to and calls natively." />
            <McpManager managedXReturn={managedXReturn} onManagedXReturn={setManagedXReturn} />
          </>
        ) : null}
        {tab === "transcript" ? (
          <>
            <TabHeader eyebrow="X / Twitter" title="Transcript" sub="Paste an X link — pull the transcript from the video, or stitch the whole thread into text." />
            <XTranscriptPanel />
          </>
        ) : null}
        {tab === "codeproof" ? (
          <>
            <TabHeader eyebrow="GitLawb" title="Code Proof" sub="Signed code provenance for HivemindOS projects." />
            <CodeProof embedded />
          </>
        ) : null}
      </div>
    </div>
  );
}

export default IntegrationsView;

function TabHeader({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <div className="ni-top">
      <div>
        <div className="fr-eyebrow" style={{ color: "var(--honey)" }}>{eyebrow}</div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
    </div>
  );
}

function McpManager({
  managedXReturn,
  onManagedXReturn,
}: {
  managedXReturn?: ManagedXReturnPayload | null;
  onManagedXReturn: (payload: ManagedXReturnPayload) => void;
}) {
  const [enabled, setEnabled] = React.useState(true);
  const [connected, setConnected] = React.useState<McpServerStatus[]>([]);
  const [catalog, setCatalog] = React.useState<McpCatalogCardItem[]>([]);
  const [xStatus, setXStatus] = React.useState<XMcpStatus | null>(null);
  const [managedXStatus, setManagedXStatus] = React.useState<ManagedXPanelStatus | null>(null);
  const [connectItem, setConnectItem] = React.useState<McpCatalogCardItem | null>(null);
  const [category, setCategory] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [xBusy, setXBusy] = React.useState("");
  const [xMessage, setXMessage] = React.useState("");
  const [managedXReturnPoll, setManagedXReturnPoll] = React.useState<ManagedXReturnPoll | null>(null);
  const [message, setMessage] = React.useState("");
  const handledManagedXReturn = React.useRef("");
  const managedXStatusContext = React.useRef<{ creditAccountId?: string; slug?: string }>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const managedTarget = managedXStatusContext.current;
      const [statusResponse, catalogResponse, xResponse, managedResponse] = await Promise.all([
        fetch("/api/mcp/client", { cache: "no-store" }),
        fetch("/api/mcp/catalog?limit=100", { cache: "no-store" }),
        fetch("/api/integrations/x-mcp", { cache: "no-store" }),
        fetch(managedXStatusUrl(managedTarget.creditAccountId, managedTarget.slug), { cache: "no-store" }),
      ]);
      const status = await readJson<{ ok?: boolean; enabled?: boolean; servers?: McpServerStatus[] } & FetchErrorPayload>(statusResponse);
      const catalogData = await readJson<{ ok?: boolean; servers?: HiveMcpCatalogItem[] } & FetchErrorPayload>(catalogResponse);
      const xData = await readJson<{ ok?: boolean; status?: XMcpStatus } & FetchErrorPayload>(xResponse);
      const managedData = await readJson<{ ok?: boolean } & ManagedXPanelStatus & FetchErrorPayload>(managedResponse);
      if (!statusResponse.ok || status.ok === false) throw new Error(status.error ?? "Could not read MCP client status.");
      if (!catalogResponse.ok || catalogData.ok === false) throw new Error(catalogData.error ?? "Could not read MCP catalog.");
      if (!xResponse.ok || xData.ok === false) throw new Error(xData.error ?? "Could not read X MCP status.");
      if (!managedResponse.ok || managedData.ok === false) throw new Error(managedData.error ?? "Could not read managed X status.");
      setEnabled(status.enabled !== false);
      setConnected(status.servers ?? []);
      setCatalog((catalogData.servers ?? []).map(withMcpDefaults));
      setXStatus(xData.status ?? null);
      setManagedXStatus({
        creditAccounts: managedData.creditAccounts ?? [],
        connections: managedData.connections ?? [],
        credits: managedData.credits,
      });
      showManagedXReturnMessage(setXMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load MCP servers.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const categories = React.useMemo(() => {
    const all = new Set<string>(["all"]);
    catalog.forEach((item) => item.categories.forEach((itemCategory) => all.add(itemCategory)));
    return [...all];
  }, [catalog]);
  const connectedIds = new Set(connected.map((server) => server.id));
  const totalTools = connected.reduce((sum, server) => sum + server.tools.length, 0);
  const cleanQuery = query.trim().toLowerCase();
  const list = catalog.filter((item) => item.id !== "robinhood-trading" && (
    (category === "all" || item.categories.includes(category)) &&
    (!cleanQuery || [item.name, item.summary, ...item.categories, ...item.capabilities, ...item.credentialKeys].join(" ").toLowerCase().includes(cleanQuery))
  ));

  async function setClientEnabled(nextEnabled: boolean) {
    setBusy("toggle");
    setMessage("");
    try {
      const response = await fetch("/api/mcp/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-enabled", enabled: nextEnabled }),
      });
      const data = await readJson<{ ok?: boolean; enabled?: boolean } & FetchErrorPayload>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error ?? "Could not update MCP client.");
      setEnabled(data.enabled !== false);
      if (!data.enabled) setConnected([]);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update MCP client.");
    } finally {
      setBusy("");
    }
  }

  async function refreshTools(id: string) {
    setBusy(`tools:${id}`);
    setMessage("");
    try {
      const response = await fetch("/api/mcp/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-tools", id }),
      });
      const data = await readJson<{ ok?: boolean; tools?: McpServerStatus["tools"] } & FetchErrorPayload>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error ?? "Could not refresh tools.");
      setConnected((servers) => servers.map((server) => server.id === id ? { ...server, tools: data.tools ?? [] } : server));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh tools.");
    } finally {
      setBusy("");
    }
  }

  async function disconnect(id: string) {
    setBusy(`disconnect:${id}`);
    setMessage("");
    try {
      const response = await fetch("/api/mcp/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect", id }),
      });
      const data = await readJson<{ ok?: boolean } & FetchErrorPayload>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error ?? "Could not disconnect server.");
      setConnected((servers) => servers.filter((server) => server.id !== id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect server.");
    } finally {
      setBusy("");
    }
  }

  async function runXAction(action: "save-credentials" | "start-oauth" | "sync-runtimes" | "remove-runtimes", payload: Record<string, unknown> = {}) {
    setXBusy(action);
    setXMessage("");
    try {
      const response = await fetch("/api/integrations/x-mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await readJson<{ ok?: boolean; status?: XMcpStatus; message?: string; stdout?: string } & FetchErrorPayload>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error ?? "X MCP action failed.");
      if (data.status) setXStatus(data.status);
      setXMessage(data.message || summarizeRegistrarOutput(data.stdout) || "X MCP status updated.");
      await load();
    } catch (error) {
      setXMessage(error instanceof Error ? error.message : "X MCP action failed.");
    } finally {
      setXBusy("");
    }
  }

  const refreshManagedX = React.useCallback(async (creditAccountId?: string, slug?: string) => {
    setXBusy("managed-refresh");
    setXMessage("");
    try {
      const cleanCreditAccountId = creditAccountId?.trim() || "";
      const cleanSlug = slug?.trim() || "";
      if (cleanCreditAccountId || cleanSlug) {
        managedXStatusContext.current = {
          creditAccountId: cleanCreditAccountId || undefined,
          slug: cleanSlug || undefined,
        };
      }
      const response = await fetch(managedXStatusUrl(cleanCreditAccountId, cleanSlug), { cache: "no-store" });
      const data = await readJson<{ ok?: boolean } & ManagedXPanelStatus & FetchErrorPayload>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error ?? "Could not read managed X status.");
      setManagedXStatus({
        creditAccounts: data.creditAccounts ?? [],
        connections: data.connections ?? [],
        credits: data.credits,
      });
      const connectionCount = data.connections?.length ?? 0;
      setXMessage(connectionCount > 0
        ? `Managed X account connected: ${connectionCount} connection${connectionCount === 1 ? "" : "s"}.`
        : "Managed X status refreshed.");
    } catch (error) {
      setXMessage(error instanceof Error ? error.message : "Could not read managed X status.");
    } finally {
      setXBusy("");
    }
  }, []);

  React.useEffect(() => {
    if (!managedXReturn) return;
    const key = JSON.stringify(managedXReturn);
    if (handledManagedXReturn.current === key) return;
    handledManagedXReturn.current = key;
    const timer = window.setTimeout(() => {
      const messageText = managedXReturnMessage(managedXReturn);
      if (messageText) setXMessage(messageText);
      void refreshManagedX(managedXReturn.creditAccountId, managedXReturn.slug);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [managedXReturn, refreshManagedX]);

  React.useEffect(() => {
    if (!managedXReturnPoll) return undefined;
    let cancelled = false;
    let timeoutId: number | undefined;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() > managedXReturnPoll.until) {
        setManagedXReturnPoll(null);
        setXMessage("X sign-in is still pending. Use Refresh after finishing in your browser.");
        return;
      }

      const params = new URLSearchParams({
        creditAccountId: managedXReturnPoll.creditAccountId,
        slug: managedXReturnPoll.slug,
        since: String(managedXReturnPoll.since),
      });

      try {
        const response = await fetch(`/api/integrations/x-managed/desktop-return-pending?${params.toString()}`, { cache: "no-store" });
        const data = await readJson<{ ok?: boolean; returned?: ManagedXReturnPayload | null } & FetchErrorPayload>(response);
        if (response.ok && data.ok !== false && data.returned) {
          setManagedXReturnPoll(null);
          onManagedXReturn(data.returned);
          return;
        }
      } catch {
        // Keep polling while the external browser finishes the provider redirect.
      }

      if (!cancelled) {
        timeoutId = window.setTimeout(() => void poll(), MANAGED_X_RETURN_POLL_INTERVAL_MS);
      }
    };

    timeoutId = window.setTimeout(() => void poll(), MANAGED_X_RETURN_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [managedXReturnPoll, onManagedXReturn]);

  async function startManagedXOAuth(creditAccountId: string, slug: string) {
    setXBusy("managed-oauth");
    setXMessage("");
    setManagedXReturnPoll(null);
    managedXStatusContext.current = { creditAccountId, slug };
    try {
      const response = await fetch("/api/integrations/x-managed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "oauth-start",
          creditAccountId,
          slug,
          returnUrl: managedXReturnUrl(creditAccountId, slug),
        }),
      });
      const data = await readJson<{ ok?: boolean; authorizationUrl?: string } & FetchErrorPayload>(response);
      if (!response.ok || data.ok === false) throw new Error(data.error ?? "Could not start managed X sign-in.");
      if (!data.authorizationUrl) throw new Error("Managed X sign-in did not return an authorization URL.");
      await openExternalUrl(data.authorizationUrl);
      if (isTauriDesktopRuntime()) {
        const now = Date.now();
        setManagedXReturnPoll({
          creditAccountId,
          slug,
          since: now - MANAGED_X_RETURN_POLL_GRACE_MS,
          until: now + MANAGED_X_RETURN_POLL_WINDOW_MS,
        });
        setXMessage("Opened X sign-in in your browser. Finish there; HivemindOS will refresh automatically.");
      } else {
        setXMessage("Opened X sign-in in your browser. Finish there, then refresh managed status.");
      }
    } catch (error) {
      setXMessage(error instanceof Error ? error.message : "Could not start managed X sign-in.");
    } finally {
      setXBusy("");
    }
  }

  return (
    <div className="fm-wrap">
      <div className="fm-master">
        <span className="ico"><BIcon name="hex" size={20} /></span>
        <div className="grow">
          <strong>MCP client</strong>
          <small>Connect to MCP servers over stdio or streamable HTTP, list their tools, and let the hive call them natively.</small>
        </div>
        <span className={`ni-badge ${enabled ? "good" : ""}`} style={{ marginRight: 4 }}>{enabled ? "On" : "Off"}</span>
        <Toggle on={enabled} disabled={busy === "toggle"} onChange={() => void setClientEnabled(!enabled)} />
      </div>

      {message ? <p className="ni-note">{message}</p> : null}
      {loading ? <div className="ni-stage ni-center" style={{ minHeight: 220 }}><span className="ni-tspin" /><p>Loading MCP servers...</p></div> : null}

      {!loading ? (
        <>
          <XAccountMcpPanel
            status={xStatus}
            managedStatus={managedXStatus}
            busy={xBusy}
            message={xMessage}
            onSaveCredentials={(clientId, clientSecret, redirectUri) => void runXAction("save-credentials", { clientId, clientSecret, redirectUri })}
            onStartOAuth={() => void runXAction("start-oauth")}
            onStartManagedOAuth={(creditAccountId, slug) => void startManagedXOAuth(creditAccountId, slug)}
            onSyncRuntimes={() => void runXAction("sync-runtimes")}
            onRemoveRuntimes={() => void runXAction("remove-runtimes")}
            onRefresh={() => void load()}
            onRefreshManaged={(creditAccountId, slug) => void refreshManagedX(creditAccountId, slug)}
          />

          <RobinhoodMcpPanel />

          <div>
            <div className="fm-sec">Connected <span className="ct">{connected.length} server{connected.length === 1 ? "" : "s"} · {totalTools} tools</span></div>
            {connected.length ? (
              <div className="fm-rows">
                {connected.map((server) => (
                  <ConnectedMcpRow
                    key={server.id}
                    server={server}
                    enabled={enabled}
                    item={catalog.find((item) => item.id === server.id)}
                    busy={busy}
                    onRefreshTools={() => void refreshTools(server.id)}
                    onDisconnect={() => void disconnect(server.id)}
                  />
                ))}
              </div>
            ) : (
              <div style={{ border: "1px dashed var(--line-2)", borderRadius: "var(--radius)", padding: "26px", textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
                No servers connected. Pick one from the catalog below to add it.
              </div>
            )}
          </div>

          <div>
            <div className="fm-toolbar">
              <div className="fb-pills">
                {categories.map((item) => (
                  <Pill key={item} active={category === item} onClick={() => setCategory(item)}>
                    {item === "all" ? "All" : item}
                  </Pill>
                ))}
              </div>
              <label className="fm-search">
                <BIcon name="search" size={15} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search MCP catalog..." aria-label="Search MCP catalog" />
              </label>
            </div>
            {list.length ? (
              <div className="fm-grid">
                {list.map((item) => (
                  <McpCatalogCard key={item.id} item={item} connected={connectedIds.has(item.id)} onConnect={() => setConnectItem(item)} />
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "var(--fg-3)", padding: "26px 0", textAlign: "center" }}>No servers match "{query}".</p>
            )}
          </div>
        </>
      ) : null}

      {connectItem ? (
        <ConnectMcpModal
          item={connectItem}
          onClose={() => setConnectItem(null)}
          onConnected={(server) => {
            setConnected((servers) => servers.some((item) => item.id === server.id) ? servers.map((item) => item.id === server.id ? server : item) : [...servers, server]);
          }}
        />
      ) : null}
    </div>
  );
}

function ConnectedMcpRow({
  server,
  enabled,
  item,
  busy,
  onRefreshTools,
  onDisconnect,
}: {
  server: McpServerStatus;
  enabled: boolean;
  item?: McpCatalogCardItem;
  busy: string;
  onRefreshTools: () => void;
  onDisconnect: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="fm-row" data-paused={!enabled ? "" : undefined}>
      <div className="fm-rowhead">
        <McpGlyph item={item} size={38} radius={10} />
        <div className="grow">
          <div className="fm-rname">
            {item?.name ?? server.id}
            <span className="fm-pill-mono">{server.transport}</span>
            <span className={enabled ? "fr-dot live" : "fr-dot"} style={{ color: enabled ? "var(--live)" : "var(--fg-4)", width: 7, height: 7 }} />
          </div>
          <div className="fm-rsub">{enabled ? `connected ${timeAgo(server.connectedAt)}` : "paused - MCP client is off"}</div>
        </div>
        <div className="fm-tcount">{server.tools.length}<small>tools</small></div>
        <button type="button" className="fm-toolbtn" onClick={() => setOpen((value) => !value)}>{open ? "Hide tools" : "Tools"}</button>
        <button type="button" className="fm-x" style={{ width: 32, height: 32 }} title="Refresh tools" disabled={busy === `tools:${server.id}`} onClick={onRefreshTools}><BIcon name="refresh" size={15} /></button>
        <button type="button" className="fm-x" style={{ width: 32, height: 32 }} title="Disconnect" disabled={busy === `disconnect:${server.id}`} onClick={onDisconnect}><BIcon name="trash" size={15} /></button>
      </div>
      {open ? (
        <div className="fm-tools">
          {server.tools.map((tool) => (
            <div key={tool.name} className="fm-tool">
              <span className="tn">{tool.name}</span>
              <span className="td">{tool.description || "No description provided."}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function McpCatalogCard({ item, connected, onConnect }: { item: McpCatalogCardItem; connected: boolean; onConnect: () => void }) {
  const source = MCP_SOURCE[item.source] || { label: item.source, tone: "" };
  return (
    <div className="fm-card">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
        <McpGlyph item={item} size={40} />
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", fontFamily: "var(--f-display)", lineHeight: 1.25 }}>{item.name}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            <Badge tone={source.tone}>{source.label}</Badge>
            {connected ? <Badge tone="live">Connected</Badge> : null}
          </div>
        </div>
      </div>
      <div className="body">
        <p className="fm-summary">{item.summary}</p>
        <div className="fm-chips">{item.categories.map((category) => <span key={category} className="fm-chip">{category}</span>)}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <EffectBadges item={item} />
        <span className="fm-secrets">{item.credentialKeys.length ? `${item.credentialKeys.length} secret${item.credentialKeys.length > 1 ? "s" : ""}` : "no secrets"}</span>
      </div>
      <div className="fm-catfoot">
        <span className="fm-repo">{item.repoUrl}</span>
        {connected
          ? <BBtn sm style={{ flex: "0 0 auto" }}><BIcon name="check" size={13} /> Connected</BBtn>
          : <BBtn variant="primary" sm style={{ flex: "0 0 auto" }} onClick={onConnect}><BIcon name="plug" size={13} /> Connect</BBtn>}
      </div>
    </div>
  );
}

function ConnectMcpModal({
  item,
  onClose,
  onConnected,
}: {
  item: McpCatalogCardItem;
  onClose: () => void;
  onConnected: (server: McpServerStatus) => void;
}) {
  const [phase, setPhase] = React.useState<"config" | "connecting" | "done">("config");
  const [transport, setTransport] = React.useState<"stdio" | "http">(item.transport);
  const [command, setCommand] = React.useState(item.transport === "stdio" ? item.command : "npx");
  const [args, setArgs] = React.useState(item.transport === "stdio" ? item.args.join(" ") : "");
  const [url, setUrl] = React.useState(item.transport === "http" ? item.url : "http://127.0.0.1:8000/mcp");
  const [creds, setCreds] = React.useState<Record<string, string>>(() => Object.fromEntries(item.credentialKeys.map((key) => [key, ""])));
  const [show, setShow] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const risky = mcpRiskyEffects(item);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "connecting") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  async function start() {
    setPhase("connecting");
    setMessage("");
    const cleanCreds = Object.fromEntries(Object.entries(creds).filter(([, value]) => value.trim()));
    const server = transport === "stdio"
      ? { id: item.id, transport, command: command.trim(), args: splitArgs(args), env: cleanCreds }
      : { id: item.id, transport, url: url.trim(), headers: cleanCreds };
    try {
      const response = await fetch("/api/mcp/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect", server }),
      });
      const data = await readJson<{ ok?: boolean; server?: McpServerStatus } & FetchErrorPayload>(response);
      if (!response.ok || data.ok === false || !data.server) throw new Error(data.error ?? "Could not connect MCP server.");
      onConnected(data.server);
      setPhase("done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect MCP server.");
      setPhase("config");
    }
  }

  return (
    <div className="fm-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && phase !== "connecting") onClose(); }}>
      <div className="fm-modal" role="dialog" aria-modal="true" aria-label={`Connect ${item.name}`}>
        <div className="fm-mhead">
          <div style={{ display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0 }}>
            <McpGlyph item={item} size={40} />
            <div style={{ minWidth: 0 }}>
              <div className="fb-eyebrow" style={{ marginBottom: 6 }}>{phase === "done" ? "Connected" : "Connect server"}</div>
              <h3>{item.name}</h3>
            </div>
          </div>
          <button type="button" className="fm-x" onClick={onClose} style={{ transform: "rotate(45deg)", opacity: phase === "connecting" ? 0.4 : 1 }} disabled={phase === "connecting"}><BIcon name="plus" size={15} sw={2} /></button>
        </div>

        <div className="fm-mbody">
          {phase === "config" ? (
            <>
              {risky.length ? (
                <div className="fm-note" data-danger={risky.includes("payments") ? "" : undefined}>
                  <BIcon name="shield" size={15} /><span>{item.safetyNote}</span>
                </div>
              ) : null}

              <div className="fb-label">Transport
                <div className="fb-seg sub" style={{ alignSelf: "flex-start", marginTop: 4 }}>
                  <button type="button" data-active={transport === "stdio" ? "" : undefined} onClick={() => setTransport("stdio")}>stdio</button>
                  <button type="button" data-active={transport === "http" ? "" : undefined} onClick={() => setTransport("http")}>Streamable HTTP</button>
                </div>
              </div>

              <details className="fm-advanced">
                <summary>Advanced connection settings</summary>
                <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
                  {transport === "stdio" ? (
                    <div className="fb-grid2" style={{ gridTemplateColumns: "120px 1fr" }}>
                      <label className="fb-label">Command
                        <input className="fb-field fb-mono" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx" />
                      </label>
                      <label className="fb-label">Arguments
                        <input className="fb-field fb-mono" value={args} onChange={(event) => setArgs(event.target.value)} placeholder="-y @scope/server" />
                      </label>
                    </div>
                  ) : (
                    <label className="fb-label">Server URL
                      <input className="fb-field fb-mono" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://host:port/mcp" />
                    </label>
                  )}
                </div>
              </details>

              {item.credentialKeys.length ? (
                <div>
                  <div className="fm-sec" style={{ margin: "2px 0 9px" }}>Credential values</div>
                  <div style={{ display: "grid", gap: 9 }}>
                    {item.credentialKeys.map((key) => (
                      <label key={key} className="fb-label">{key}
                        <div className="fm-keyrow">
                          <input className="fb-field fb-mono" type={show ? "text" : "password"} value={creds[key] ?? ""} onChange={(event) => setCreds((current) => ({ ...current, [key]: event.target.value }))} placeholder="Configured value" />
                          <button type="button" className="fm-x" style={{ width: 38, height: 38 }} onClick={() => setShow((value) => !value)} title={show ? "Hide" : "Show"}><BIcon name={show ? "eye-off" : "eye"} size={15} /></button>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="fm-note"><BIcon name="check" size={15} /><span>No credentials required.</span></div>
              )}

              <EffectBadges item={item} />
              {message ? <p className="ni-note">{message}</p> : null}
            </>
          ) : phase === "connecting" ? (
            <div className="fm-center">
              <div className="fm-spin" />
              <div>
                <div style={{ fontFamily: "var(--f-display)", fontSize: 15, letterSpacing: "-0.01em" }}>Connecting to {item.name}...</div>
                <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 5 }}>Starting the {transport === "stdio" ? "stdio process" : "HTTP session"} and listing tools.</div>
              </div>
            </div>
          ) : (
            <div className="fm-center">
              <div className="fm-done"><BIcon name="check" size={26} sw={2.4} /></div>
              <div>
                <div style={{ fontFamily: "var(--f-display)", fontSize: 16, letterSpacing: "-0.01em" }}>{item.name} connected</div>
                <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 5 }}>Its tools are now callable by the hive. Manage it under Connected.</div>
              </div>
            </div>
          )}
        </div>

        <div className="fm-mfoot">
          {phase === "config" ? (
            <>
              <BBtn onClick={onClose}>Cancel</BBtn>
              <BBtn variant="primary" onClick={() => void start()}><BIcon name="plug" size={14} /> Connect</BBtn>
            </>
          ) : phase === "connecting" ? (
            <BBtn disabled><BIcon name="sync" size={14} /> Connecting...</BBtn>
          ) : (
            <BBtn variant="primary" onClick={onClose}><BIcon name="check" size={14} /> Done</BBtn>
          )}
        </div>
      </div>
    </div>
  );
}

function CodeProof({ embedded }: { embedded?: boolean }) {
  const [status, setStatus] = React.useState<GitLawbStatus | null>(null);
  const [linkedProjects, setLinkedProjects] = React.useState(0);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");

  const load = React.useCallback(async () => {
    setMessage("");
    const [statusResponse, projectsResponse] = await Promise.all([
      fetch("/api/gitlawb/status", { cache: "no-store" }).then((response) => response.json()).catch(() => null),
      fetch("/api/projects", { cache: "no-store" }).then((response) => response.json()).catch(() => null),
    ]);
    if (statusResponse?.ok) setStatus(statusResponse.status as GitLawbStatus);
    if (projectsResponse?.ok) {
      const projects = (projectsResponse.projects ?? []) as Array<{ gitlawbRepo?: unknown }>;
      setLinkedProjects(projects.filter((project) => project.gitlawbRepo).length);
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function run(action: "setup-cli" | "identity" | "node/setup") {
    setBusy(action);
    setMessage("");
    try {
      const response = await fetch(`/api/gitlawb/${action}`, { method: "POST" });
      const data = await response.json().catch(() => null) as ({ status?: GitLawbStatus } & FetchErrorPayload) | null;
      if (data?.status) setStatus(data.status);
      setMessage(data?.message || data?.error || "GitLawb status updated.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "GitLawb action failed.");
    } finally {
      setBusy("");
    }
  }

  const cliInstalled = status?.cli.installed === true;
  const did = status?.identity.did;
  const proofReady = Boolean(cliInstalled && status?.identity.source === "local");
  const pills = [
    { label: cliInstalled ? "CLI ready" : "CLI missing", on: cliInstalled },
    { label: did ? "DID ready" : "DID missing", on: Boolean(did) },
    { label: status?.node.healthy ? "Node healthy" : "Node optional", neutral: !status?.node.healthy },
    { label: `${linkedProjects} linked project${linkedProjects === 1 ? "" : "s"}`, on: linkedProjects > 0 },
  ];

  return (
    <div className="ni-proof">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <span className="fb-tile" style={{ color: "var(--honey)" }}><BIcon name="shield" size={19} /></span>
          {embedded ? (
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--fg-4)" }}>Identity &amp; signing</div>
          ) : (
            <div>
              <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 16, letterSpacing: "-0.01em" }}>Code Proof</div>
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>Signed code provenance for HivemindOS projects.</div>
            </div>
          )}
        </div>
        <button type="button" className="fb-iconbtn" title="Refresh Code Proof status" onClick={() => void load()}><BIcon name="refresh" size={15} /></button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {pills.map((pill) => <span key={pill.label} className={`ni-pill ${pill.on ? "good" : pill.neutral ? "" : "warn"}`}>{pill.label}</span>)}
      </div>
      {did ? <code>{did}</code> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <BBtn sm disabled={Boolean(busy)} onClick={() => void run("setup-cli")}><BIcon name="branch" size={13} /> {busy === "setup-cli" ? "Working..." : cliInstalled ? "Repair CLI" : "Install CLI"}</BBtn>
        <BBtn sm disabled={Boolean(busy || !cliInstalled)} onClick={() => void run("identity")}><BIcon name="shield" size={13} /> {busy === "identity" ? "Working..." : did ? "Refresh DID" : "Create DID"}</BBtn>
        <BBtn sm disabled={Boolean(busy)} onClick={() => void run("node/setup")}><BIcon name="branch" size={13} /> {busy === "node/setup" ? "Working..." : "Local node"}</BBtn>
      </div>
      <small style={{ color: "var(--fg-3)", fontSize: 11.5, lineHeight: 1.5 }}>
        {proofReady
          ? "Proof-ready mode is active. Local repo hosting stays lazy until a GitLawb-backed project needs it."
          : "Normal HivemindOS work keeps running if GitLawb is missing."}
      </small>
      {message ? <small style={{ color: "var(--honey)", fontSize: 11.5, lineHeight: 1.5 }}>{message}</small> : null}
    </div>
  );
}

function EffectBadges({ item }: { item: Pick<McpCatalogCardItem, "sideEffects"> }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
      {item.sideEffects.map((effect) => {
        const meta = MCP_SIDE_EFFECTS[effect] || { label: effect, tone: "" };
        return <span key={effect} className="fm-eff" data-tone={meta.tone || undefined}>{meta.label}</span>;
      })}
    </div>
  );
}

function withMcpDefaults(item: HiveMcpCatalogItem): McpCatalogCardItem {
  const defaults = MCP_DEFAULTS[item.id] ?? { transport: "stdio" as const, command: "npx", args: [], accent: "var(--fg-3)", mono: item.name.slice(0, 2) || "M" };
  return { ...item, ...defaults };
}

function mcpRiskyEffects(item: Pick<McpCatalogCardItem, "sideEffects">) {
  return item.sideEffects.filter((effect) => effect === "write" || effect === "payments" || effect === "filesystem" || effect === "browser");
}
