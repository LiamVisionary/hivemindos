type ParsedSemver = [number, number, number];

function parseSemver(version: string): ParsedSemver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? match.slice(1).map(Number) as ParsedSemver : null;
}

function compareSemver(left: ParsedSemver, right: ParsedSemver) {
  return (left[0] - right[0]) || (left[1] - right[1]) || (left[2] - right[2]);
}

export function isAppSemver(version: string) {
  return parseSemver(version) !== null;
}

export function effectiveAppVersion(...candidates: string[]) {
  let bestVersion = "0.0.0";
  let best = parseSemver(bestVersion) as ParsedSemver;
  for (const candidate of candidates) {
    const parsed = parseSemver(candidate);
    if (parsed && compareSemver(parsed, best) > 0) {
      bestVersion = candidate;
      best = parsed;
    }
  }
  return bestVersion;
}
