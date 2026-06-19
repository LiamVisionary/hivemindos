import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import path from "node:path";

const projectRoot = path.join(/*turbopackIgnore: true*/ __dirname);
const isTauriDev = process.env.HIVEMINDOS_TAURI_DEV === "1";
const isTauriStaticBuild = process.env.HIVEMINDOS_TAURI_STATIC_BUILD === "1";
const isTauriBuild = process.env.HIVEMINDOS_TAURI_BUILD === "1";
const tauriDevDistDir = process.env.HIVEMINDOS_TAURI_NEXT_DIST_DIR || ".next-tauri";

function splitOrigins(value?: string) {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function detectedTailnetDevOrigins() {
  const origins = new Set<string>();

  try {
    const ips = execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8", timeout: 1_000 });
    splitOrigins(ips.replace(/\n/g, ",")).forEach((ip) => origins.add(ip));
  } catch {
    // Tailscale is optional; clones without it can use NEXT_ALLOWED_DEV_ORIGINS.
  }

  try {
    const rawStatus = execFileSync("tailscale", ["status", "--json"], { encoding: "utf8", timeout: 1_000 });
    const status = JSON.parse(rawStatus) as { Self?: { DNSName?: string } };
    const dnsName = status.Self?.DNSName?.replace(/\.$/, "");
    if (dnsName) origins.add(dnsName);
  } catch {
    // Same optional Tailscale path as above.
  }

  return [...origins];
}

const nextConfig: NextConfig = {
  // Dev-only knob: React StrictMode double-invokes every render and effect under
  // `next dev`, which roughly doubles the cost of a dashboard view switch.
  // Production builds never double-invoke, so this flag has ZERO effect on the
  // packaged app — it only changes the dev experience. StrictMode is a known
  // dev-perf drag for this large dashboard, so default it OFF for snappier dev;
  // set HIVEMINDOS_DEV_STRICT=1 to restore the double-invoke checks when hunting
  // effect-cleanup / render-purity bugs.
  reactStrictMode: process.env.HIVEMINDOS_DEV_STRICT === "1",
  // Dev-only chrome: hide Next's floating tools badge so it doesn't cover
  // dashboard UI while still keeping compile/runtime error overlays enabled.
  devIndicators: false,
  // The embedded build compiles all ~155 API routes and is memory-heavy; this
  // trades a little build time to cut webpack's peak memory so it stays under
  // the heap cap on CI runners (avoids the 8 GB OOM). Next 15.2+.
  experimental:
    isTauriBuild || isTauriStaticBuild
      ? { webpackBuildWorker: true, webpackMemoryOptimizations: true }
      : undefined,
  // Pin file tracing to the repo so Next never infers a wider root and walks
  // directories it cannot read (Windows profile junctions EPERM on scandir).
  outputFileTracingRoot: projectRoot,
  // Dev only: keep compiled entries alive for an hour instead of disposing
  // them after ~a minute of inactivity. Disposal made the first chat message
  // after an idle stretch stall ~15s behind an on-demand recompile of the
  // agent-runtime route (scripts/dev-server.mjs warm-keeper is the second
  // half of that fix).
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    pagesBufferLength: 50,
  },
  distDir: isTauriDev ? tauriDevDistDir : isTauriStaticBuild ? ".next-tauri-static-build" : isTauriBuild ? ".next-tauri-build" : ".next",
  output: isTauriStaticBuild ? "export" : isTauriBuild ? "standalone" : undefined,
  serverExternalPackages: isTauriBuild
    ? [
        "@noble/curves",
        "@noble/hashes",
        "@scure/bip39",
        "@solana/kit",
        "@solana/spl-token",
        "@solana/web3.js",
        "bs58",
        "viem",
      ]
    : undefined,
  // Tauri packaging builds (static export + embedded server) don't gate on
  // type errors — those are enforced in dev and the standalone `build`/
  // `lint` scripts + CI. The embedded build additionally compiles paths the
  // static build hides (API routes, remotion/), so without this it trips on
  // pre-existing type errors (e.g. an SVG `pathLength` in a Remotion `style`).
  // (No `eslint` key: Next 16 removed the built-in ESLint integration, so
  // builds never lint and the key only produces an invalid-config warning.)
  typescript:
    isTauriStaticBuild || isTauriBuild
      ? {
          ignoreBuildErrors: true,
        }
      : undefined,
  trailingSlash: isTauriStaticBuild ? true : undefined,
  images: isTauriStaticBuild || isTauriBuild
    ? {
        unoptimized: true,
      }
    : undefined,
  outputFileTracingExcludes: isTauriBuild
    ? {
        "/*": [
          "./.git/**/*",
          "./.next/**/*",
          "./.next-tauri/**/*",
          "./.next-tauri-build/**/*",
          "./.next-tauri-static-build/**/*",
          "./artifacts/**/*",
          "./bin/**/*",
          "./coverage/**/*",
          "./docs/**/*",
          "./emoji-atlas-visual-asset/**/*",
          "./emoji-site/**/*",
          "./out/**/*",
          "./promo-videos/**/*",
          "./release-assets/**/*",
          "./skills/**/*",
          "./src-tauri/**/*",
          "./tmp/**/*",
          "./vendor/**/*",
          "./workers/**/*",
          "./*.md",
          "./*.log",
          "./AGENTS.md",
          "./ASSIMILATION*",
          "./go.*",
          "./setup.*",
          "./uninstall.*",
          "./tsconfig.tsbuildinfo",
        ],
      }
    : undefined,
  webpack(config, { dev }) {
    if (dev && process.env.NEXT_DEV_SOURCE_MAPS !== "1") {
      config.devtool = false;
    }
    return config;
  },
  allowedDevOrigins: [
    "127.0.0.1",
    ...splitOrigins(process.env.NEXT_ALLOWED_DEV_ORIGINS),
    ...detectedTailnetDevOrigins(),
  ],
  async headers() {
    return [
      {
        source: "/icons/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
