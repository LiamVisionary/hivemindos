import "server-only";

import { execFile } from "child_process";
import { promisify } from "util";
import { basename, resolve } from "path";
import {
  createVisualArtifact,
} from "@/lib/services/visual-artifacts";
import type {
  VisualArtifactBlock,
  VisualArtifactCreateInput,
} from "@/lib/types/visual-artifacts";

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_FILES = 80;
const MAX_DIFF_STAT_CHARS = 8_000;

export type VisualRecapInput = {
  cwd?: string;
  includeUntracked?: boolean;
  maxFiles?: number;
  title?: string;
  workBoardTaskId?: string;
  queenBeeRunId?: string;
  vaultPath?: string;
  save?: boolean;
};

export type VisualRecapResult = {
  cwd: string;
  changedFiles: string[];
  untrackedFiles: string[];
  artifactInput: VisualArtifactCreateInput;
  saved?: Awaited<ReturnType<typeof createVisualArtifact>>;
};

export async function buildVisualRecap(input: VisualRecapInput = {}): Promise<VisualRecapResult> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const maxFiles = normalizeMaxFiles(input.maxFiles);
  const [diffStat, changedFiles, untrackedFiles] = await Promise.all([
    gitOutput(cwd, ["diff", "--stat"]),
    gitLines(cwd, ["diff", "--name-only"]),
    input.includeUntracked ? gitLines(cwd, ["ls-files", "--others", "--exclude-standard"]) : Promise.resolve([]),
  ]);
  const visibleChanged = changedFiles.slice(0, maxFiles);
  const visibleUntracked = untrackedFiles.slice(0, Math.max(0, maxFiles - visibleChanged.length));
  const allFiles = [...visibleChanged, ...visibleUntracked];
  const artifactInput: VisualArtifactCreateInput = {
    kind: "recap",
    title: input.title ?? defaultTitle(cwd),
    workBoardTaskId: input.workBoardTaskId,
    queenBeeRunId: input.queenBeeRunId,
    projectPath: cwd,
    blocks: recapBlocks({
      diffStat,
      changedFiles: visibleChanged,
      untrackedFiles: visibleUntracked,
      omittedCount: Math.max(0, changedFiles.length + untrackedFiles.length - allFiles.length),
    }),
    vaultPath: input.vaultPath,
  };
  const saved = input.save ? await createVisualArtifact(artifactInput) : undefined;
  return {
    cwd,
    changedFiles: visibleChanged,
    untrackedFiles: visibleUntracked,
    artifactInput,
    saved,
  };
}

function recapBlocks(input: {
  diffStat: string;
  changedFiles: string[];
  untrackedFiles: string[];
  omittedCount: number;
}): VisualArtifactBlock[] {
  const allFiles = [...input.changedFiles, ...input.untrackedFiles];
  return [
    {
      type: "summary",
      markdown: [
        `Changed files: ${input.changedFiles.length}`,
        `Untracked files: ${input.untrackedFiles.length}`,
        input.omittedCount ? `Omitted by maxFiles cap: ${input.omittedCount}` : "",
      ].filter(Boolean).join("\n"),
    },
    {
      type: "file-tree",
      items: allFiles.map((path) => ({
        path,
        note: fileNote(path, input.untrackedFiles.includes(path)),
      })),
    },
    {
      type: "diff-summary",
      markdown: input.diffStat.trim()
        ? [
            "```text",
            input.diffStat.trim().slice(0, MAX_DIFF_STAT_CHARS),
            "```",
          ].join("\n")
        : "No tracked diff stat was returned.",
    },
    {
      type: "risk",
      markdown: riskSummary(allFiles),
    },
  ];
}

function fileNote(path: string, untracked: boolean) {
  const area = areaForPath(path);
  return `${untracked ? "Untracked" : "Modified"} ${area} file.`;
}

function areaForPath(path: string) {
  if (path.includes("/api/") || path.startsWith("src/app/api/")) return "API route";
  if (path.includes("/features/dashboard/") || path.endsWith(".tsx")) return "dashboard/UI";
  if (/wallet|crypto|payment|x402|bankr|trading/i.test(path)) return "wallet/payment";
  if (/test|spec/i.test(path) || path.startsWith("scripts/test-")) return "test";
  if (/docs?\//i.test(path) || path.endsWith(".md")) return "docs";
  return "project";
}

function riskSummary(files: string[]) {
  const risks = [
    files.some((path) => /wallet|crypto|payment|x402|bankr|trading/i.test(path))
      ? "- Wallet/payment files changed: review approval gates, server-side authority, and secret redaction."
      : "",
    files.some((path) => path.includes("/api/") || path.startsWith("src/app/api/"))
      ? "- API routes changed: verify auth, input validation, and route/action catalog coverage."
      : "",
    files.some((path) => path.endsWith(".tsx"))
      ? "- UI files changed: verify responsive layout, text wrapping, and durable-state rules."
      : "",
    files.some((path) => /test|spec/i.test(path) || path.startsWith("scripts/test-"))
      ? "- Test files changed: ensure the test exercises behavior, not only static strings."
      : "",
  ].filter(Boolean);
  return risks.length ? risks.join("\n") : "- No high-risk file families detected from paths alone.";
}

function defaultTitle(cwd: string) {
  return `Visual recap for ${basename(cwd) || "workspace"}`;
}

function normalizeMaxFiles(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MAX_FILES;
  return Math.min(300, Math.max(1, Math.trunc(numeric)));
}

async function gitOutput(cwd: string, args: string[]) {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.toString();
}

async function gitLines(cwd: string, args: string[]) {
  const output = await gitOutput(cwd, args);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
