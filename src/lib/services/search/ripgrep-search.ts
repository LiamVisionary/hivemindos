import "server-only";

import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";

// Strict search policy: content scans use ripgrep first, plain grep as the
// fallback, and only fall back to a full fs walk (caller-side) when neither
// binary is available. Returning `null` signals "no search binary" so callers
// keep their existing walk behavior.

const execFileAsync = promisify(execFile);
const SEARCH_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const SEARCH_TIMEOUT_MS = 10_000;
const EXCLUDED_DIRS = [".git", ".obsidian", ".trash", ".hivemindos-transfers", "node_modules"];

let ripgrepAvailability: Promise<boolean> | null = null;
let grepAvailability: Promise<boolean> | null = null;

async function binaryAvailable(binary: string) {
  try {
    await execFileAsync(binary, ["--version"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export function ripgrepAvailable() {
  ripgrepAvailability ??= binaryAvailable("rg");
  return ripgrepAvailability;
}

function grepAvailable() {
  grepAvailability ??= binaryAvailable("grep");
  return grepAvailability;
}

function escapeRegex(term: string) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function searchTermsFromQuery(query?: string) {
  if (!query?.trim()) return [];
  return [...new Set(
    query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3),
  )].slice(0, 16);
}

type ListMatchingFilesOptions = {
  root: string;
  terms: string[];
  glob?: string;
  maxResults?: number;
};

async function runFileListSearch(binary: string, args: string[], root: string) {
  try {
    const { stdout } = await execFileAsync(binary, args, {
      cwd: root,
      timeout: SEARCH_TIMEOUT_MS,
      maxBuffer: SEARCH_MAX_BUFFER_BYTES,
    });
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    // Exit code 1 means "no matches" for both rg and grep.
    if ((error as { code?: number | string })?.code === 1) return [];
    return null;
  }
}

/**
 * Lists files under `root` whose content matches any of `terms`
 * (case-insensitive). Tries ripgrep, then grep. Returns absolute paths, or
 * `null` when neither binary worked so the caller can fall back to a walk.
 */
export async function listFilesMatchingTerms(options: ListMatchingFilesOptions): Promise<string[] | null> {
  const { root, terms, glob = "*.md", maxResults = 2_000 } = options;
  if (!terms.length) return null;
  const pattern = terms.map(escapeRegex).join("|");

  if (await ripgrepAvailable()) {
    const args = [
      "-li", "--no-messages", "--no-ignore-vcs",
      "-g", glob,
      ...EXCLUDED_DIRS.flatMap((dir) => ["-g", `!${dir}/**`]),
      "-e", pattern,
      ".",
    ];
    const files = await runFileListSearch("rg", args, root);
    if (files) return files.slice(0, maxResults).map((file) => join(root, file));
  }

  if (await grepAvailable()) {
    const args = [
      "-rli", "-E", pattern,
      `--include=${glob}`,
      ...EXCLUDED_DIRS.map((dir) => `--exclude-dir=${dir}`),
      ".",
    ];
    const files = await runFileListSearch("grep", args, root);
    if (files) return files.slice(0, maxResults).map((file) => join(root, file));
  }

  return null;
}
