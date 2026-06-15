export function escapeRichHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type RichTableCell = string | { html: string };

// Source: claw-code-mobile-private/constants/palette.ts TERRACOTTA_LIGHT.
// Telegram rich HTML does not support CSS colors or style attributes, so these
// tokens are mapped to the closest supported rich tags below.
export const CLAW_LIGHT_RICH_THEME = {
  bg: "#F5EFE6",
  surface: "#F8F4EE",
  surfaceAlt: "#F0E8D8",
  text: "#4A3A2A",
  textMuted: "#8A7A6A",
  textSoft: "#A09080",
  divider: "#E8DCC8",
  accent: "#8A5A2A",
  danger: "#B5483B",
  success: "#6B8F5E",
} as const;

export function richBold(text: string): RichTableCell {
  return { html: `<b>${escapeRichHtml(text)}</b>` };
}

export function richAccent(text: string): RichTableCell {
  return richBold(text);
}

export function richMuted(text: string): RichTableCell {
  return { html: `<i>${escapeRichHtml(text)}</i>` };
}

export function richCode(text: string): RichTableCell {
  return { html: `<code>${escapeRichHtml(text)}</code>` };
}

function renderCell(cell: RichTableCell): string {
  return typeof cell === "string" ? escapeRichHtml(cell) : cell.html;
}

export function richTable(headers: string[], rows: RichTableCell[][]): string {
  const header = `<tr>${headers.map((cell) => `<th>${escapeRichHtml(cell)}</th>`).join("")}</tr>`;
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderCell(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<table bordered striped>${header}${body}</table>`;
}
