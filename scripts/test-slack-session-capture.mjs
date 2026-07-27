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

const sharedEnvContext = vm.createContext({
  execFile: () => {},
  join: (...parts) => parts.join("/"),
  process: { cwd: () => "/project", env: {} },
  promisify: () => async () => ({ stdout: "{}" }),
  setTimeout,
  clearTimeout,
  spawn: () => { throw new Error("spawn must not run in the serializer test"); },
});
vm.runInContext(
  compileForVm(
    "../src/lib/services/integrations/shared-env.ts",
    "{ serializeSharedAgentEnvValues }",
  ),
  sharedEnvContext,
  { filename: "shared-env.ts" },
);

const { serializeSharedAgentEnvValues } = sharedEnvContext.__testedModule;
assert.equal(
  serializeSharedAgentEnvValues({
    SLACK_SESSION_TOKEN: "xoxc-test",
    SLACK_SESSION_COOKIE_D: "xoxd-a/b+c=",
    SLACK_SESSION_TEAM_NAME: "Hive \"School\"\nCommunity",
  }),
  "SLACK_SESSION_TOKEN=\"xoxc-test\"\n"
    + "SLACK_SESSION_COOKIE_D=\"xoxd-a/b+c=\"\n"
    + "SLACK_SESSION_TEAM_NAME=\"Hive \\\"School\\\"\\nCommunity\"\n",
  "batch stdin must preserve every credential without putting values in argv",
);
assert.throws(
  () => serializeSharedAgentEnvValues({ "INVALID-KEY": "secret" }),
  /Invalid shared env key/,
  "invalid env keys must fail before spawning the writer",
);

const individualWrites = [];
const batchWrites = [];
const routeContext = vm.createContext({
  errorJson: (error, status) => ({ error, status }),
  okJson: (payload) => ({ payload, status: 200 }),
  requireAuth: async () => null,
  saveSharedAgentEnv: async (key, value) => { individualWrites.push([key, value]); },
  saveSharedAgentEnvValues: async (values) => { batchWrites.push(values); },
});
vm.runInContext(
  compileForVm(
    "../src/app/api/integrations/slack/session/route.ts",
    "{ POST }",
  ),
  routeContext,
  { filename: "slack-session-route.ts" },
);

const routePayload = {
  xoxc: "xoxc-test",
  d: "xoxd-test",
  team_id: "T123",
  team_name: "Hive School",
};
const routeResponse = await routeContext.__testedModule.POST({
  json: async () => routePayload,
});
assert.equal(routeResponse.status, 200);
assert.equal(individualWrites.length, 0, "Slack credentials must not trigger four serial fleet syncs");
assert.deepEqual(
  { ...batchWrites[0] },
  {
    SLACK_SESSION_TOKEN: "xoxc-test",
    SLACK_SESSION_COOKIE_D: "xoxd-test",
    SLACK_SESSION_TEAM_ID: "T123",
    SLACK_SESSION_TEAM_NAME: "Hive School",
  },
  "the route must save every captured Slack field in one batch",
);

const captureUiSource = readFileSync(
  new URL("../src/features/integrations/SlackSessionCapture.tsx", import.meta.url),
  "utf8",
);
const capturedHandlerStart = captureUiSource.indexOf('"slack-session-captured"');
const savingNotePosition = captureUiSource.indexOf(
  'setNote("Slack sign-in complete. Saving session…")',
  capturedHandlerStart,
);
const persistPosition = captureUiSource.indexOf("await persist(event.payload)", capturedHandlerStart);
assert.ok(
  savingNotePosition > capturedHandlerStart && savingNotePosition < persistPosition,
  "the UI must acknowledge native capture before the slower fleet-backed save",
);

const slackApiCalls = [];
const slackServiceContext = vm.createContext({
  AbortSignal,
  URLSearchParams,
  fetch: async (url, init) => {
    slackApiCalls.push({ url: String(url), body: String(init.body) });
    const cursor = new URLSearchParams(String(init.body)).get("cursor");
    return {
      ok: true,
      status: 200,
      json: async () => cursor === "page-2"
        ? {
            ok: true,
            channels: [{ id: "C111", name: "alpha", is_private: false }],
            response_metadata: { next_cursor: "" },
          }
        : {
            ok: true,
            channels: [
              { id: "C222", name: "zeta", is_private: false },
              { id: "C999", name: "free-gtm-resources", is_private: true },
              { id: "", name: "missing-id", is_private: false },
            ],
            response_metadata: { next_cursor: "page-2" },
          },
    };
  },
  homedir: () => "/home/test",
  join: (...parts) => parts.join("/"),
  mkdir: async () => {},
  readSharedAgentEnv: async () => ({}),
  sharedEnvValue: (key) => key === "SLACK_SESSION_TOKEN" ? "xoxc-test" : "xoxd-test",
  writeFile: async () => {},
});
vm.runInContext(
  compileForVm(
    "../src/lib/services/integrations/slack-session.ts",
    "{ listSlackChannels, resolveSlackChannelReference }",
  ),
  slackServiceContext,
  { filename: "slack-session.ts" },
);

const sessionCreds = { token: "xoxc-test", cookie: "xoxd-test" };
const resolvedByName = await slackServiceContext.__testedModule.resolveSlackChannelReference(
  "#free-gtm-resources",
  sessionCreds,
);
assert.deepEqual(
  { ...resolvedByName },
  { id: "C999", name: "free-gtm-resources" },
  "a #channel name must resolve to its internal Slack id",
);
assert.equal(slackApiCalls.length, 1);
assert.match(slackApiCalls[0].url, /\/conversations\.list$/);
assert.match(slackApiCalls[0].body, /types=public_channel%2Cprivate_channel/);

slackApiCalls.length = 0;
const resolvedById = await slackServiceContext.__testedModule.resolveSlackChannelReference(
  "C0A3N6ABD34",
  sessionCreds,
);
assert.deepEqual({ ...resolvedById }, { id: "C0A3N6ABD34" });
assert.equal(slackApiCalls.length, 0, "an internal channel id must not require a list lookup");

const listedChannels = await slackServiceContext.__testedModule.listSlackChannels();
assert.deepEqual(
  Array.from(listedChannels, (channel) => ({ ...channel })),
  [
    { id: "C111", name: "alpha", isPrivate: false },
    { id: "C999", name: "free-gtm-resources", isPrivate: true },
    { id: "C222", name: "zeta", isPrivate: false },
  ],
  "the channel picker must include every visible channel page in alphabetical order",
);
assert.equal(slackApiCalls.length, 2, "channel listing must follow Slack cursor pagination");

const channelsRouteContext = vm.createContext({
  errorJson: (error, status) => ({ error, status }),
  listSlackChannels: async () => listedChannels,
  okJson: (payload) => ({ ...payload, status: 200 }),
  requireAuth: async () => null,
});
vm.runInContext(
  compileForVm(
    "../src/app/api/integrations/slack/session/channels/route.ts",
    "{ GET }",
  ),
  channelsRouteContext,
  { filename: "slack-session-channels-route.ts" },
);
const channelsResponse = await channelsRouteContext.__testedModule.GET({});
assert.equal(channelsResponse.status, 200);
assert.equal(channelsResponse.channels.length, 3);

const downloadedFileUrls = [];
const writtenSlackPaths = [];
const linkedDownloadCalls = [];
const retrievalProgress = [];
const filteredRetrievalContext = vm.createContext({
  AbortSignal,
  URLSearchParams,
  fetch: async (url) => {
    const target = String(url);
    if (target.endsWith("/conversations.list")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          channels: [{ id: "C333", name: "assets", is_private: false }],
          response_metadata: { next_cursor: "" },
        }),
      };
    }
    if (target.endsWith("/conversations.history")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          messages: [{
            ts: "1",
            files: [
              { id: "FIMG", name: "launch.png", mimetype: "image/png", url_private: "https://files.example/launch.png" },
              { id: "FPDF", name: "brief.pdf", mimetype: "application/pdf", url_private: "https://files.example/brief.pdf" },
            ],
          }],
          response_metadata: { next_cursor: "" },
        }),
      };
    }
    downloadedFileUrls.push(target);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  },
  homedir: () => "/home/test",
  join: (...parts) => parts.join("/"),
  mkdir: async () => {},
  readSharedAgentEnv: async () => ({}),
  sharedEnvValue: (key) => key === "SLACK_SESSION_TOKEN" ? "xoxc-test" : "xoxd-test",
  writeFile: async (path) => { writtenSlackPaths.push(path); },
  downloadSlackLinkedContent: async (...args) => {
    linkedDownloadCalls.push(args);
    args[2].onProgress?.({
      stage: "linked-content",
      label: "Extracting linked pages and files",
      completed: 2,
      total: 3,
      detail: "Saved Resource Hub.md",
    });
    return {
      linksFound: 3,
      itemsDiscovered: 12,
      itemsProcessed: 12,
      pagesDownloaded: 2,
      notionPagesDownloaded: 2,
      filesDownloaded: 4,
      ignoredFiles: 1,
      skippedByLimit: 0,
      maxGraphDepth: 5,
      complete: true,
      failed: [],
    };
  },
});
vm.runInContext(
  compileForVm(
    "../src/lib/services/integrations/slack-session.ts",
    "{ retrieveSlackChannel }",
  ),
  filteredRetrievalContext,
  { filename: "slack-session.filtered-retrieval.ts" },
);
const filteredSummary = await filteredRetrievalContext.__testedModule.retrieveSlackChannel(
  "#assets",
  undefined,
  { ignoreFileTypes: ["image"], onProgress: (progress) => retrievalProgress.push(progress) },
);
assert.equal(filteredSummary.files, 2);
assert.equal(filteredSummary.ignoredFiles, 1, "image attachments must be counted as intentionally skipped");
assert.equal(filteredSummary.downloaded, 1);
assert.deepEqual(downloadedFileUrls, ["https://files.example/brief.pdf"], "ignored images must never be fetched");
assert.ok(writtenSlackPaths.some((path) => path.endsWith("/files/FPDF-brief.pdf")));
assert.ok(!writtenSlackPaths.some((path) => path.includes("launch.png")));
assert.ok(
  retrievalProgress.some((progress) => progress.stage === "slack-history" && progress.completed === 1),
  "history pagination must publish the number of messages retrieved so far",
);
assert.ok(
  retrievalProgress.some((progress) => progress.stage === "slack-files" && progress.completed === 1 && progress.total === 1),
  "Slack attachment downloads must publish determinate file progress",
);

const deepSummary = await filteredRetrievalContext.__testedModule.retrieveSlackChannel(
  "#assets",
  undefined,
  { ignoreFileTypes: ["image"], deepDownload: true, onProgress: (progress) => retrievalProgress.push(progress) },
);
assert.equal(linkedDownloadCalls.length, 1, "deep downloads must pass the full Slack message set to the linked-content crawler");
assert.equal(linkedDownloadCalls[0][1], "/home/test/Downloads/hivemindos-slack/assets");
assert.deepEqual(
  Array.from(linkedDownloadCalls[0][2].ignoreFileTypes),
  ["image"],
  "linked assets must honor the same image filter as Slack attachments",
);
assert.equal(deepSummary.linkedPages, 2);
assert.equal(deepSummary.linkedNotionPages, 2);
assert.equal(deepSummary.linkedFiles, 4);
assert.equal(deepSummary.linkedIgnoredFiles, 1);
assert.equal(deepSummary.linkedItemsDiscovered, 12);
assert.equal(deepSummary.linkedItemsProcessed, 12);
assert.equal(deepSummary.linkedMaxGraphDepth, 5);
assert.equal(deepSummary.linkedComplete, true);
assert.ok(
  retrievalProgress.some((progress) => progress.stage === "linked-content" && progress.detail === "Saved Resource Hub.md"),
  "linked-content extraction progress must flow through the Slack retrieval callback",
);

let resolvePendingRetrieval;
const pendingRetrieval = new Promise((resolve) => { resolvePendingRetrieval = resolve; });
const retrievalExecutions = [];
const startedProcesses = [];
const updatedProcesses = [];
const completedProcesses = [];
const failedProcesses = [];
let generatedJobId = 0;
const retrievalJobContext = vm.createContext({
  randomUUID: () => `job-${++generatedJobId}`,
  retrieveSlackChannel: async () => { throw new Error("the injected runner must be used in this test"); },
  startLongRunningProcess: (input) => { startedProcesses.push(input); return input; },
  updateLongRunningProcess: (id, progress) => { updatedProcesses.push({ id, progress }); },
  completeLongRunningProcess: (id, message) => { completedProcesses.push({ id, message }); },
  failLongRunningProcess: (id, error) => { failedProcesses.push({ id, error }); },
});
vm.runInContext(
  compileForVm(
    "../src/lib/services/integrations/slack-retrieval-job.ts",
    "{ startSlackRetrievalJob, getSlackRetrievalJob, slackRetrievalJobView }",
  ),
  retrievalJobContext,
  { filename: "slack-retrieval-job.ts" },
);
const jobInput = {
  channel: "#assets",
  saveDir: undefined,
  options: { ignoreFileTypes: ["image"], deepDownload: true },
};
const pendingJob = retrievalJobContext.__testedModule.startSlackRetrievalJob(
  jobInput,
  (...args) => {
    retrievalExecutions.push(args);
    args[2].onProgress?.({
      stage: "linked-content",
      label: "Extracting linked content",
      completed: 4,
      total: 9,
      detail: "Opening a public Notion page",
    });
    return pendingRetrieval;
  },
);
assert.equal(pendingJob.status, "running", "the POST-facing job start must return before retrieval finishes");
assert.equal(retrievalExecutions.length, 1);
assert.equal(startedProcesses.length, 1, "Slack downloads must register with the generic process system");
assert.deepEqual(
  { ...pendingJob.progress },
  {
    stage: "linked-content",
    label: "Extracting linked content",
    completed: 4,
    total: 9,
    detail: "Opening a public Notion page",
  },
  "the pollable Slack job must expose its latest extraction progress",
);
assert.equal(updatedProcesses.at(-1).id, pendingJob.id);
const duplicateJob = retrievalJobContext.__testedModule.startSlackRetrievalJob(
  jobInput,
  () => { throw new Error("an identical running request must not start twice"); },
);
assert.equal(duplicateJob.id, pendingJob.id, "retries must attach to the existing channel retrieval job");
resolvePendingRetrieval({
  saveDir: "/tmp/slack",
  messages: 1,
  files: 2,
  ignoredFiles: 1,
  downloaded: 1,
  failedFiles: [],
  linkedLinksFound: 3,
  linkedItemsDiscovered: 8,
  linkedItemsProcessed: 8,
  linkedPages: 2,
  linkedNotionPages: 2,
  linkedFiles: 4,
  linkedIgnoredFiles: 1,
  linkedSkippedByLimit: 0,
  linkedMaxGraphDepth: 3,
  linkedComplete: true,
  linkedFailures: [],
});
await new Promise((resolve) => setTimeout(resolve, 0));
const finishedJob = retrievalJobContext.__testedModule.getSlackRetrievalJob(pendingJob.id);
assert.equal(finishedJob.status, "succeeded");
assert.equal(finishedJob.result.linkedPages, 2);
assert.equal(retrievalJobContext.__testedModule.slackRetrievalJobView(finishedJob).result.linkedFiles, 4);
assert.equal(completedProcesses.length, 1, "successful Slack jobs must publish one process completion");
assert.equal(completedProcesses[0].id, pendingJob.id);
assert.match(completedProcesses[0].message, /1 message/);
assert.match(completedProcesses[0].message, /All 8 discovered linked items completed/);
assert.equal(failedProcesses.length, 0);

const jobStarts = [];
const routeJobs = new Map();
const retrieveRouteContext = vm.createContext({
  URL,
  errorJson: (error, status) => ({ error, status }),
  okJson: (payload) => ({ ...payload, status: 200 }),
  requireAuth: async () => null,
  startSlackRetrievalJob: (input) => {
    jobStarts.push(input);
    const job = { id: "job-route", status: "running", result: null, error: null };
    routeJobs.set(job.id, job);
    return job;
  },
  getSlackRetrievalJob: (jobId) => routeJobs.get(jobId) || null,
  slackRetrievalJobView: (job) => ({ ...job }),
  slackSessionAuthTest: async () => ({ ok: true }),
});
vm.runInContext(
  compileForVm(
    "../src/app/api/integrations/slack/session/retrieve/route.ts",
    "{ GET, POST }",
  ),
  retrieveRouteContext,
  { filename: "slack-session-retrieve-route.ts" },
);
const filteredRouteResponse = await retrieveRouteContext.__testedModule.POST({
  json: async () => ({ channel: "#assets", ignoreFileTypes: ["image"], deepDownload: true }),
});
assert.equal(filteredRouteResponse.status, 200);
assert.equal(filteredRouteResponse.jobId, "job-route", "the route must return a pollable job immediately");
assert.deepEqual(
  {
    ignoreFileTypes: Array.from(jobStarts[0].options.ignoreFileTypes),
    deepDownload: jobStarts[0].options.deepDownload,
  },
  { ignoreFileTypes: ["image"], deepDownload: true },
  "the retrieval route must forward both deep-download intent and selected file filters",
);
const polledRouteResponse = await retrieveRouteContext.__testedModule.GET({
  url: "http://localhost/api/integrations/slack/session/retrieve?jobId=job-route",
});
assert.equal(polledRouteResponse.status, 200);
assert.equal(polledRouteResponse.job.id, "job-route", "GET with a job id must return current retrieval status");
const unsupportedFilterResponse = await retrieveRouteContext.__testedModule.POST({
  json: async () => ({ channel: "#assets", ignoreFileTypes: ["executable"] }),
});
assert.equal(unsupportedFilterResponse.status, 400, "unknown file filters must fail at the API boundary");
assert.match(unsupportedFilterResponse.error, /Supported values: image/);

assert.doesNotMatch(captureUiSource, /Workspace URL/, "workspace selection belongs in Slack, not a text field");
assert.doesNotMatch(captureUiSource, /workspaceUrl/, "the UI must not send an optional workspace URL");
assert.match(captureUiSource, /Channel[\s\S]*<select/, "visible channels must render in a dropdown");
assert.match(
  captureUiSource,
  /\/api\/integrations\/slack\/session\/channels/,
  "the dropdown must load channels from the server-side Slack session",
);
assert.match(captureUiSource, /Ignore images/, "the download UI must expose an image filter");
assert.match(captureUiSource, /Deep download linked pages/, "the download UI must expose linked-page crawling");
assert.match(captureUiSource, /useState\(true\)/, "deep download must be enabled by default for channel archives");
assert.match(
  captureUiSource,
  /deepDownload,\s*ignoreFileTypes:/,
  "the selected deep-download mode must be sent with the retrieval request",
);
assert.match(
  captureUiSource,
  /ignoreFileTypes:\s*ignoreImages\s*\?\s*\["image"\]\s*:\s*\[\]/,
  "the selected image filter must be sent with this download only",
);
assert.match(captureUiSource, /ignoredFiles/, "the completion note must report intentionally skipped files");
assert.match(captureUiSource, /jobId/, "the UI must retain the detached retrieval job id");
assert.match(captureUiSource, /pollRetrievalJob/, "the UI must poll rather than hold one long request open");
assert.match(captureUiSource, /job\.progress/, "polling must render the job's latest structured progress");
assert.match(captureUiSource, /role="progressbar"/, "live extraction updates need an accessible progress bar");
assert.match(
  captureUiSource,
  /retrieve\?jobId=/,
  "job polling must use short GET requests that fit within the dev proxy timeout",
);

const modalActionContext = vm.createContext({});
vm.runInContext(
  compileForVm(
    "../src/features/integrations/integration-modal-actions.ts",
    "{ integrationModalActionsForProvider }",
  ),
  modalActionContext,
  { filename: "integration-modal-actions.ts" },
);
const slackModalActions = modalActionContext.__testedModule.integrationModalActionsForProvider("slack");
assert.deepEqual(
  Array.from(slackModalActions, (action) => ({ ...action })),
  [{
    id: "slack-channel-download",
    label: "Download a channel",
    description: "Save message history, attachments, linked pages, and linked files from a Slack workspace.",
    icon: "sync",
  }],
  "Slack's existing interactive workflow must appear as an action card",
);
assert.deepEqual(
  Array.from(modalActionContext.__testedModule.integrationModalActionsForProvider("github")),
  [],
  "providers without interactive modal actions must return an empty action grid",
);

const connectionsPanelSource = readFileSync(
  new URL("../src/features/integrations/ConnectionsPanel.tsx", import.meta.url),
  "utf8",
);
assert.match(connectionsPanelSource, /className="fb-seg fm-modal-tabs"/, "the modal must reuse the top-level segmented control style");
assert.match(connectionsPanelSource, />Connect</, "the modal segmented control must include Connect");
assert.match(connectionsPanelSource, />Actions</, "the modal segmented control must include Actions");
assert.match(connectionsPanelSource, /<IntegrationModalActions/, "the Actions segment must render the action browser");
assert.doesNotMatch(
  connectionsPanelSource,
  /<SlackSessionCapture/,
  "Slack retrieval must move out of the Connect view and into an action detail",
);
assert.match(
  connectionsPanelSource,
  /modalTab === "connect"[\s\S]*className="fm-mfoot"/,
  "connection-only footer controls must stay out of the Actions view",
);

const modalActionUiSource = readFileSync(
  new URL("../src/features/integrations/IntegrationModalActions.tsx", import.meta.url),
  "utf8",
);
assert.match(modalActionUiSource, /className="[^"]*fm-action-grid/, "Actions must start on a card grid");
assert.match(
  modalActionUiSource,
  /className="fm-grid fm-action-grid"/,
  "action grids must reuse the already-loaded integration grid primitive",
);
assert.match(
  modalActionUiSource,
  /className="fm-card fm-action-card"/,
  "action cards must reuse the already-loaded integration card primitive",
);
assert.match(modalActionUiSource, /setSelectedAction\(action\.id\)/, "pressing a card must open its focused action view");
assert.match(modalActionUiSource, /Back to actions/, "focused action views need a back button");
assert.match(modalActionUiSource, /<SlackSessionCapture actionView/, "the Slack card must open the channel download workflow");

const integrationsCssSource = readFileSync(
  new URL("../src/features/integrations/integrations-redesign.css", import.meta.url),
  "utf8",
);
assert.match(integrationsCssSource, /\.fm-action-grid\s*\{/, "the modal action grid needs dedicated responsive styling");
assert.match(integrationsCssSource, /\.fm-action-card\s*\{/, "action cards need a dedicated interactive card style");
assert.match(captureUiSource, /actionView/, "Slack retrieval must support the focused action layout");

console.log("slack-session-capture: capture + persistence + modal action navigation OK");
