#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const storeDir = dirname(fileURLToPath(import.meta.url));
const extensionDir = resolve(storeDir, "..");
const assetsDir = join(storeDir, "assets");
const masterIconPath = join(assetsDir, "icon-master-1024.png");
const server = createServer(async (request, response) => {
  const requestPath = new URL(request.url || "/", "http://127.0.0.1").pathname;
  const path = resolve(extensionDir, `.${normalize(requestPath)}`);
  if (!path.startsWith(`${extensionDir}/`) || path.includes(`${extensionDir}/store/`)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(path);
    const mime = new Map([
      [".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"],
      [".mjs", "text/javascript"], [".png", "image/png"],
    ]).get(extname(path)) || "application/octet-stream";
    response.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Could not start the extension asset renderer.");

const browser = await chromium.launch({ headless: true });
try {
  const panelPage = await browser.newPage({ viewport: { width: 420, height: 800 }, deviceScaleFactor: 1 });
  await panelPage.addInitScript(() => {
    const settings = {
      dashboardUrl: "http://127.0.0.1:5020",
      token: "store-demo-token",
      agentId: "queen",
      contextMode: "page",
      agentMode: "ask",
      sessionId: "",
    };
    globalThis.chrome = {
      storage: { local: { get: async () => ({ hivemindosBrowserSettings: settings }), set: async () => undefined } },
      tabs: {
        query: async () => [
          { id: 91, windowId: 1, active: true, title: "HivemindOS — Local-first agent operating system", url: "https://hivemindos.app/" },
          { id: 92, windowId: 1, active: false, title: "Chrome Extensions documentation", url: "https://developer.chrome.com/docs/extensions/" },
          { id: 93, windowId: 1, active: false, title: "HivemindOS on GitHub", url: "https://github.com/LiamVisionary/hivemindos" },
        ],
        sendMessage: async () => ({
          ok: true,
          title: "HivemindOS — Local-first agent operating system",
          url: "https://hivemindos.app/",
          selectedText: "Your agents. Your hardware. Your rules.",
          text: "HivemindOS is a local-first operating system for private AI agents. Coordinate agents, tools, memory, approvals, wallets, and remote machines from one calm control room.",
          meta: {
            description: "A private, local-first operating system for AI agents.",
            language: "en",
            headings: [{ level: "h1", text: "Your agents. Your hardware. Your rules." }],
            interactive: [{ kind: "a", text: "Get HivemindOS", href: "https://hivemindos.app/" }],
          },
        }),
      },
      scripting: { executeScript: async () => undefined },
      permissions: { contains: async () => true, request: async () => true },
    };
    globalThis.fetch = async (_url, init = {}) => {
      if ((init.method || "GET") === "POST") {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"delta":"HivemindOS turns the current page into trusted working context for your private agent hive. "}\n\n'));
            controller.enqueue(encoder.encode('data: {"delta":"This page introduces the local-first control room, shared memory, approvals, and fleet orchestration."}\n\n'));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }
      return new Response(JSON.stringify({
        agents: [
          { id: "queen", name: "Queen Bee", runtime: "Hermes" },
          { id: "research", name: "Researcher", runtime: "Codex" },
          { id: "builder", name: "Builder", runtime: "Claude" },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  });
  await panelPage.goto(`http://127.0.0.1:${address.port}/sidepanel.html?tab=91`);
  await panelPage.getByText("Summarize", { exact: true }).click();
  await panelPage.getByText(/HivemindOS turns the current page/).waitFor();
  const panelPath = join(assetsDir, "panel-demo-420x800.png");
  await panelPage.screenshot({ path: panelPath });

  const iconData = `data:image/png;base64,${(await readFile(masterIconPath)).toString("base64")}`;
  const panelData = `data:image/png;base64,${(await readFile(panelPath)).toString("base64")}`;
  const assetPage = await browser.newPage({ deviceScaleFactor: 1 });

  await assetPage.setViewportSize({ width: 1280, height: 800 });
  await assetPage.setContent(screenshotMarkup(panelData, iconData));
  await assetPage.screenshot({ path: join(assetsDir, "screenshot-side-panel-1280x800.png") });

  await assetPage.setViewportSize({ width: 440, height: 280 });
  await assetPage.setContent(promoMarkup(iconData, "small"));
  await assetPage.screenshot({ path: join(assetsDir, "small-promo-440x280.png") });

  await assetPage.setViewportSize({ width: 1400, height: 560 });
  await assetPage.setContent(promoMarkup(iconData, "marquee"));
  await assetPage.screenshot({ path: join(assetsDir, "marquee-1400x560.png") });
} finally {
  await browser.close();
  server.close();
}

console.log(`Chrome Web Store assets rendered in ${assetsDir}`);

function baseStyles() {
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
    body { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0c0d11; color: #f3f0e9; }
    .noise { position: absolute; inset: 0; opacity: .2; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.16'/%3E%3C/svg%3E"); mix-blend-mode: soft-light; pointer-events: none; }
    .hex { position: absolute; width: 100px; aspect-ratio: 1; border: 1px solid rgba(231,180,92,.2); clip-path: polygon(25% 7%,75% 7%,100% 50%,75% 93%,25% 93%,0 50%); }
  `;
}

function screenshotMarkup(panelData, iconData) {
  return `<!doctype html><style>${baseStyles()}
    body { background: radial-gradient(circle at 83% 12%, rgba(48,161,236,.16), transparent 30%), radial-gradient(circle at 5% 90%, rgba(231,180,92,.14), transparent 34%), #0c0d11; }
    .browser { position: absolute; inset: 30px; border: 1px solid #34363d; border-radius: 20px; overflow: hidden; box-shadow: 0 28px 80px rgba(0,0,0,.55); background: #111319; }
    .toolbar { height: 58px; display: flex; align-items: center; gap: 12px; padding: 0 18px; border-bottom: 1px solid #2a2c33; background: #191b20; }
    .dots { display:flex; gap:7px; } .dots i { width:11px; height:11px; border-radius:50%; background:#3b3d45; }
    .omnibox { height: 34px; flex: 1; border-radius: 10px; background: #25272d; color:#96999f; display:flex; align-items:center; padding:0 14px; font-size:13px; }
    .mini { width: 32px; height: 32px; object-fit: contain; }
    .content { position:absolute; inset:58px 0 0; display:grid; grid-template-columns: 1fr 420px; }
    .page { position:relative; overflow:hidden; padding: 78px 70px; background: radial-gradient(circle at 35% 30%, rgba(231,180,92,.12), transparent 35%), #101217; }
    .eyebrow { font: 600 12px/1.2 ui-monospace, monospace; letter-spacing:.14em; text-transform:uppercase; color:#e7b45c; }
    h1 { margin:22px 0 22px; max-width:600px; font-size:54px; line-height:.98; letter-spacing:-.045em; }
    .lede { max-width:590px; color:#aaa69d; font-size:19px; line-height:1.55; }
    .rails { display:flex; gap:14px; margin-top:38px; } .rail { width:150px; padding:16px; border:1px solid #2c2e35; border-radius:14px; background:#17191f; }
    .rail b { display:block; font-size:13px; margin-bottom:6px; } .rail span { font-size:12px; color:#8d8f95; }
    .panel { width:420px; height:742px; border-left:1px solid #30323a; object-fit:cover; object-position:top; }
  </style><div class="browser"><div class="toolbar"><div class="dots"><i></i><i></i><i></i></div><div class="omnibox">hivemindos.app</div><img class="mini" src="${iconData}"></div><div class="content"><main class="page"><div class="eyebrow">Local-first agent operating system</div><h1>Your agents. Your hardware. Your rules.</h1><p class="lede">Coordinate agents, tools, memory, approvals, wallets, and remote machines from one calm control room.</p><div class="rails"><div class="rail"><b>Private by default</b><span>Run locally or on your private fleet.</span></div><div class="rail"><b>Any agent</b><span>Choose the right runtime for the work.</span></div><div class="rail"><b>Human control</b><span>Approve sensitive actions in context.</span></div></div><span class="hex" style="left:44px;bottom:42px"></span><span class="hex" style="left:130px;bottom:-8px"></span></main><img class="panel" src="${panelData}"></div></div><div class="noise"></div>`;
}

function promoMarkup(iconData, variant) {
  const marquee = variant === "marquee";
  return `<!doctype html><style>${baseStyles()}
    body { background: radial-gradient(circle at 72% 36%, rgba(42,167,245,.28), transparent 28%), radial-gradient(circle at 28% 78%, rgba(231,180,92,.32), transparent 31%), linear-gradient(145deg,#121419,#08090c); }
    .ring { position:absolute; left:50%; top:50%; translate:-50% -50%; width:${marquee ? 430 : 208}px; aspect-ratio:1; border-radius:50%; border:1px solid rgba(231,180,92,.2); box-shadow:0 0 80px rgba(42,167,245,.13), inset 0 0 60px rgba(231,180,92,.07); }
    .mark { position:absolute; left:50%; top:50%; translate:-50% -50%; width:${marquee ? 360 : 184}px; height:${marquee ? 360 : 184}px; object-fit:contain; filter:drop-shadow(0 24px 32px rgba(0,0,0,.45)); }
  </style><span class="hex" style="left:${marquee ? 110 : 14}px;top:${marquee ? 80 : 24}px;transform:scale(${marquee ? 1.7 : .7})"></span><span class="hex" style="right:${marquee ? 100 : 8}px;bottom:${marquee ? 45 : 15}px;transform:scale(${marquee ? 2.1 : .85})"></span><div class="ring"></div><img class="mark" src="${iconData}"><div class="noise"></div>`;
}
