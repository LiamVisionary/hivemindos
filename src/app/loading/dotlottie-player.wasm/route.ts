import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Resolve the wasm from the installed package wherever Node finds it — the
// top-level node_modules copy (what the packaged build stages) OR pnpm's nested
// .pnpm copy (dev). The previous hardcoded process.cwd()/node_modules path only
// existed in dev (pnpm's top-level symlink) and 500'd in the packaged app.
function resolveWasmPath(): string {
  try {
    const req = createRequire(import.meta.url);
    const packageEntry = req.resolve("@lottiefiles/dotlottie-web");
    return join(dirname(packageEntry), "dotlottie-player.wasm");
  } catch {
    return join(
      process.cwd(),
      "node_modules",
      "@lottiefiles",
      "dotlottie-web",
      "dist",
      "dotlottie-player.wasm",
    );
  }
}

export async function GET() {
  try {
    const wasmData = await readFile(resolveWasmPath());
    return new Response(new Blob([new Uint8Array(wasmData)], { type: "application/wasm" }), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": "application/wasm",
      },
    });
  } catch {
    // A missing wasm must never 500 this route — the Lottie player tolerates a
    // null player (it try/catches construction). Return 404 so the failure stays
    // cosmetic instead of spamming unhandled 500s in the server log.
    return new Response(null, { status: 404 });
  }
}
