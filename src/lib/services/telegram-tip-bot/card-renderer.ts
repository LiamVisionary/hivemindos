import "server-only";

import type { Browser } from "playwright";

import { CLAW_LIGHT_RICH_THEME, escapeRichHtml } from "./rich-formatting";

export type TelegramCardCell = {
  text: string;
  tone?: "default" | "accent" | "muted" | "success" | "danger" | "code";
  align?: "left" | "center" | "right";
};

export type TelegramCardSection = {
  title: string;
  columns: string[];
  rows: TelegramCardCell[][];
};

export type TelegramCard = {
  title: string;
  subtitle?: string;
  sections: TelegramCardSection[];
};

const browserState = globalThis as typeof globalThis & {
  __hiveTelegramCardBrowser?: Promise<Browser>;
};

async function getBrowser(): Promise<Browser> {
  browserState.__hiveTelegramCardBrowser ??= import("playwright").then(({ chromium }) =>
    chromium.launch({ headless: true }),
  );
  return browserState.__hiveTelegramCardBrowser;
}

function cellClass(cell: TelegramCardCell): string {
  const classes = ["cell"];
  if (cell.tone) classes.push(cell.tone);
  if (cell.align) classes.push(cell.align);
  return classes.join(" ");
}

function renderTable(section: TelegramCardSection): string {
  const header = section.columns.map((column) => `<th>${escapeRichHtml(column)}</th>`).join("");
  const rows = section.rows
    .map((row) =>
      `<tr>${row
        .map((cell) => `<td class="${cellClass(cell)}">${escapeRichHtml(cell.text)}</td>`)
        .join("")}</tr>`,
    )
    .join("");
  return `
    <section>
      <h2>${escapeRichHtml(section.title)}</h2>
      <table>
        <thead><tr>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function html(card: TelegramCard): string {
  const theme = CLAW_LIGHT_RICH_THEME;
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            background: transparent;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, sans-serif;
            color: ${theme.text};
          }
          #card {
            width: 860px;
            background: ${theme.bg};
            border: 1px solid ${theme.divider};
            border-radius: 28px;
            padding: 32px;
            box-shadow: 0 18px 46px rgba(43, 40, 35, 0.14);
          }
          .titleRow {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            gap: 24px;
            padding-bottom: 22px;
            border-bottom: 1px solid ${theme.divider};
            margin-bottom: 26px;
          }
          h1 {
            margin: 0;
            font-size: 38px;
            line-height: 1.08;
            letter-spacing: 0;
            font-weight: 780;
          }
          .subtitle {
            color: ${theme.textMuted};
            font-size: 21px;
            line-height: 1.25;
            white-space: nowrap;
          }
          section + section { margin-top: 30px; }
          h2 {
            margin: 0 0 12px;
            font-size: 25px;
            line-height: 1.15;
            letter-spacing: 0;
            font-weight: 740;
            color: ${theme.accent};
          }
          table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            overflow: hidden;
            border: 1px solid ${theme.divider};
            border-radius: 18px;
            background: ${theme.surface};
            table-layout: fixed;
          }
          th, td {
            border-right: 1px solid ${theme.divider};
            border-bottom: 1px solid ${theme.divider};
            padding: 17px 18px;
            font-size: 24px;
            line-height: 1.16;
            vertical-align: middle;
            color: ${theme.text};
            overflow-wrap: anywhere;
          }
          th:last-child, td:last-child { border-right: 0; }
          tbody tr:last-child td { border-bottom: 0; }
          th {
            background: ${theme.surfaceAlt};
            color: ${theme.textMuted};
            font-size: 17px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            font-weight: 720;
          }
          tbody tr:nth-child(even) td { background: rgba(240, 234, 222, 0.58); }
          th:first-child, td:first-child { width: 70px; text-align: center; }
          th:nth-child(3), td:nth-child(3) { width: 140px; text-align: right; white-space: nowrap; }
          th:last-child, td:last-child { width: 92px; text-align: center; }
          .accent {
            color: ${theme.accent};
            font-weight: 800;
          }
          .muted {
            color: ${theme.textMuted};
            font-style: italic;
          }
          .success {
            color: ${theme.success};
            font-weight: 760;
          }
          .danger {
            color: ${theme.danger};
            font-weight: 760;
          }
          .code {
            color: ${theme.textMuted};
            font-family: "SF Mono", ui-monospace, Menlo, monospace;
            font-size: 19px;
          }
          .left { text-align: left; }
          .center { text-align: center; }
          .right { text-align: right; }
        </style>
      </head>
      <body>
        <div id="card">
          <div class="titleRow">
            <h1>${escapeRichHtml(card.title)}</h1>
            ${card.subtitle ? `<div class="subtitle">${escapeRichHtml(card.subtitle)}</div>` : ""}
          </div>
          ${card.sections.map(renderTable).join("")}
        </div>
      </body>
    </html>`;
}

export async function renderTelegramCardPng(card: TelegramCard): Promise<ArrayBuffer> {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: 920, height: 1600 }, deviceScaleFactor: 2 });
  try {
    await page.setContent(html(card), { waitUntil: "load" });
    const cardElement = page.locator("#card");
    const image = await cardElement.screenshot({ type: "png" });
    const copy = new Uint8Array(image.byteLength);
    copy.set(image);
    return copy.buffer;
  } finally {
    await page.close().catch(() => undefined);
  }
}
