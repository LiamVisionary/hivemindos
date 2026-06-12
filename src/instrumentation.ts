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
          headers: { "content-type": "application/json" },
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

  if (process.env.NODE_ENV !== "development") return;
  const { registerDevMemoryGuard } = await import("@/lib/services/dev-memory-guard");
  registerDevMemoryGuard();
}
