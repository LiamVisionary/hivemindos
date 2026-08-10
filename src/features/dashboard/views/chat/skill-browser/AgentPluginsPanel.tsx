"use client";

import * as React from "react";
import { BBtn, Badge, BIcon, Toggle } from "./primitives";

type PluginDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
  componentId?: string;
};

type PluginInspection = {
  specificationVersion: string;
  valid: boolean;
  pluginRoot: string;
  manifest?: {
    name: string;
    version?: string;
    description?: string;
    author?: { name?: string };
    license?: string;
  };
  skills: Array<{ name: string; description: string; directoryName: string }>;
  mcpServers: Array<{ name: string; config: { type: string } }>;
  extensionNamespaces: string[];
  diagnostics: PluginDiagnostic[];
};

type LoadedPlugin = {
  pluginRoot: string;
  name: string;
  loadedAt: string;
  pluginDataPath: string;
  skills: Array<{ name: string; status: "installed" | "updated" | "skipped"; reason?: string }>;
  mcpServers: Array<{ name: string; transport: string; status: "connected" | "failed"; error?: string }>;
};

type PluginApiResponse = {
  ok?: boolean;
  error?: string;
  plugin?: PluginInspection | {
    loaded: boolean;
    inspection: PluginInspection;
    plugin?: LoadedPlugin;
  };
};

function isLoadReport(value: PluginApiResponse["plugin"]): value is Exclude<PluginApiResponse["plugin"], PluginInspection | undefined> {
  return Boolean(value && "inspection" in value);
}

function diagnosticTone(severity: PluginDiagnostic["severity"]) {
  if (severity === "error") return "danger" as const;
  if (severity === "warning") return "honey" as const;
  return undefined;
}

export function AgentPluginsPanel({
  vaultPath,
  onStatus,
}: {
  vaultPath?: string;
  onStatus: (message: string) => void;
}) {
  const [pluginPath, setPluginPath] = React.useState("");
  const [importSkills, setImportSkills] = React.useState(true);
  const [connectMcp, setConnectMcp] = React.useState(true);
  const [busy, setBusy] = React.useState<"inspect" | "load" | "unload" | "">("");
  const [inspection, setInspection] = React.useState<PluginInspection | null>(null);
  const [loaded, setLoaded] = React.useState<LoadedPlugin | null>(null);

  const run = React.useCallback(async (action: "inspect" | "load") => {
    const requestedPath = pluginPath.trim();
    if (!requestedPath) {
      onStatus("Choose the directory containing plugin.json.");
      return;
    }
    setBusy(action);
    onStatus(action === "inspect" ? "Inspecting Agent Plugin package..." : "Loading Agent Plugin components...");
    const response = await fetch("/api/plugins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        pluginPath: requestedPath,
        vaultPath,
        importSkills,
        connectMcp,
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as PluginApiResponse | null;
    setBusy("");
    if (!response?.ok || !data?.ok || !data.plugin) {
      if (data?.plugin && isLoadReport(data.plugin)) setInspection(data.plugin.inspection);
      onStatus(data?.error ?? "HivemindOS could not inspect that Agent Plugin directory.");
      return;
    }
    if (isLoadReport(data.plugin)) {
      setInspection(data.plugin.inspection);
      setLoaded(data.plugin.plugin ?? null);
      const installed = data.plugin.plugin?.skills.filter((item) => item.status !== "skipped").length ?? 0;
      const connected = data.plugin.plugin?.mcpServers.filter((item) => item.status === "connected").length ?? 0;
      onStatus(`Loaded ${data.plugin.inspection.manifest?.name ?? "plugin"}: ${installed} skills imported, ${connected} MCP servers connected.`);
      return;
    }
    setInspection(data.plugin);
    setLoaded(null);
    onStatus(data.plugin.valid
      ? `Valid Agent Plugins ${data.plugin.specificationVersion} package: ${data.plugin.skills.length} skills, ${data.plugin.mcpServers.length} supported MCP servers.`
      : "The package was rejected. Review its diagnostics below.");
  }, [connectMcp, importSkills, onStatus, pluginPath, vaultPath]);

  const unload = React.useCallback(async () => {
    if (!loaded) return;
    setBusy("unload");
    onStatus(`Disconnecting ${loaded.name} MCP servers...`);
    const response = await fetch("/api/plugins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unload", pluginPath: loaded.pluginRoot }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string; unloaded?: boolean } | null;
    setBusy("");
    if (!response?.ok || !data?.ok || !data.unloaded) {
      onStatus(data?.error ?? "The plugin could not be unloaded.");
      return;
    }
    setLoaded(null);
    onStatus(`${loaded.name} MCP servers disconnected. Imported skills and plugin data were preserved.`);
  }, [loaded, onStatus]);

  return (
    <div className="sb-plugin-panel">
      <div className="sb-plugin-intro">
        <span className="fb-tile"><BIcon name="plug" size={17} /></span>
        <div>
          <div className="sb-row-name">Load a local Agent Plugin</div>
          <p className="sb-card-desc">
            Select a package root containing <span className="fb-mono">plugin.json</span>. Inspecting is read-only; loading can import valid skills and start supported MCP servers.
          </p>
        </div>
        <Badge tone="honey">Spec 1.0.0</Badge>
      </div>

      <div className="sb-plugin-picker">
        <label className="fb-label">
          Plugin directory
          <input
            className="fb-field fb-mono"
            value={pluginPath}
            onChange={(event) => {
              setPluginPath(event.target.value);
              setInspection(null);
              setLoaded(null);
            }}
            placeholder="/absolute/path/to/plugin"
            spellCheck={false}
          />
        </label>
        <div className="sb-plugin-picker-actions">
          <BBtn sm disabled={Boolean(busy) || !pluginPath.trim()} onClick={() => void run("inspect")}>
            <BIcon name={busy === "inspect" ? "sync" : "eye"} size={13} />{busy === "inspect" ? "Inspecting..." : "Inspect"}
          </BBtn>
          <BBtn variant="primary" sm disabled={Boolean(busy) || !pluginPath.trim()} onClick={() => void run("load")}>
            <BIcon name={busy === "load" ? "sync" : "plug"} size={13} />{busy === "load" ? "Loading..." : "Load plugin"}
          </BBtn>
          {loaded ? (
            <BBtn sm disabled={Boolean(busy)} onClick={() => void unload()}>
              <BIcon name={busy === "unload" ? "sync" : "repeat"} size={13} />{busy === "unload" ? "Disconnecting..." : "Unload MCP"}
            </BBtn>
          ) : null}
        </div>
      </div>

      <div className="sb-plugin-options">
        <div>
          <Toggle on={importSkills} onChange={() => setImportSkills((value) => !value)} />
          <span><strong>Import skills</strong><small>Audit and copy valid skills into the shared brain.</small></span>
        </div>
        <div>
          <Toggle on={connectMcp} onChange={() => setConnectMcp((value) => !value)} />
          <span><strong>Connect MCP</strong><small>Start valid stdio and Streamable HTTP servers.</small></span>
        </div>
      </div>

      <div className="sb-bankr-safety">
        <BIcon name="shield" size={14} />
        Local stdio servers execute with your user permissions. Inspect diagnostics and trust the package source before loading it.
      </div>

      {inspection ? (
        <div className="sb-plugin-results">
          <div className="sb-plugin-summary">
            <div>
              <div className="fb-eyebrow">{inspection.valid ? "Package accepted" : "Package rejected"}</div>
              <div className="sb-row-name">{inspection.manifest?.name ?? "Invalid Agent Plugin"}{inspection.manifest?.version ? ` · ${inspection.manifest.version}` : ""}</div>
              {inspection.manifest?.description ? <p className="sb-card-desc">{inspection.manifest.description}</p> : null}
              <div className="sb-slug">{inspection.pluginRoot}</div>
            </div>
            <Badge tone={inspection.valid ? "live" : "danger"}>{inspection.valid ? "valid" : "blocked"}</Badge>
          </div>

          <div className="sb-plugin-components">
            <section>
              <div className="sb-section">Skills · {inspection.skills.length}</div>
              {inspection.skills.length ? inspection.skills.map((skill) => {
                const runtimeSkill = loaded?.skills.find((item) => item.name === skill.name);
                return (
                  <div className="sb-row" key={skill.name}>
                    <BIcon name="doc" size={14} />
                    <div className="grow">
                      <span className="sb-row-name">{skill.name}</span>
                      <p className="sb-card-desc">{runtimeSkill?.reason ?? skill.description}</p>
                    </div>
                    <Badge tone={runtimeSkill?.status === "skipped" ? "danger" : runtimeSkill ? "live" : undefined}>
                      {runtimeSkill?.status ?? "ready"}
                    </Badge>
                  </div>
                );
              }) : <div className="sb-empty">No valid skills discovered.</div>}
            </section>
            <section>
              <div className="sb-section">MCP servers · {inspection.mcpServers.length}</div>
              {inspection.mcpServers.length ? inspection.mcpServers.map((server) => {
                const runtimeServer = loaded?.mcpServers.find((item) => item.name === server.name);
                return (
                  <div className="sb-row" key={server.name}>
                    <BIcon name="plug" size={14} />
                    <div className="grow"><span className="sb-row-name">{server.name}</span><span className="sb-slug">{server.config.type}</span></div>
                    <Badge tone={runtimeServer?.status === "failed" ? "danger" : runtimeServer?.status === "connected" ? "live" : undefined}>
                      {runtimeServer?.status ?? "ready"}
                    </Badge>
                  </div>
                );
              }) : <div className="sb-empty">No supported MCP servers discovered.</div>}
            </section>
          </div>

          <div className="sb-section">Diagnostics · {inspection.diagnostics.length}</div>
          {inspection.diagnostics.length ? (
            <div className="sb-plugin-diagnostics">
              {inspection.diagnostics.map((item, index) => (
                <div key={`${item.code}-${index}`} className="sb-plugin-diagnostic">
                  <Badge tone={diagnosticTone(item.severity)}>{item.severity}</Badge>
                  <div><span className="fb-mono">{item.code}</span><p>{item.message}</p></div>
                </div>
              ))}
            </div>
          ) : <div className="sb-bankr-notice"><BIcon name="check" size={14} />No conformance diagnostics.</div>}
        </div>
      ) : null}
    </div>
  );
}
