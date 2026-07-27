import { browserContextReceipt, buildBrowserContextText, isRestrictedUrl } from "./lib/context.mjs";
import { commandForInput, QUICK_COMMANDS } from "./lib/commands.mjs";
import { createSseParser, runtimeEventText } from "./lib/sse.mjs";

const STORAGE_KEY = "hivemindosBrowserSettings";
const DEFAULT_SETTINGS = Object.freeze({
  dashboardUrl: "http://127.0.0.1:5020",
  token: "",
  agentId: "",
  contextMode: "page",
  agentMode: "ask",
  sessionId: "",
});

const elements = Object.fromEntries([
  "settings-toggle", "settings-panel", "connection-badge", "dashboard-url", "dashboard-token", "save-settings",
  "cancel-settings", "settings-error", "agent-select", "context-mode", "agent-mode", "context-title", "context-detail",
  "refresh-context", "messages", "activity-strip", "activity-label", "quick-commands", "composer-input", "send-button", "new-session",
].map((id) => [id.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()), document.getElementById(id)]));

let settings = { ...DEFAULT_SETTINGS };
let agents = [];
let history = [];
let currentContext = { activeTab: null, tabs: [], pageContext: {}, contextText: "" };
let pending = false;

function normalizeDashboardUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Enter the HivemindOS dashboard URL.");
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Dashboard URL must use http:// or https://.");
  return parsed.toString().replace(/\/+$/, "");
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] || {}) };
  elements.dashboardUrl.value = settings.dashboardUrl;
  elements.dashboardToken.value = settings.token;
  elements.contextMode.value = settings.contextMode;
  elements.agentMode.value = settings.agentMode;
}

async function saveSettings(next = {}) {
  settings = { ...settings, ...next };
  // Connection configuration is extension-local by necessity and never synced.
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

function setSettingsOpen(open) {
  elements.settingsPanel.hidden = !open;
  elements.settingsToggle.setAttribute("aria-expanded", String(open));
}

function setConnection(connected, label) {
  elements.connectionBadge.classList.toggle("connected", connected);
  elements.connectionBadge.querySelector("span:last-child").textContent = label;
}

function showSettingsError(message = "") {
  elements.settingsError.textContent = message;
  elements.settingsError.hidden = !message;
}

function authHeaders() {
  return { Authorization: `Bearer ${settings.token}`, "Content-Type": "application/json" };
}

async function apiRequest(init = {}) {
  const response = await fetch(`${normalizeDashboardUrl(settings.dashboardUrl)}/api/browser-extension`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `HivemindOS returned HTTP ${response.status}.`);
  }
  return response;
}

function populateAgents() {
  elements.agentSelect.replaceChildren();
  if (!agents.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No configured agents";
    elements.agentSelect.append(option);
    return;
  }
  for (const agent of agents) {
    const option = document.createElement("option");
    option.value = agent.id;
    option.textContent = `${agent.name} · ${agent.runtime}`;
    elements.agentSelect.append(option);
  }
  const selected = agents.some((agent) => agent.id === settings.agentId) ? settings.agentId : agents[0].id;
  elements.agentSelect.value = selected;
  void saveSettings({ agentId: selected });
}

async function connect() {
  if (!settings.token) throw new Error("Paste the dashboard unlock token to connect.");
  setConnection(false, "Connecting");
  const response = await apiRequest();
  const payload = await response.json();
  agents = Array.isArray(payload.agents) ? payload.agents : [];
  populateAgents();
  setConnection(true, agents.length ? `${agents.length} agent${agents.length === 1 ? "" : "s"}` : "Connected");
}

function activeTabFromQuery(tabs) {
  const pinnedId = Number(new URLSearchParams(location.search).get("tab"));
  return tabs.find((tab) => tab.id === pinnedId) || tabs.find((tab) => tab.active) || tabs[0] || null;
}

async function pageContext(tab) {
  if (!tab?.id || isRestrictedUrl(tab.url || "")) return {};
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "HIVEMIND_GET_PAGE_CONTEXT", options: { depth: "normal" } });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      return await chrome.tabs.sendMessage(tab.id, { type: "HIVEMIND_GET_PAGE_CONTEXT", options: { depth: "normal" } });
    } catch {
      return {};
    }
  }
}

async function refreshContext() {
  elements.contextTitle.textContent = "Reading active page";
  elements.contextDetail.textContent = "Collecting safe page context…";
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const activeTab = activeTabFromQuery(tabs);
  const context = settings.contextMode === "chat" ? {} : await pageContext(activeTab);
  const contextText = buildBrowserContextText({ activeTab, tabs, pageContext: context, mode: settings.contextMode });
  currentContext = { activeTab, tabs, pageContext: context, contextText };
  const receipt = browserContextReceipt({ activeTab, pageContext: context, mode: settings.contextMode, contextText });
  elements.contextTitle.textContent = receipt.restricted ? "Sensitive page omitted" : receipt.title || "No readable page";
  elements.contextDetail.textContent = settings.contextMode === "chat"
    ? "Chat only · no page data attached"
    : receipt.restricted
      ? "Privacy guard switched this turn to chat only"
      : `${settings.contextMode === "selection" ? "Selection first" : "Active page"} · ${receipt.chars.toLocaleString()} context chars`;
}

function appendMessage(role, content, { error = false } = {}) {
  elements.messages.querySelector(".welcome-card")?.remove();
  const article = document.createElement("article");
  article.className = `message ${role}${error ? " error" : ""}`;
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = content;
  article.append(bubble);
  elements.messages.append(article);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  return bubble;
}

function setPending(value, label = "Agent is working") {
  pending = value;
  elements.activityStrip.hidden = !value;
  elements.activityLabel.textContent = label;
  elements.sendButton.disabled = value;
  elements.agentSelect.disabled = value;
}

function resizeComposer() {
  elements.composerInput.style.height = "auto";
  elements.composerInput.style.height = `${Math.min(elements.composerInput.scrollHeight, 132)}px`;
}

function newSessionId() {
  return `browser-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function sendMessage(textOverride = "") {
  if (pending) return;
  const raw = String(textOverride || elements.composerInput.value).trim();
  if (!raw) return;
  const command = commandForInput(raw);
  const prompt = command?.prompt || raw;
  if (!settings.agentId) {
    setSettingsOpen(true);
    showSettingsError("Connect and choose an agent before sending.");
    return;
  }

  elements.composerInput.value = "";
  resizeComposer();
  appendMessage("user", raw);
  setPending(true, "Reading browser context");
  try {
    await refreshContext();
    setPending(true, "Agent is working");
    const response = await apiRequest({
      method: "POST",
      body: JSON.stringify({
        agentId: settings.agentId,
        prompt,
        contextText: currentContext.contextText,
        history: history.slice(-12),
        sessionId: settings.sessionId || newSessionId(),
        clientRunId: `browser-turn-${Date.now().toString(36)}`,
        agentMode: settings.agentMode,
      }),
    });
    let assistantText = "";
    let assistantBubble = null;
    let runtimeSessionId = settings.sessionId;
    const parser = createSseParser((payload) => {
      if (payload === "[DONE]") return;
      const parsed = JSON.parse(payload);
      if (parsed.session?.id) runtimeSessionId = parsed.session.id;
      if (parsed.type === "chat.tool.start" || parsed.event?.type === "chat.tool.start") {
        setPending(true, parsed.message || parsed.event?.message || "Using a tool");
      }
      const delta = runtimeEventText(payload);
      if (!delta) return;
      assistantText += delta;
      assistantBubble ||= appendMessage("assistant", "");
      assistantBubble.textContent = assistantText;
      elements.messages.scrollTop = elements.messages.scrollHeight;
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.flush();
    if (!assistantText) assistantText = "The agent completed the turn without a text response.";
    if (!assistantBubble) appendMessage("assistant", assistantText);
    history = [...history, { role: "user", content: prompt }, { role: "assistant", content: assistantText }].slice(-20);
    if (runtimeSessionId && runtimeSessionId !== settings.sessionId) await saveSettings({ sessionId: runtimeSessionId });
  } catch (error) {
    appendMessage("assistant", error instanceof Error ? error.message : String(error), { error: true });
  } finally {
    setPending(false);
  }
}

function renderQuickCommands() {
  for (const command of QUICK_COMMANDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-chip";
    button.textContent = command.label;
    button.addEventListener("click", () => sendMessage(`/${command.name}`));
    elements.quickCommands.append(button);
  }
}

elements.settingsToggle.addEventListener("click", () => setSettingsOpen(elements.settingsPanel.hidden));
elements.cancelSettings.addEventListener("click", () => setSettingsOpen(false));
elements.saveSettings.addEventListener("click", async () => {
  showSettingsError();
  elements.saveSettings.disabled = true;
  elements.saveSettings.querySelector(".button-label").textContent = "Connecting…";
  try {
    await saveSettings({ dashboardUrl: normalizeDashboardUrl(elements.dashboardUrl.value), token: elements.dashboardToken.value.trim() });
    await connect();
    setSettingsOpen(false);
  } catch (error) {
    showSettingsError(error instanceof Error ? error.message : String(error));
    setConnection(false, "Not connected");
  } finally {
    elements.saveSettings.disabled = false;
    elements.saveSettings.querySelector(".button-label").textContent = "Save & connect";
  }
});
elements.agentSelect.addEventListener("change", () => saveSettings({ agentId: elements.agentSelect.value, sessionId: "" }));
elements.contextMode.addEventListener("change", async () => { await saveSettings({ contextMode: elements.contextMode.value }); await refreshContext(); });
elements.agentMode.addEventListener("change", () => saveSettings({ agentMode: elements.agentMode.value }));
elements.refreshContext.addEventListener("click", refreshContext);
elements.sendButton.addEventListener("click", () => sendMessage());
elements.composerInput.addEventListener("input", resizeComposer);
elements.composerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void sendMessage();
  }
});
elements.newSession.addEventListener("click", async () => {
  history = [];
  await saveSettings({ sessionId: "" });
  elements.messages.replaceChildren();
  appendMessage("assistant", "New browser session started. Page context will be refreshed on your next message.");
});

await loadSettings();
renderQuickCommands();
await refreshContext();
if (settings.token) {
  try {
    await connect();
  } catch (error) {
    setConnection(false, "Reconnect needed");
    showSettingsError(error instanceof Error ? error.message : String(error));
    setSettingsOpen(true);
  }
} else {
  setSettingsOpen(true);
}
