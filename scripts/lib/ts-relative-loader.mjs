// Minimal ESM resolve hook for Node's native TypeScript type-stripping.
//
// Node strips types from .ts files but does NOT guess extensions, so a runtime
// import like `from "./prompts"` inside a .ts module fails to resolve. This hook
// appends a TS/JS extension to extensionless relative specifiers so .mjs unit
// tests can import the project's .ts modules directly (the established pattern
// for this repo's `scripts/test-*.mjs` suite). Register it before importing the
// module under test:
//
//   import { register } from "node:module";
//   register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
//   const mod = await import("../src/.../module.ts");
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CANDIDATE_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export default undefined;", shortCircuit: true };
  }
  // Bundlers accept bare `import data from "./x.json"`; Node's loader demands
  // `with { type: "json" }` and hard-fails the whole import graph without it.
  // Stamp the attribute at resolve time so hermetic suites can import app
  // modules whose deep graph includes a JSON import (e.g. bee-worker-presets
  // importing bee-worker-souls.json).
  if (specifier.endsWith(".json")) {
    const resolved = await nextResolve(specifier, context);
    return { ...resolved, importAttributes: { ...(resolved.importAttributes ?? {}), type: "json" } };
  }
  if (specifier === "next/server") {
    return nextResolve("next/server.js", context);
  }
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const isProjectAlias = specifier.startsWith("@/");
  const hasExtension = /\.[mc]?[jt]sx?$/.test(specifier);
  if (isProjectAlias) {
    const base = new URL(`../../src/${specifier.slice(2)}`, import.meta.url);
    if (hasExtension && existsSync(fileURLToPath(base))) {
      return nextResolve(base.href, context);
    }
    for (const ext of CANDIDATE_EXTENSIONS) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
  }
  if (isRelative && !hasExtension && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of CANDIDATE_EXTENSIONS) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(specifier + ext, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
