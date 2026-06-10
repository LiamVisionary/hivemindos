import type { FleetActiveApp, FleetMachine } from "./fleet-data";

export type FleetHostedApp = FleetActiveApp & {
  sourceName?: string;
  machineName: string;
  machineHost: string;
  local: boolean;
  online: boolean;
  interactive: boolean;
  port: number;
};

export type FleetActiveAppBadgeSnapshot = {
  key: string;
  app: FleetActiveApp;
  machineId: string;
  agentId: string;
  agentName: string;
  taskKey: string;
};

const ACTIVE_APP_TASK_FRESH_MS = 30 * 60 * 1000;

function normalize(value?: string | number | null) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Host identity for app<->machine matching: IPv4 stays whole; otherwise the
// first dns label, normalized, with the `hivemindos` link prefix stripped so
// a link-node host matches its machine's identity.
function hostIdentity(value?: string) {
  const raw = (value ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!raw) return "";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(raw)) return raw;
  return normalize(raw.split(".")[0]).replace(/^hivemindos/, "");
}

function appMatchesMachine(machine: FleetMachine, app: FleetHostedApp) {
  if (app.local && (machine.role === "Primary" || /this(?:mac|machine)/i.test(machine.name) || machine.ip === "127.0.0.1")) {
    return true;
  }
  // Exact host identity only — never substring matching. Two machines can
  // share a hostname (e.g. two MacBooks both named "Liams-MacBook-Pro" that
  // differ only by tailscale's `-1` suffix), and fuzzy matching attributed
  // one machine's hosted apps to the other's card.
  const machineHosts = [hostIdentity(machine.tailnet), hostIdentity(machine.ip), normalize(machine.id)].filter(Boolean);
  const appHost = hostIdentity(app.machineHost);
  if (appHost) return machineHosts.includes(appHost);
  const appMachine = normalize(app.machineName);
  return Boolean(appMachine) && [normalize(machine.name), ...machineHosts].includes(appMachine);
}

function appMatchScore(searchText: string, app: FleetHostedApp) {
  if (isSelfDashboardApp(app)) return 0;
  if (isMiroSharkApp(app)) {
    if (!miroSharkTaskMatch(searchText)) return 0;
    return 20 + (app.iconUrl ? 5 : 0) + (app.interactive ? 2 : 0);
  }
  const names = [app.name, app.sourceName].map(normalize).filter((value) => value.length >= 4);
  const exactNameMatch = names.some((name) => searchText.includes(name));
  if (!exactNameMatch) return 0;
  return 20 + (app.iconUrl ? 5 : 0) + (app.interactive ? 2 : 0);
}

function isSelfDashboardApp(app: FleetHostedApp) {
  return normalize(app.name) === "hivemindos";
}

function isMiroSharkApp(app: FleetHostedApp) {
  return /miroshark/i.test(`${app.name} ${app.sourceName ?? ""}`);
}

function miroSharkTaskMatch(searchText: string) {
  if (!searchText.includes("miroshark")) return false;
  const looksLikeDashboardMaintenance = /(notification|toast|badge|icon|dashboard|route|ui|bug|fix|debug|code|component|matcher|falsepositive)/.test(searchText);
  if (looksLikeDashboardMaintenance) return false;
  const hasSimulationSurface = /(miroshark|xposts|twitter|reddit|polymarket|predictionmarket|market|simulation|simulator|sim[a-z0-9]{6,})/.test(searchText);
  const hasExecutionIntent = /(run|running|launch|start|execute|monitor|archive|analy[sz]e|rehearsal|swarm|simulate|simulationid|sim[a-z0-9]{6,})/.test(searchText);
  return hasSimulationSurface && hasExecutionIntent;
}

function appBadge(app: FleetHostedApp): FleetActiveApp {
  return {
    id: app.id,
    name: app.name,
    initials: app.initials,
    theme: app.theme,
    iconUrl: app.iconUrl,
    openUrl: app.openUrl,
  };
}

function agentHasFreshActiveTask(agent: FleetMachine["agents"][number]) {
  if (agent.activityStatus !== "active") return false;
  if (!agent.currentTaskUpdatedAt) return false;
  return Date.now() - agent.currentTaskUpdatedAt <= ACTIVE_APP_TASK_FRESH_MS;
}

export function applyActiveAppBadges(machines: FleetMachine[], apps: FleetHostedApp[]) {
  if (apps.length === 0) return machines;
  return machines.map((machine) => ({
    ...machine,
    agents: machine.agents.map((agent) => {
      if (!agentHasFreshActiveTask(agent)) return agent;
      const searchText = normalize([
        agent.task,
      ].join(" "));
      const match = apps
        .filter((app) => app.online !== false)
        .map((app) => {
          const baseScore = appMatchScore(searchText, app);
          return {
            app,
            score: baseScore > 0 ? baseScore + (appMatchesMachine(machine, app) ? 10 : 0) : 0,
          };
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.app.name.localeCompare(right.app.name))[0]?.app;
      return match ? { ...agent, activeApp: appBadge(match) } : agent;
    }),
  }));
}

/** All connected apps & services hosted on a machine, deduped for badge rows
 *  (the dashboard itself is skipped — it runs everywhere and is just noise). */
export function machineConnectedApps(machine: FleetMachine, apps: FleetHostedApp[]): FleetActiveApp[] {
  const seen = new Set<string>();
  return apps
    .filter((app) => app.online !== false && !isSelfDashboardApp(app) && appMatchesMachine(machine, app))
    .map(appBadge)
    .filter((app) => {
      const key = normalize(app.name) || app.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => Number(Boolean(right.iconUrl)) - Number(Boolean(left.iconUrl)) || left.name.localeCompare(right.name));
}

export function activeConnectedAppBadges(machines: FleetMachine[]): FleetActiveAppBadgeSnapshot[] {
  return machines.flatMap((machine) => (
    machine.agents.flatMap((agent) => {
      const app = agent.activeApp;
      if (!app) return [];
      const taskKey = agent.currentTaskId || agent.task || "";
      return [{ key: `${machine.id}:${agent.id}:${app.id}`, app, machineId: machine.id, agentId: agent.id, agentName: agent.name, taskKey }];
    })
  ));
}
