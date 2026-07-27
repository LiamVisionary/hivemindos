export type ChatArtifactTargetKind = "file" | "url";

export type ChatCompletionArtifact = {
  label: string;
  target: string;
  kind: ChatArtifactTargetKind;
};

export type ChatCompletionReceipt = {
  label: string;
  status: "passed" | "failed" | "skipped" | "unknown";
  summary: string;
  evidence: string[];
};

export type ChatCompletionVerification = {
  command: string;
  output: string;
  summary: string;
};

export type ChatCompletionPresentation = {
  taskId: string;
  artifacts: ChatCompletionArtifact[];
  evidence: string[];
  remainingMarkdown: string;
  receipts: ChatCompletionReceipt[];
  verification: ChatCompletionVerification | null;
  rawText: string;
};

type ParsedSection = {
  title: string;
  lines: string[];
};

const SECTION_HEADING_PATTERN = /^([A-Za-z][A-Za-z0-9 /&+()_-]{1,52}):\s*(.*)$/;
const BULLET_PATTERN = /^\s*[-*]\s+(.+)$/;
const LOOP_RECEIPTS_PATTERN = /```loop-receipts\s*\n([\s\S]*?)```/i;
const WORK_BOARD_COMPLETION_PATTERN = /^Completed Work Board task\s+([A-Za-z0-9_-]+)\b[^\n]*$/i;

function trimMarkdownCode(value: string) {
  return value.trim().replace(/^`+|`+$/g, "").trim();
}

export function chatArtifactTargetKind(value: string): ChatArtifactTargetKind | null {
  const target = trimMarkdownCode(value);
  if (/^https?:\/\//i.test(target)) return "url";
  if (/^(?:\/|~\/|[A-Za-z]:[\\/])/.test(target)) return "file";
  return null;
}

export function chatArtifactDisplayName(value: string) {
  const target = trimMarkdownCode(value).replace(/[\\/]+$/, "");
  if (!target) return "Artifact";
  if (/^https?:\/\//i.test(target)) {
    try {
      const url = new URL(target);
      return decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || url.hostname);
    } catch {
      return target;
    }
  }
  return target.split(/[\\/]/).filter(Boolean).at(-1) || target;
}

function sectionKind(title: string) {
  const normalized = title.toLowerCase();
  if (/test output|verification|checks? run|test results?/.test(normalized)) return "verification";
  if (/deliverable|artifacts?|files?|links?|receipts?/.test(normalized)) return "artifacts";
  if (/evidence|findings?|outcome|governance|results?|what changed/.test(normalized)) return "evidence";
  return "other";
}

function splitSections(value: string) {
  const sections: ParsedSection[] = [];
  let current: ParsedSection = { title: "", lines: [] };

  const pushCurrent = () => {
    const lines = [...current.lines];
    while (lines[0]?.trim() === "") lines.shift();
    while (lines.at(-1)?.trim() === "") lines.pop();
    if (current.title || lines.length) sections.push({ title: current.title, lines });
  };

  for (const line of value.split("\n")) {
    const heading = SECTION_HEADING_PATTERN.exec(line);
    if (heading && !/^\s/.test(line) && !BULLET_PATTERN.test(line)) {
      pushCurrent();
      current = { title: heading[1].trim(), lines: heading[2] ? [heading[2]] : [] };
      continue;
    }
    current.lines.push(line);
  }
  pushCurrent();
  return sections;
}

function parseArtifactLines(lines: string[]) {
  const artifacts: ChatCompletionArtifact[] = [];
  const remainder: string[] = [];
  let index = 0;

  const addArtifact = (label: string, targetValue: string) => {
    const target = trimMarkdownCode(targetValue);
    const kind = chatArtifactTargetKind(target);
    if (!kind) return false;
    artifacts.push({
      label: label.trim().replace(/:\s*$/, "") || "Artifact",
      target,
      kind,
    });
    return true;
  };

  while (index < lines.length) {
    const line = lines[index];
    const bullet = BULLET_PATTERN.exec(line)?.[1]?.trim() ?? "";
    const inlinePair = /^(.+?):\s+(.+)$/.exec(bullet || line.trim());
    if (inlinePair && addArtifact(inlinePair[1], inlinePair[2])) {
      index += 1;
      continue;
    }

    const label = /^(.*?):\s*$/.exec(bullet || line.trim())?.[1]?.trim();
    if (label) {
      let nextIndex = index + 1;
      while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex += 1;
      const nextTarget = nextIndex < lines.length
        ? (BULLET_PATTERN.exec(lines[nextIndex])?.[1] ?? lines[nextIndex])
        : "";
      if (nextTarget && addArtifact(label, nextTarget)) {
        index = nextIndex + 1;
        continue;
      }
    }

    if (chatArtifactTargetKind(bullet || line.trim())) {
      addArtifact("Artifact", bullet || line);
      index += 1;
      continue;
    }

    remainder.push(line);
    index += 1;
  }

  return { artifacts, remainder };
}

function parseEvidenceLines(lines: string[]) {
  const evidence: string[] = [];
  const remainder: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bullet = BULLET_PATTERN.exec(line)?.[1]?.trim();
    if (bullet) evidence.push(bullet);
    else remainder.push(trimmed);
  }
  return { evidence, remainder };
}

function verificationSummary(output: string) {
  const ran = /\bRan\s+(\d+)\s+tests?\b/i.exec(output);
  if (ran && /(?:^|\n)OK\s*$/im.test(output)) return `${ran[1]} tests passed`;
  const tests = /\bTests?:\s+(?:(\d+)\s+passed|passed\s+(\d+))/i.exec(output);
  if (tests) return `${tests[1] || tests[2]} tests passed`;
  if (/\b(?:passed|success|ok)\b/i.test(output)) return "Verification passed";
  return "Verification output";
}

function parseVerification(lines: string[]): ChatCompletionVerification | null {
  const clean = lines.map((line) => line.trimEnd());
  while (!clean[0]?.trim()) clean.shift();
  while (!clean.at(-1)?.trim()) clean.pop();
  if (!clean.length) return null;
  const command = clean.shift()?.trim() ?? "";
  const output = clean.join("\n").trim();
  return {
    command,
    output,
    summary: verificationSummary(`${command}\n${output}`),
  };
}

function parseReceiptStatus(value: unknown): ChatCompletionReceipt["status"] {
  return value === "passed" || value === "failed" || value === "skipped" ? value : "unknown";
}

function receiptLabel(gateId: unknown, status: ChatCompletionReceipt["status"]) {
  const normalizedGate = typeof gateId === "string" ? gateId.toLowerCase() : "";
  const suffix = status === "passed" ? "verified" : status === "failed" ? "failed" : status === "skipped" ? "skipped" : "receipt";
  if (/(?:^|-)outcome(?:-|$)/.test(normalizedGate)) return `Outcome ${suffix}`;
  if (/(?:^|-)learning(?:-|$)/.test(normalizedGate)) return `Learning ${suffix}`;
  if (/(?:^|-)governance(?:-|$)/.test(normalizedGate)) return `Governance ${suffix}`;
  return status === "passed" ? "Gate verified" : `Gate ${suffix}`;
}

function parseReceipts(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): ChatCompletionReceipt[] => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const summary = typeof record.summary === "string" ? record.summary.trim() : "";
      const status = parseReceiptStatus(record.status);
      const evidence = Array.isArray(record.evidence)
        ? record.evidence.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        : [];
      return [{
        label: receiptLabel(record.gateId, status),
        status,
        summary: summary || "Verification receipt",
        evidence,
      }];
    });
  } catch {
    return [];
  }
}

function markdownForSections(sections: ParsedSection[]) {
  return sections
    .flatMap((section) => [section.title ? `### ${section.title}` : "", ...section.lines, ""])
    .join("\n")
    .trim();
}

export function parseChatCompletionPresentation(text: string): ChatCompletionPresentation | null {
  const rawText = text.replace(/\r\n?/g, "\n").trim();
  const firstLine = rawText.split("\n", 1)[0] ?? "";
  const completion = WORK_BOARD_COMPLETION_PATTERN.exec(firstLine);
  if (!completion) return null;

  const receiptBlock = LOOP_RECEIPTS_PATTERN.exec(rawText);
  const receipts = receiptBlock ? parseReceipts(receiptBlock[1].trim()) : [];
  const withoutReceipts = rawText.replace(LOOP_RECEIPTS_PATTERN, "").trim();
  const body = withoutReceipts.slice(firstLine.length).trim();
  const artifacts: ChatCompletionArtifact[] = [];
  const evidence: string[] = [];
  const remainingSections: ParsedSection[] = [];
  let verification: ChatCompletionVerification | null = null;

  for (const section of splitSections(body)) {
    const kind = sectionKind(section.title);
    if (kind === "verification") {
      verification ??= parseVerification(section.lines);
      continue;
    }
    if (kind === "artifacts") {
      const parsed = parseArtifactLines(section.lines);
      artifacts.push(...parsed.artifacts);
      if (parsed.remainder.some((line) => line.trim())) {
        remainingSections.push({ title: section.title, lines: parsed.remainder });
      }
      continue;
    }
    if (kind === "evidence") {
      const parsed = parseEvidenceLines(section.lines);
      evidence.push(...parsed.evidence);
      if (parsed.remainder.length) {
        evidence.push(...parsed.remainder);
      }
      continue;
    }
    if (section.lines.some((line) => line.trim())) remainingSections.push(section);
  }

  return {
    taskId: completion[1],
    artifacts,
    evidence,
    remainingMarkdown: markdownForSections(remainingSections),
    receipts,
    verification,
    rawText,
  };
}
