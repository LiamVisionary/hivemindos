export type LeakedTextToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export function contentHasLeakedToolCallMarker(content: string) {
  return /<\|?tool[_\s-]?call/i.test(content) || /<tool[_\s-]?call\|>/i.test(content);
}

export function firstLeakedToolCallMarkerIndex(content: string) {
  const direct = content.search(/<\|?tool[_\s-]?call/i);
  const reversed = content.search(/<tool[_\s-]?call\|>/i);
  if (direct < 0) return reversed;
  if (reversed < 0) return direct;
  return Math.min(direct, reversed);
}

export function stripLeakedToolCallMarkup(content: string) {
  if (!contentHasLeakedToolCallMarker(content)) return content;
  const marker = firstLeakedToolCallMarkerIndex(content);
  const kept = marker >= 0 ? content.slice(0, marker) : content;
  return kept
    .replace(/<\|[^<>]*\|?>/g, "\n")
    .replace(/<[^<>|]*\|>/g, "\n")
    .replace(/^\s*call:[\w.-]+\s*$/gim, "")
    .trim();
}

function normalizeLeakedToolCallMarkup(content: string) {
  return content
    .replace(/<\|"\|>/g, "\"")
    .replace(/<\|?tool[_\s-]?call\|?>/gi, "\n")
    .replace(/<tool[_\s-]?call\|>/gi, "\n")
    .replace(/<\|[^<>]*\|?>/g, "\n")
    .replace(/<[^<>|]*\|>/g, "\n");
}

function quotedOrBareValueForKey(source: string, key: string) {
  const match = new RegExp(`\\b${key}\\s*:\\s*(?:"([^"]*)"|'([^']*)'|([^,\\n\\]}]+))`, "i").exec(source);
  return String(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function extractArrayBodyForKey(source: string, key: string) {
  const keyMatch = new RegExp(`\\b${key}\\s*:`, "i").exec(source);
  if (!keyMatch) return "";
  const openIndex = source.indexOf("[", keyMatch.index + keyMatch[0].length);
  if (openIndex < 0) return "";
  let quote = "";
  let escaped = false;
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return "";
}

function stringItemsFromArrayBody(body: string) {
  const items: string[] = [];
  let index = 0;
  while (index < body.length) {
    while (index < body.length && /[\s,]/.test(body[index])) index += 1;
    const quote = body[index];
    if (quote !== "\"" && quote !== "'") {
      const start = index;
      while (index < body.length && body[index] !== ",") index += 1;
      const value = body.slice(start, index).trim();
      if (value && !/^[\]}]+$/.test(value)) items.push(value);
      continue;
    }
    index += 1;
    let value = "";
    let escaped = false;
    while (index < body.length) {
      const char = body[index];
      index += 1;
      if (escaped) {
        value += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) break;
      value += char;
    }
    items.push(value);
  }
  return items.filter((item) => item.length > 0);
}

export function extractLeakedToolCalls(content: string): LeakedTextToolCall[] {
  if (!contentHasLeakedToolCallMarker(content)) return [];
  const normalized = normalizeLeakedToolCallMarkup(content);
  const nameMatch = /\bcall\s*:\s*([A-Za-z0-9_.-]+)/i.exec(normalized);
  const name = nameMatch?.[1]?.trim() ?? "";
  if (!name) return [];
  const command = quotedOrBareValueForKey(normalized, "command");
  const reason = quotedOrBareValueForKey(normalized, "reason");
  const args = stringItemsFromArrayBody(extractArrayBodyForKey(normalized, "args"));
  const argumentPayload: Record<string, unknown> = {};
  if (command) argumentPayload.command = command;
  if (args.length) argumentPayload.args = args;
  if (reason) argumentPayload.reason = reason;
  return [{
    id: "leaked_tool_call_0",
    name,
    arguments: JSON.stringify(argumentPayload),
  }];
}
