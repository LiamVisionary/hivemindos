import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react/no-unescaped-entities": "off",
    },
  },
  {
    // .cjs files are CommonJS by definition — require() IS their module system.
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([
    ".antvis-infographic/**",
    ".next/**",
    ".next-tauri/**",
    ".next-tauri-build/**",
    ".next-tauri-static-build/**",
    ".evo/**",
    ".hivemindos-dogfood/**",
    "node_modules/**",
    "promo-videos/**",
    "remotion/**",
    "src-tauri/target/**",
    "src-tauri/resources/**",
    "apps/zimage-mobile-tauri/src-tauri/gen/**",
    "artifacts/**",
    "dist/**",
    "emoji-site/**",
    "emoji-atlas-visual-asset/**",
    "public/**",
    "tmp/**",
  ]),
]);
