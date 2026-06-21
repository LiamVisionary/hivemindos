import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const bundleRoot = process.env.HIVEMINDOS_TAURI_RUNTIME_BUNDLE_DIR
  || join(process.cwd(), "src-tauri", "resources", "hivemindos-next");
const nodeModulesRoot = join(bundleRoot, "node_modules");

const sentinelPackages = [
  "next",
  "react",
  "react-dom",
  "scheduler",
  "postcss",
  "picocolors",
  "bs58",
  "base-x",
  "@scure/base",
  "@scure/bip32",
  "@scure/bip39",
  "@noble/curves",
  "@noble/hashes",
  "viem",
  "abitype",
  "ox",
  "@solana/kit",
  "@solana/accounts",
  "@solana/spl-token",
  "@solana/buffer-layout",
  "@solana/buffer-layout-utils",
  "@solana/spl-token-metadata",
  "@solana/web3.js",
  "bn.js",
  "borsh",
  "rpc-websockets",
];

const importSpecs = [
  "next",
  "react",
  "react-dom/server",
  "scheduler",
  "postcss",
  "bs58",
  "@scure/bip39",
  "viem",
  "@solana/spl-token",
  "@solana/web3.js",
  "@solana/kit",
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function packagePath(packageName) {
  return join(nodeModulesRoot, ...packageName.split("/"));
}

if (!existsSync(join(bundleRoot, "server.js"))) {
  fail(`Missing packaged Next server at ${join(bundleRoot, "server.js")}. Run pnpm tauri:prepare:server first.`);
}

for (const packageName of sentinelPackages) {
  if (!existsSync(packagePath(packageName))) {
    fail(`Packaged Tauri runtime is missing node_modules/${packageName}.`);
  }
}

for (const spec of importSpecs) {
  const script = [
    `import(${JSON.stringify(spec)})`,
    ".then(() => undefined)",
    ".catch((error) => {",
    "  console.error(`${error.code || 'ERR'} ${error.message.split('\\n')[0]}`);",
    "  process.exit(1);",
    "});",
  ].join("");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: bundleRoot,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.status !== 0) {
    fail(`Packaged Tauri runtime cannot import ${spec}: ${(result.stderr || result.stdout || "").trim() || `exit ${result.status}`}`);
  }
}

if (!process.exitCode) {
  console.log("Tauri runtime bundle dependency smoke passed.");
}
