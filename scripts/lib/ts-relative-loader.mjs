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
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\.[mc]?[jt]sx?$/.test(specifier);
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
