#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compileForVm(relativePath, exposeExpression) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8")
    .replace(/^import[^;]*;/gm, "")
    .replace(/\bexport\s+/g, "")
    + `\n;globalThis.__testedModule = ${exposeExpression};`;
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

let nextId = 0;
const processContext = vm.createContext({
  Date,
  randomUUID: () => `process-${++nextId}`,
});
vm.runInContext(
  compileForVm(
    "../src/lib/services/long-running-processes.ts",
    "{ startLongRunningProcess, updateLongRunningProcess, completeLongRunningProcess, failLongRunningProcess, listLongRunningProcesses }",
  ),
  processContext,
  { filename: "long-running-processes.ts" },
);

const destination = {
  view: "integrations",
  integration: "slack",
  integrationTab: "actions",
  integrationAction: "slack-channel-download",
};
const running = processContext.__testedModule.startLongRunningProcess({
  kind: "slack-channel-download",
  title: "Slack channel download",
  destination,
  progress: { stage: "starting", label: "Starting Slack download" },
});
assert.equal(running.id, "process-1");
assert.equal(running.status, "running");
assert.equal(running.revision, 1);

const progressed = processContext.__testedModule.updateLongRunningProcess(running.id, {
  stage: "linked-content",
  label: "Extracting linked content",
  completed: 3,
  total: 8,
  detail: "Opening Resource Hub",
});
assert.equal(progressed.progress.completed, 3);
assert.equal(progressed.progress.total, 8);
assert.equal(progressed.revision, 2, "every visible update must advance the process revision");

const beforeCompletion = progressed.revision;
const completed = processContext.__testedModule.completeLongRunningProcess(
  running.id,
  "Downloaded 42 Slack messages and 7 linked files.",
);
assert.equal(completed.status, "succeeded");
assert.equal(completed.completionMessage, "Downloaded 42 Slack messages and 7 linked files.");
assert.ok(completed.completedAt);
assert.deepEqual({ ...completed.destination }, destination);

const changed = processContext.__testedModule.listLongRunningProcesses(beforeCompletion);
assert.equal(changed.revision, completed.revision);
assert.deepEqual(Array.from(changed.processes, (process) => process.id), [running.id]);

const failed = processContext.__testedModule.startLongRunningProcess({
  kind: "export",
  title: "Export",
  destination: { view: "files" },
});
processContext.__testedModule.failLongRunningProcess(failed.id, "Disk is full.");
const failedView = processContext.__testedModule.listLongRunningProcesses(failed.revision).processes[0];
assert.equal(failedView.status, "failed");
assert.equal(failedView.error, "Disk is full.");

const navigationContext = vm.createContext({ process: { env: { NODE_ENV: "test" } }, URLSearchParams });
vm.runInContext(
  compileForVm(
    "../src/features/dashboard/dashboard-navigation.ts",
    "{ dashboardTargetFromSearch, dashboardUrlForTarget }",
  ),
  navigationContext,
  { filename: "dashboard-navigation.ts" },
);
const destinationUrl = navigationContext.__testedModule.dashboardUrlForTarget(destination, "/");
assert.equal(
  destinationUrl,
  "/?view=integrations&integration=slack&integrationTab=actions&integrationAction=slack-channel-download",
  "process destinations must serialize the exact integration modal and action",
);
const parsedDestination = navigationContext.__testedModule.dashboardTargetFromSearch(destinationUrl.slice(1));
assert.equal(parsedDestination.view, destination.view);
assert.equal(parsedDestination.integration, destination.integration);
assert.equal(parsedDestination.integrationTab, destination.integrationTab);
assert.equal(
  parsedDestination.integrationAction,
  destination.integrationAction,
  "integration action destinations must survive a URL round trip",
);

const modalActionContext = vm.createContext({});
vm.runInContext(
  compileForVm(
    "../src/features/integrations/integration-modal-actions.ts",
    "{ integrationModalTargetFromDashboardTarget }",
  ),
  modalActionContext,
  { filename: "integration-modal-actions.ts" },
);
assert.deepEqual(
  { ...modalActionContext.__testedModule.integrationModalTargetFromDashboardTarget(destination) },
  { providerKey: "slack", tab: "actions", actionId: "slack-channel-download" },
  "the destination must resolve to the Slack Actions detail view",
);

const notificationContext = vm.createContext({});
vm.runInContext(
  compileForVm(
    "../src/features/dashboard/dashboard-completion-notifications.ts",
    "{ completionNotificationInteraction, processCompletionNotification }",
  ),
  notificationContext,
  { filename: "dashboard-completion-notifications.ts" },
);
const ordinaryInteraction = notificationContext.__testedModule.completionNotificationInteraction({
  id: "ordinary",
  title: "Scheduler",
  message: "Schedule imported.",
});
assert.deepEqual(
  { ...ordinaryInteraction },
  { kind: "copy", text: "Schedule imported." },
  "existing snackbars must retain click-to-copy behavior",
);
const processNotification = notificationContext.__testedModule.processCompletionNotification(completed);
assert.equal(processNotification.message, completed.completionMessage);
assert.deepEqual({ ...processNotification.destination }, destination);
assert.deepEqual(
  JSON.parse(JSON.stringify(notificationContext.__testedModule.completionNotificationInteraction(processNotification))),
  { kind: "navigate", destination },
  "process completion snackbars must navigate instead of copying",
);

const processApiSource = readFileSync(
  new URL("../src/app/api/processes/route.ts", import.meta.url),
  "utf8",
);
assert.match(processApiSource, /afterRevision/, "the process API must expose revision-based incremental reads");
assert.match(processApiSource, /listLongRunningProcesses/, "the process API must read the generic process registry");

const dashboardSource = readFileSync(
  new URL("../src/features/dashboard/DashboardApp.tsx", import.meta.url),
  "utf8",
);
assert.match(
  dashboardSource,
  /useLongRunningProcessNotifications/,
  "the dashboard must feed long-running process completions into its snackbar queue",
);
assert.match(
  dashboardSource,
  /onNavigate={navigateDashboardTarget}/,
  "the snackbar must use the dashboard's typed navigator for process destinations",
);

const connectionsSource = readFileSync(
  new URL("../src/features/integrations/ConnectionsPanel.tsx", import.meta.url),
  "utf8",
);
assert.match(connectionsSource, /DASHBOARD_TARGET_APPLIED_EVENT/, "Integrations must respond when a completion targets its modal");
assert.match(connectionsSource, /initialActionId=/, "the targeted action detail must open directly");

console.log("long-running-process-notifications: registry + snackbar destination + integration deep link OK");
