const COMMANDS = {
  unix: "git clone https://github.com/LiamVisionary/hivemindos.git && cd hivemindos && ./setup.sh --collector-only",
  windows: "git clone https://github.com/LiamVisionary/hivemindos.git; cd hivemindos; powershell -ExecutionPolicy Bypass -File .\\setup.ps1 -CollectorOnly",
};

const views = ["welcome", "progress", "approval", "done", "error"];
const state = {
  running: false,
  processDone: false,
  poll: null,
  lines: [],
  advancedPlatform: /Win/i.test(navigator.platform) ? "windows" : "unix",
};

const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const listen = tauri?.event?.listen;

function element(id) {
  return document.getElementById(id);
}

function showView(name) {
  for (const view of views) element(`${view}-view`).hidden = view !== name;
}

function collectorReady(status) {
  return Boolean(status?.checks?.find((check) => check.id === "collector")?.installed);
}

function linkStatus(status) {
  return status?.link_status ?? {};
}

function phaseFromLines(lines) {
  const text = lines.join("\n");
  if (/Hivemind Link authorization|authorization URL|authUrl/i.test(text)) return { step: 3, title: "Preparing device approval…" };
  if (/Starting Hivemind Link|Hivemind Link control URL|Building and installing.*Link/i.test(text)) return { step: 3, title: "Starting the private Link…" };
  if (/Installing local telemetry collector|collector dependency|agent bridge/i.test(text)) return { step: 2, title: "Installing the agent bridge…" };
  if (/Node found|Downloading Node|collector runtime|PowerShell 7/i.test(text)) return { step: 1, title: "Preparing the collector runtime…" };
  return { step: 0, title: "Preparing setup…" };
}

function renderProgress() {
  const phase = phaseFromLines(state.lines);
  element("progress-title").textContent = phase.title;
  element("meter-fill").style.width = `${18 + phase.step * 23}%`;
  const steps = [...element("plain-steps").querySelectorAll("li")];
  steps.forEach((item, index) => item.dataset.state = index < phase.step ? "done" : index === phase.step ? "active" : "idle");
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function renderAdvancedPlatform() {
  element("advanced-command").textContent = COMMANDS[state.advancedPlatform];
  document.querySelectorAll("[data-platform]").forEach((button) => {
    button.dataset.active = String(button.dataset.platform === state.advancedPlatform);
  });
}

async function closeApp() {
  try {
    await tauri?.window?.getCurrentWindow()?.close();
  } catch {
    window.close();
  }
}

async function refreshStatus() {
  if (!invoke) return;
  try {
    const status = await invoke("native_setup_status");
    const link = linkStatus(status);
    if (collectorReady(status) && link.connected) {
      state.running = false;
      window.clearInterval(state.poll);
      element("connected-name").textContent = link.device_name || "This collector";
      showView("done");
      return;
    }
    if (link.auth_url) {
      element("approval-url").textContent = link.auth_url;
      element("approval-url").dataset.value = link.auth_url;
      showView("approval");
      return;
    }
    if (state.running) {
      showView("progress");
      renderProgress();
      return;
    }
    if (collectorReady(status) || link.running) {
      element("progress-title").textContent = "Waiting for the private Link…";
      element("progress-copy").textContent = "The collector is installed. HivemindOS Link is still preparing its one-time approval.";
      element("meter-fill").style.width = "92%";
      showView("progress");
    }
  } catch (error) {
    if (state.running) {
      element("error-copy").textContent = `Could not read setup status: ${String(error)}`;
      showView("error");
    }
  }
}

async function startSetup() {
  if (!invoke) {
    element("error-copy").textContent = "This guided setup must be opened from the installed HivemindOS Link app.";
    showView("error");
    return;
  }
  state.running = true;
  state.processDone = false;
  state.lines = [];
  element("link-device").disabled = true;
  element("progress-copy").textContent = "HivemindOS Link is working in the background. Approve any operating-system prompt that appears.";
  showView("progress");
  renderProgress();
  try {
    await invoke("native_setup_run", {
      request: {
        installMode: "collector",
        skillAgents: [],
        memoryAgents: [],
        importSkills: false,
        importMemory: false,
        startDashboard: false,
        installCollector: true,
        buildDashboard: false,
        installDeps: false,
        force: false,
      },
    });
    window.clearInterval(state.poll);
    state.poll = window.setInterval(refreshStatus, 1800);
    await refreshStatus();
  } catch (error) {
    state.running = false;
    element("error-copy").textContent = `Setup could not start: ${String(error)}`;
    showView("error");
  }
}

element("link-device").addEventListener("click", startSetup);
element("retry").addEventListener("click", startSetup);
element("finish").addEventListener("click", closeApp);
element("copy-approval").addEventListener("click", async () => {
  const copied = await copyText(element("approval-url").dataset.value || "");
  element("copy-state").textContent = copied ? "Copied — open it on your main hub." : "Could not copy automatically. Select the link above.";
});
element("copy-command").addEventListener("click", async () => {
  const copied = await copyText(COMMANDS[state.advancedPlatform]);
  element("copy-command").textContent = copied ? "Copied" : "Copy manually";
  window.setTimeout(() => { element("copy-command").textContent = "Copy command"; }, 1800);
});
document.querySelectorAll("[data-platform]").forEach((button) => button.addEventListener("click", () => {
  state.advancedPlatform = button.dataset.platform;
  renderAdvancedPlatform();
}));

renderAdvancedPlatform();

if (listen) {
  listen("native-setup-progress", (event) => {
    const payload = event.payload || {};
    if (payload.kind === "start") {
      state.lines = [];
      state.running = true;
      renderProgress();
    }
    if (payload.kind === "line" && typeof payload.line === "string") {
      state.lines = [...state.lines.slice(-119), payload.line];
      renderProgress();
    }
    if (payload.kind === "done") {
      state.processDone = true;
      if (payload.exitCode != null && payload.exitCode !== 0) {
        state.running = false;
        element("error-copy").textContent = `Setup stopped with code ${payload.exitCode}. Nothing was exposed publicly; retry or use Advanced setup.`;
        showView("error");
      } else {
        refreshStatus();
      }
    }
  });
}

refreshStatus();
