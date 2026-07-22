import { existsSync, statSync } from "node:fs";
import { isAbsolute, normalize, resolve, sep } from "node:path";

const PATH_PATTERN = /(?:^|[\s`"'])([A-Za-z0-9_.-]+\/(?:[A-Za-z0-9_@+., -]+\/)*[A-Za-z0-9_@+., -]+\.[A-Za-z0-9]+)(?=$|[\s`"',;:)\]])/g;

export function gradeBenchmarkOutcome({ scenario, content, root }) {
  const contract = scenario?.e2e?.outcome;
  if (!contract) {
    return { ok: false, score: 0, evidence: [], error: "No accepted-outcome contract is defined for this scenario." };
  }
  const parsed = parseJsonObject(content);
  if (!parsed) return { ok: false, score: 0, evidence: [], error: "The response was not valid JSON." };
  if (contract.kind === "repository-paths") return gradeRepositoryPaths({ contract, parsed, content, root });
  if (contract.kind === "required-patterns") return gradeRequiredPatterns({ contract, content });
  return { ok: false, score: 0, evidence: [], error: `Unsupported outcome contract: ${contract.kind}` };
}

export function gradeRepositoryPaths({ contract, parsed, content, root }) {
  const claimed = uniqueStrings([
    ...(Array.isArray(parsed.files) ? parsed.files : []),
    ...extractPathClaims(String(parsed.answer ?? "")),
    ...extractPathClaims(content),
  ]).filter((path) => pathLooksRepositoryRelative(path));
  const unsafePaths = claimed.filter((path) => !safeRepositoryPath(root, path));
  const safePaths = claimed.filter((path) => safeRepositoryPath(root, path));
  const existingPaths = safePaths.filter((path) => existsSync(resolve(root, path)) && statSync(resolve(root, path)).isFile());
  const missingPaths = safePaths.filter((path) => !existingPaths.includes(path));
  const minimumPaths = positiveInteger(contract.minimumPaths) ?? 1;
  const minimumExistingRatio = boundedRatio(contract.minimumExistingRatio, 1);
  const ratio = safePaths.length ? existingPaths.length / safePaths.length : 0;
  const requiredOwners = uniqueStrings(contract.requiredOwners ?? []);
  const missingOwners = requiredOwners.filter((owner) => !existingPaths.some((path) => path === owner || path.startsWith(`${owner.replace(/\/$/, "")}/`)));
  const ok = safePaths.length >= minimumPaths
    && ratio >= minimumExistingRatio
    && unsafePaths.length === 0
    && missingOwners.length === 0;
  return {
    ok,
    score: round(ratio),
    claimedPaths: safePaths,
    existingPaths,
    missingPaths,
    unsafePaths,
    missingOwners,
    evidence: [
      `${existingPaths.length}/${safePaths.length} claimed repository paths exist (${(ratio * 100).toFixed(1)}%).`,
      missingPaths.length ? `Missing paths: ${missingPaths.join(", ")}` : "All claimed paths exist.",
      missingOwners.length ? `Missing required owners: ${missingOwners.join(", ")}` : "Required architecture owners were identified.",
    ],
    error: ok
      ? undefined
      : safePaths.length < minimumPaths
        ? `The response named ${safePaths.length} repository paths; at least ${minimumPaths} are required.`
        : unsafePaths.length
          ? "The response contained unsafe or non-repository paths."
          : missingOwners.length
            ? "The response missed required architecture owners."
            : `Only ${(ratio * 100).toFixed(1)}% of claimed paths exist; ${(minimumExistingRatio * 100).toFixed(1)}% is required.`,
  };
}

export function gradeRequiredPatterns({ contract, content }) {
  const required = uniqueStrings(contract.patterns ?? []);
  const normalized = content.toLowerCase();
  const matched = required.filter((pattern) => normalized.includes(pattern.toLowerCase()));
  const minimumRatio = boundedRatio(contract.minimumRatio, 1);
  const ratio = required.length ? matched.length / required.length : 0;
  const ok = required.length > 0 && ratio >= minimumRatio;
  return {
    ok,
    score: round(ratio),
    matchedPatterns: matched,
    missingPatterns: required.filter((pattern) => !matched.includes(pattern)),
    evidence: [`Matched ${matched.length}/${required.length} required outcome facts.`],
    error: ok ? undefined : `Only ${(ratio * 100).toFixed(1)}% of required outcome facts were present.`,
  };
}

export function extractPathClaims(content) {
  const paths = [];
  for (const match of content.matchAll(PATH_PATTERN)) paths.push(match[1].trim());
  return uniqueStrings(paths);
}

function parseJsonObject(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function pathLooksRepositoryRelative(path) {
  return typeof path === "string"
    && path.includes("/")
    && !path.includes("://")
    && !isAbsolute(path)
    && !path.startsWith("~");
}

function safeRepositoryPath(root, path) {
  if (!pathLooksRepositoryRelative(path) || path.includes("\0")) return false;
  const normalized = normalize(path);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) return false;
  const absolute = resolve(root, normalized);
  const rootPrefix = `${resolve(root)}${sep}`;
  return absolute.startsWith(rootPrefix);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function boundedRatio(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}
