import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DOT_LOTTIE_WASM_PATH = join(
  process.cwd(),
  "node_modules",
  "@lottiefiles",
  "dotlottie-web",
  "dist",
  "dotlottie-player.wasm",
);

export async function GET() {
  const wasmData = await readFile(DOT_LOTTIE_WASM_PATH);
  const wasmBlob = new Blob([new Uint8Array(wasmData)], {
    type: "application/wasm",
  });

  return new Response(wasmBlob, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "application/wasm",
    },
  });
}
