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
  agentName: string;
};

const ACTIVE_APP_TASK_FRESH_MS = 30 * 60 * 1000;

function normalize(value?: string | number | null) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function appMatchesMachine(machine: FleetMachine, app: FleetHostedApp) {
  const appMachine = normalize(app.machineName);
  const appHost = normalize(app.machineHost);
  const machineNames = [machine.name, machine.id, machine.tailnet, machine.ip].map(normalize).filter(Boolean);
  if (app.local && (machine.role === "Primary" || /this(?:mac|machine)/i.test(machine.name) || machine.ip === "127.0.0.1")) {
    return true;
  }
  return machineNames.some((name) => (
    name === appMachine
    || name === appHost
    || (name.length >= 5 && appMachine.includes(name))
    || (appMachine.length >= 5 && name.includes(appMachine))
  ));
}

function appMatchScore(searchText: string, app: FleetHostedApp) {
  const names = [app.name, app.sourceName].map(normalize).filter((value) => value.length >= 4);
  const exactNameMatch = names.some((name) => searchText.includes(name));
  if (!exactNameMatch && !miroSharkTaskMatch(searchText, app)) return 0;
  return 20 + (app.iconUrl ? 5 : 0) + (app.interactive ? 2 : 0);
}

function miroSharkTaskMatch(searchText: string, app: FleetHostedApp) {
  if (!/miroshark/i.test(app.name)) return false;
  const hasSimulationSurface = /(xposts|twitter|reddit|polymarket|market|simulation)/.test(searchText);
  const hasMiroSharkWorkflow = /(swarm|simulation|rehearsal)/.test(searchText);
  return hasSimulationSurface && hasMiroSharkWorkflow;
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

export function activeConnectedAppBadges(machines: FleetMachine[]): FleetActiveAppBadgeSnapshot[] {
  return machines.flatMap((machine) => (
    machine.agents.flatMap((agent) => {
      const app = agent.activeApp;
      if (!app) return [];
      return [{ key: `${machine.id}:${agent.id}:${app.id}`, app, agentName: agent.name }];
    })
  ));
}
