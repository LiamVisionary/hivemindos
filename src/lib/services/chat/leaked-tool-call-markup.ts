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

function parseLeakedArgumentObject(source: string): Record<string, unknown> {
  let index = source.indexOf("{");
  if (index < 0) return {};

  const skipWhitespace = () => {
    while (index < source.length && /\s/.test(source[index])) index += 1;
  };
  const parseString = () => {
    const quote = source[index];
    index += 1;
    let value = "";
    let escaped = false;
    while (index < source.length) {
      const char = source[index];
      index += 1;
      if (escaped) {
        value += ({ n: "\n", r: "\r", t: "\t" } as Record<string, string>)[char] ?? char;
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        break;
      } else {
        value += char;
      }
    }
    return value;
  };
  const parseBareValue = () => {
    const start = index;
    while (index < source.length && !/[,\]}\r\n]/.test(source[index])) index += 1;
    const value = source.slice(start, index).trim();
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
    return value;
  };
  const parseValue = (): unknown => {
    skipWhitespace();
    if (source[index] === "{") return parseObject();
    if (source[index] === "[") return parseArray();
    if (source[index] === "\"" || source[index] === "'") return parseString();
    return parseBareValue();
  };
  const parseArray = (): unknown[] => {
    const values: unknown[] = [];
    index += 1;
    while (index < source.length) {
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        break;
      }
      if (source[index] === ",") {
        index += 1;
        continue;
      }
      values.push(parseValue());
    }
    return values;
  };
  const parseObject = (): Record<string, unknown> => {
    const value: Record<string, unknown> = {};
    index += 1;
    while (index < source.length) {
      skipWhitespace();
      if (source[index] === "}") {
        index += 1;
        break;
      }
      if (source[index] === ",") {
        index += 1;
        continue;
      }
      const key = source[index] === "\"" || source[index] === "'"
        ? parseString()
        : (() => {
          const start = index;
          while (index < source.length && /[A-Za-z0-9_$-]/.test(source[index])) index += 1;
          return source.slice(start, index);
        })();
      skipWhitespace();
      if (!key || source[index] !== ":") break;
      index += 1;
      value[key] = parseValue();
    }
    return value;
  };

  return parseObject();
}

export function extractLeakedToolCalls(content: string): LeakedTextToolCall[] {
  if (!contentHasLeakedToolCallMarker(content)) return [];
  const normalized = normalizeLeakedToolCallMarkup(content);
  const nameMatch = /\bcall\s*:\s*([A-Za-z0-9_.-]+)/i.exec(normalized);
  const name = nameMatch?.[1]?.trim() ?? "";
  if (!name) return [];
  const argumentPayload = parseLeakedArgumentObject(normalized.slice((nameMatch?.index ?? 0) + (nameMatch?.[0]?.length ?? 0)));
  return [{
    id: "leaked_tool_call_0",
    name,
    arguments: JSON.stringify(argumentPayload),
  }];
}
