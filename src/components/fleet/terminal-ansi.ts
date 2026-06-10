/**
 * Minimal ANSI SGR parser for the fleet terminal renderer.
 * Ported from claw-code's mobile terminal; emits CSS-ready styles.
 *
 * Handles the common cases you'll actually hit in command output:
 *   - 8 + 8 bright foreground / background colors (30–37, 90–97, 40–47, 100–107)
 *   - 256-color (38;5;N / 48;5;N)
 *   - truecolor (38;2;R;G;B / 48;2;R;G;B)
 *   - bold, dim, italic, underline, and their resets
 *   - 0 = full reset, 39/49 = default fg/bg
 *
 * Non-SGR CSI sequences (cursor movement, clear-screen, etc.) are dropped
 * silently. OSC sequences (ESC ] … BEL / ST) are also dropped.
 */

export type AnsiStyle = {
  color?: string;
  backgroundColor?: string;
  fontWeight?: "bold";
  fontStyle?: "italic";
  textDecoration?: "underline";
  opacity?: number;
};

export type AnsiSegment = {
  text: string;
  style: AnsiStyle;
};

const FG_STANDARD: Record<number, string> = {
  30: "#2E2E2E", 31: "#CD3131", 32: "#0DBC79", 33: "#E5E510",
  34: "#2472C8", 35: "#BC3FBC", 36: "#11A8CD", 37: "#E5E5E5",
};
const FG_BRIGHT: Record<number, string> = {
  90: "#666666", 91: "#F14C4C", 92: "#23D18B", 93: "#F5F543",
  94: "#3B8EEA", 95: "#D670D6", 96: "#29B8DB", 97: "#FFFFFF",
};
const BG_STANDARD: Record<number, string> = {
  40: "#2E2E2E", 41: "#CD3131", 42: "#0DBC79", 43: "#E5E510",
  44: "#2472C8", 45: "#BC3FBC", 46: "#11A8CD", 47: "#E5E5E5",
};
const BG_BRIGHT: Record<number, string> = {
  100: "#666666", 101: "#F14C4C", 102: "#23D18B", 103: "#F5F543",
  104: "#3B8EEA", 105: "#D670D6", 106: "#29B8DB", 107: "#FFFFFF",
};

const BASIC_16 = [
  "#000000", "#CD3131", "#0DBC79", "#E5E510",
  "#2472C8", "#BC3FBC", "#11A8CD", "#E5E5E5",
  "#666666", "#F14C4C", "#23D18B", "#F5F543",
  "#3B8EEA", "#D670D6", "#29B8DB", "#FFFFFF",
];

const CUBE_STEPS = [0, 95, 135, 175, 215, 255];

function color256(idx: number): string | undefined {
  if (idx < 0 || idx > 255) return undefined;
  if (idx < 16) return BASIC_16[idx];
  if (idx < 232) {
    const n = idx - 16;
    const r = CUBE_STEPS[Math.floor(n / 36) % 6];
    const g = CUBE_STEPS[Math.floor(n / 6) % 6];
    const b = CUBE_STEPS[n % 6];
    return `rgb(${r},${g},${b})`;
  }
  const v = 8 + (idx - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

function applySgr(current: AnsiStyle, parts: number[]): AnsiStyle {
  const next: AnsiStyle = { ...current };
  let i = 0;
  while (i < parts.length) {
    const n = parts[i];
    if (n === 0) {
      i++;
      for (const k of Object.keys(next) as (keyof AnsiStyle)[]) delete next[k];
      continue;
    }
    if (n === 1) { next.fontWeight = "bold"; i++; continue; }
    if (n === 2) { next.opacity = 0.6; i++; continue; }
    if (n === 3) { next.fontStyle = "italic"; i++; continue; }
    if (n === 4) { next.textDecoration = "underline"; i++; continue; }
    if (n === 22) { delete next.fontWeight; delete next.opacity; i++; continue; }
    if (n === 23) { delete next.fontStyle; i++; continue; }
    if (n === 24) { delete next.textDecoration; i++; continue; }
    if (n >= 30 && n <= 37) { next.color = FG_STANDARD[n]; i++; continue; }
    if (n === 38) {
      const mode = parts[i + 1];
      if (mode === 5) {
        const c = color256(parts[i + 2] ?? -1);
        if (c) next.color = c;
        i += 3; continue;
      }
      if (mode === 2) {
        const r = parts[i + 2] ?? 0, g = parts[i + 3] ?? 0, b = parts[i + 4] ?? 0;
        next.color = `rgb(${r},${g},${b})`;
        i += 5; continue;
      }
      i++; continue;
    }
    if (n === 39) { delete next.color; i++; continue; }
    if (n >= 40 && n <= 47) { next.backgroundColor = BG_STANDARD[n]; i++; continue; }
    if (n === 48) {
      const mode = parts[i + 1];
      if (mode === 5) {
        const c = color256(parts[i + 2] ?? -1);
        if (c) next.backgroundColor = c;
        i += 3; continue;
      }
      if (mode === 2) {
        const r = parts[i + 2] ?? 0, g = parts[i + 3] ?? 0, b = parts[i + 4] ?? 0;
        next.backgroundColor = `rgb(${r},${g},${b})`;
        i += 5; continue;
      }
      i++; continue;
    }
    if (n === 49) { delete next.backgroundColor; i++; continue; }
    if (n >= 90 && n <= 97) { next.color = FG_BRIGHT[n]; i++; continue; }
    if (n >= 100 && n <= 107) { next.backgroundColor = BG_BRIGHT[n]; i++; continue; }
    i++;
  }
  return next;
}

// Strip OSC and other non-SGR escapes up front. SGR sequences are
// processed below; everything else we drop (cursor movement, clear-line,
// title setters — none of those are meaningful in a line-based renderer).
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI_RE = /\x1b\[([\d;?]*)([a-zA-Z])/g;

export function parseAnsi(line: string): AnsiSegment[] {
  const cleaned = line.replace(OSC_RE, "");
  const segments: AnsiSegment[] = [];
  let style: AnsiStyle = {};
  let lastIndex = 0;

  CSI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSI_RE.exec(cleaned)) !== null) {
    const [full, paramsStr, letter] = match;
    const before = cleaned.slice(lastIndex, match.index);
    if (before.length > 0) {
      segments.push({ text: before, style: { ...style } });
    }
    lastIndex = match.index + full.length;
    if (letter !== "m") continue;
    const params = paramsStr === "" ? [0] : paramsStr.split(";").map((s) => Number(s) || 0);
    style = applySgr(style, params);
  }
  const rest = cleaned.slice(lastIndex);
  if (rest.length > 0) segments.push({ text: rest, style: { ...style } });
  return segments;
}
