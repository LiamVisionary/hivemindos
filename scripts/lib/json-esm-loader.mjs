// ESM `load` hook so .mjs scripts can import a .ts module that does a bare
// `import x from "./foo.json"` without Node 24's required `with { type: "json" }`
// attribute (TypeScript/Next handle this via resolveJsonModule; raw Node ESM does not).
// Register alongside ts-relative-loader.mjs:
//   register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
//   register(new URL("./lib/json-esm-loader.mjs", import.meta.url));
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    return { format: "json", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
