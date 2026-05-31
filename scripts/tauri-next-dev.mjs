import { spawn } from "node:child_process";
import { rmSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const nextEnvPath = fileURLToPath(new URL("../next-env.d.ts", import.meta.url));
const tauriNextDir = fileURLToPath(new URL("../.next-tauri", import.meta.url));

function restoreNextEnv() {
  try {
    const current = readFileSync(nextEnvPath, "utf8");
    const restored = current.replace(
      'import "./.next-tauri/dev/types/routes.d.ts";',
      'import "./.next/dev/types/routes.d.ts";',
    );
    if (restored !== current) writeFileSync(nextEnvPath, restored);
  } catch {
    // Best-effort cleanup for Next.js' generated type reference.
  }
}

rmSync(tauriNextDir, { force: true, recursive: true });

const child = spawn(process.execPath, ["scripts/dev-server.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: process.env.PORT || "5021",
    HIVEMINDOS_TAURI_DEV: "1",
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code) => {
  restoreNextEnv();
  process.exit(code ?? 0);
});
