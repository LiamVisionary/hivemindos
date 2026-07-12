// Self-POSTs to our own /api routes 401 without the server's device token
// since the API auth gate moved to src/proxy.ts. Mirrors
// internalApiAuthHeaders() from @/lib/utils/internal-api-auth, inlined here
// because instrumentation.ts must not import app modules (see the bundling
// note below). The gate verifies against this same process-env value.
function selfApiAuthHeaders(): Record<string, string> {
  const token = process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN?.trim() ?? "";
  return token ? { "x-hivemindos-device-token": token } : {};
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  // Node's happy-eyeballs connector gives each address attempt only 250ms
  // by default. On high-latency networks that's shorter than a plain TCP
  // handshake to many hosts, so every outbound fetch (Base RPC, Blockscout,
  // price feeds) dies with ETIMEDOUT while curl to the same URL works.
  // Verified 2026-06-11: mainnet.base.org failed from Node and succeeded
  // with this raised; wallet balance reads 500'd because of it.
  // getBuiltinModule (not `import "node:net"`): the webpack dev server
  // can't bundle node: imports from instrumentation.ts (UnhandledSchemeError
  // → every route 500s).
  const net = (process as unknown as {
    getBuiltinModule?: (
      id: string
    ) => { setDefaultAutoSelectFamilyAttemptTimeout?: (ms: number) => void } | undefined;
  }).getBuiltinModule?.("node:net");
  net?.setDefaultAutoSelectFamilyAttemptTimeout?.(2_500);

  // Auto-start the Telegram tip bot when the flag is set in process env or
  // the shared hive env. IMPORTANT: no app-module imports here — anything
  // reachable from instrumentation.ts gets bundled by the webpack dev server,
  // and node:-scheme imports in that graph (e.g. shared-hive-env.ts) raise
  // UnhandledSchemeError and kill boot. So: read the env file via
  // getBuiltinModule, and start the bot by POSTing to our own API route,
  // which compiles in the normal route context where those imports are fine.
  void (async () => {
    try {
      const builtin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
      const fs = builtin?.("node:fs") as { readFileSync?: (path: string, enc: string) => string } | undefined;
      const os = builtin?.("node:os") as { homedir?: () => string } | undefined;
      const envFile = (() => {
        try {
          return fs?.readFileSync?.(`${os?.homedir?.() ?? ""}/.hivemindos/.env`, "utf8") ?? "";
        } catch {
          return "";
        }
      })();
      const flagNames = ["TELEGRAM_TIP_BOT_AUTOSTART", "HIVEMINDOS_TELEGRAM_TIP_BOT_AUTOSTART", "HIVEMINDOS_TIP_BOT_AUTOSTART"];
      const flagOn = flagNames.some((name) => {
        const fromProcess = process.env[name]?.trim();
        const fromFile = envFile.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.+)\\s*$`, "m"))?.[1]?.trim();
        const value = (fromProcess || fromFile || "").replace(/^["']|["']$/g, "").toLowerCase();
        return value === "1" || value === "true";
      });
      if (!flagOn) return;
      const port = process.env.PORT?.trim();
      if (!port) return;
      // Give the HTTP listener a moment, then retry a few times.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        const started = await fetch(`http://127.0.0.1:${port}/api/telegram-tip-bot`, {
          method: "POST",
          headers: { "content-type": "application/json", ...selfApiAuthHeaders() },
          body: JSON.stringify({ action: "start" }),
        })
          .then((response) => response.ok)
          .catch(() => false);
        if (started) {
          console.log("[telegram-tip-bot] auto-started");
          return;
        }
      }
      console.error("[telegram-tip-bot] autostart gave up after 5 attempts");
    } catch (error) {
      console.error("[telegram-tip-bot] autostart failed:", error instanceof Error ? error.message : error);
    }
  })();

  // Auto-start the perpetual company-autonomy driver so launched "zero human
  // companies" keep working toward their apex goal across restarts. Same
  // no-app-imports constraint as above: read the disable flag via getBuiltinModule
  // and start the driver by POSTing to our own API route. The driver is a no-op
  // unless a company has been explicitly launched (autonomy=true) and is not
  // frozen; spend stays bounded by company budgets. Disable with
  // HIVEMINDOS_COMPANY_AUTONOMY_DRIVER=0.
  void (async () => {
    try {
      const builtin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
      const fs = builtin?.("node:fs") as { readFileSync?: (path: string, enc: string) => string } | undefined;
      const os = builtin?.("node:os") as { homedir?: () => string } | undefined;
      const envFile = (() => {
        try {
          return fs?.readFileSync?.(`${os?.homedir?.() ?? ""}/.hivemindos/.env`, "utf8") ?? "";
        } catch {
          return "";
        }
      })();
      const flag = "HIVEMINDOS_COMPANY_AUTONOMY_DRIVER";
      const fromProcess = process.env[flag]?.trim();
      const fromFile = envFile.match(new RegExp(`^\\s*(?:export\\s+)?${flag}\\s*=\\s*(.+)\\s*$`, "m"))?.[1]?.trim();
      const value = (fromProcess || fromFile || "").replace(/^["']|["']$/g, "").toLowerCase();
      if (value === "0" || value === "false") return; // default ON
      const envPort = process.env.PORT?.trim() ?? "";
      // Launch paths that don't set PORT (Tauri-spawned/`next dev -p` servers)
      // used to skip autostart entirely, so every dev-server recycle silently
      // killed the machine's driver until something manually poked the route
      // (live 2026-07-06: driver dead 64 min after an HMR recycle on 5121).
      // The machine-wide lease file records the previous holder's port — on the
      // same machine that is almost always this server (or another live one,
      // where starting the driver is equally correct: the lease keeps it to one
      // per machine either way).
      const leasePort = (() => {
        try {
          const leasePath = process.env.HIVEMINDOS_COMPANY_DRIVER_LEASE_FILE?.trim()
            || `${os?.homedir?.() ?? ""}/.hivemindos/company-autonomy-driver.lease.json`;
          const parsed = JSON.parse(fs?.readFileSync?.(leasePath, "utf8") ?? "") as { port?: string | number };
          const candidate = String(parsed?.port ?? "").trim();
          return /^\d+$/.test(candidate) ? candidate : "";
        } catch {
          return "";
        }
      })();
      const ports = [...new Set([envPort, leasePort].filter(Boolean))];
      if (!ports.length) {
        console.warn("[company-autonomy-driver] autostart skipped: no PORT env and no lease-file port (route hooks / watchdog will start the driver on first contact)");
        return;
      }
      // Never give up: a one-shot boot window used to strand launched companies
      // for hours when the server was slow to bind (the autostart burned its 5
      // attempts and the driver stayed stopped until a manual poke). Retry fast
      // during boot, then keep trying every minute until it sticks. Try BOTH
      // loopback families — Next/Tauri dev servers may bind only one of
      // 127.0.0.1 / [::1], and a single-family fetch retried forever against
      // the wrong one (live 2026-07-06: 5121 answers only on [::1]).
      for (let attempt = 0; ; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt < 5 ? 4_000 : 60_000));
        let started = false;
        for (const port of ports) {
          for (const host of ["127.0.0.1", "[::1]"]) {
            started = await fetch(`http://${host}:${port}/api/company-autonomy-driver`, {
              method: "POST",
              headers: { "content-type": "application/json", ...selfApiAuthHeaders() },
              body: JSON.stringify({ action: "start" }),
            })
              .then((response) => response.ok)
              .catch(() => false);
            if (started) break;
          }
          if (started) break;
        }
        if (started) {
          console.log("[company-autonomy-driver] auto-started");
          return;
        }
        if (attempt === 4 || (attempt > 4 && attempt % 15 === 0)) {
          console.error(`[company-autonomy-driver] autostart still failing after ${attempt + 1} attempts — retrying every 60s`);
        }
      }
    } catch (error) {
      console.error("[company-autonomy-driver] autostart failed:", error instanceof Error ? error.message : error);
    }
  })();

  // Resume Hive Compute hosting after an app-server restart. The worker child
  // process dies with this server, so without this hook a dev-server recycle
  // silently ended hosting while the fleet still believed the machine was live.
  // The saved run config's shouldRun flag records go-live intent; the route's
  // resume action re-checks readiness and is a no-op when hosting was stopped
  // on purpose. Same no-app-imports constraint as above. Disable with
  // HIVEMINDOS_HIVE_COMPUTE_RESUME=0.
  void (async () => {
    try {
      const builtin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
      const fs = builtin?.("node:fs") as { readFileSync?: (path: string, enc: string) => string } | undefined;
      const os = builtin?.("node:os") as { homedir?: () => string } | undefined;
      const flag = process.env.HIVEMINDOS_HIVE_COMPUTE_RESUME?.trim().toLowerCase() ?? "";
      if (flag === "0" || flag === "false") return; // default ON
      const shouldRun = (() => {
        try {
          const raw = fs?.readFileSync?.(
            `${os?.homedir?.() ?? ""}/.hivemindos/modules/hive-compute-worker/hivemind-host-config.json`,
            "utf8",
          ) ?? "";
          return (JSON.parse(raw) as { shouldRun?: unknown })?.shouldRun === true;
        } catch {
          return false;
        }
      })();
      if (!shouldRun) return;
      const port = process.env.PORT?.trim();
      if (!port) return; // portless launches resume on first manual host-panel visit
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        let resumed = false;
        for (const host of ["127.0.0.1", "[::1]"]) {
          resumed = await fetch(`http://${host}:${port}/api/hive-compute/marketplace`, {
            method: "POST",
            headers: { "content-type": "application/json", ...selfApiAuthHeaders() },
            body: JSON.stringify({ action: "resume-worker" }),
          })
            .then((response) => response.ok)
            .catch(() => false);
          if (resumed) break;
        }
        if (resumed) {
          console.log("[hive-compute] hosting resumed after restart");
          return;
        }
      }
      console.error("[hive-compute] hosting resume gave up after 5 attempts");
    } catch (error) {
      console.error("[hive-compute] hosting resume failed:", error instanceof Error ? error.message : error);
    }
  })();

  // Auto-start the report-only Inbox Triage brain service (daily capture-folder
  // report into the shared vault; no LLM, no file mutations). Same
  // no-app-imports constraint as above: read the kill switch via getBuiltinModule
  // and start the driver by POSTing to our own API route. Disable with
  // HIVEMINDOS_INBOX_TRIAGE=0 (or the toggle in Brain Services).
  void (async () => {
    try {
      const builtin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
      const fs = builtin?.("node:fs") as { readFileSync?: (path: string, enc: string) => string } | undefined;
      const os = builtin?.("node:os") as { homedir?: () => string } | undefined;
      const envFile = (() => {
        try {
          return fs?.readFileSync?.(`${os?.homedir?.() ?? ""}/.hivemindos/.env`, "utf8") ?? "";
        } catch {
          return "";
        }
      })();
      const flag = "HIVEMINDOS_INBOX_TRIAGE";
      const fromProcess = process.env[flag]?.trim();
      const fromFile = envFile.match(new RegExp(`^\\s*(?:export\\s+)?${flag}\\s*=\\s*(.+)\\s*$`, "m"))?.[1]?.trim();
      const value = (fromProcess || fromFile || "").replace(/^["']|["']$/g, "").toLowerCase();
      if (value === "0" || value === "false") return; // default ON
      const port = process.env.PORT?.trim();
      if (!port) return; // route hooks / manual start cover portless launches
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        let started = false;
        for (const host of ["127.0.0.1", "[::1]"]) {
          started = await fetch(`http://${host}:${port}/api/brain/inbox-triage`, {
            method: "POST",
            headers: { "content-type": "application/json", ...selfApiAuthHeaders() },
            body: JSON.stringify({ action: "start" }),
          })
            .then((response) => response.ok)
            .catch(() => false);
          if (started) break;
        }
        if (started) {
          console.log("[inbox-triage] auto-started");
          return;
        }
      }
      console.error("[inbox-triage] autostart gave up after 5 attempts");
    } catch (error) {
      console.error("[inbox-triage] autostart failed:", error instanceof Error ? error.message : error);
    }
  })();

  // Auto-start the Hive Research brain-sync driver (pull-syncs the user's
  // hivemindos.app/research frameworks + verdicts into the shared brain; an
  // unpaired machine's tick is a single state-file read). Same no-app-imports
  // constraint: kill switch via env, start via self-POST. Disable with
  // HIVEMINDOS_RESEARCH_SYNC=0.
  void (async () => {
    try {
      const value = (process.env.HIVEMINDOS_RESEARCH_SYNC || "").trim().toLowerCase();
      if (value === "0" || value === "false") return; // default ON
      const port = process.env.PORT?.trim();
      if (!port) return; // route hooks / manual start cover portless launches
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        let started = false;
        for (const host of ["127.0.0.1", "[::1]"]) {
          started = await fetch(`http://${host}:${port}/api/research-sync`, {
            method: "POST",
            headers: { "content-type": "application/json", ...selfApiAuthHeaders() },
            body: JSON.stringify({ action: "start" }),
          })
            .then((response) => response.ok)
            .catch(() => false);
          if (started) break;
        }
        if (started) {
          console.log("[research-sync] auto-started");
          return;
        }
      }
      console.error("[research-sync] autostart gave up after 5 attempts");
    } catch (error) {
      console.error("[research-sync] autostart failed:", error instanceof Error ? error.message : error);
    }
  })();

  if (process.env.NODE_ENV !== "development") return;
  const { registerDevMemoryGuard } = await import("@/lib/services/dev-memory-guard");
  registerDevMemoryGuard();
}
