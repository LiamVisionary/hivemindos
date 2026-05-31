import { createPublicKey, verify, type JsonWebKey } from "crypto";
import { normalizeGitHubRepository } from "./github";

export type AeonBrainRunIdentity = {
  repository: string;
  eventName: string;
  ref: string;
  actor: string;
  runId: string;
  workflow: string;
  source: "github-oidc" | "local";
};

type GitHubOidcClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  repository?: string;
  event_name?: string;
  ref?: string;
  actor?: string;
  run_id?: string | number;
  workflow?: string;
};

type JwksResponse = {
  keys?: JsonWebKey[];
};

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";
let jwksCache: { expiresAt: number; keys: JsonWebKey[] } | undefined;

export async function authenticateAeonBrainRequest(request: Request, body: unknown): Promise<AeonBrainRunIdentity> {
  const localIdentity = authenticateLocalRequest(request, body);
  if (localIdentity) return localIdentity;

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error("Missing GitHub Actions OIDC bearer token."), { status: 401 });
  return verifyGitHubOidcToken(match[1]);
}

async function verifyGitHubOidcToken(token: string): Promise<AeonBrainRunIdentity> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw Object.assign(new Error("Malformed GitHub Actions OIDC token."), { status: 401 });
  }

  const header = parseJson<{ alg?: string; kid?: string }>(encodedHeader);
  if (header.alg !== "RS256" || !header.kid) {
    throw Object.assign(new Error("Unsupported GitHub Actions OIDC token signature."), { status: 401 });
  }

  const claims = parseJson<GitHubOidcClaims>(encodedPayload);
  validateClaims(claims);

  const key = (await getGitHubJwks()).find((candidate) => candidate.kid === header.kid);
  if (!key) throw Object.assign(new Error("GitHub Actions OIDC signing key was not found."), { status: 401 });

  const signatureValid = verify(
    "RSA-SHA256",
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    createPublicKey({ key, format: "jwk" }),
    Uint8Array.from(base64UrlBuffer(encodedSignature)),
  );
  if (!signatureValid) throw Object.assign(new Error("GitHub Actions OIDC token signature is invalid."), { status: 401 });

  return identityFromClaims(claims, "github-oidc");
}

function authenticateLocalRequest(request: Request, body: unknown): AeonBrainRunIdentity | null {
  const token = process.env.HIVE_AEON_BRAIN_LOCAL_TOKEN?.trim();
  if (!token) return null;
  if (request.headers.get("x-hive-aeon-local-token") !== token) return null;
  const identity = typeof body === "object" && body ? (body as { identity?: Partial<AeonBrainRunIdentity> }).identity : undefined;
  if (!identity?.repository) throw Object.assign(new Error("Local AEON brain identity requires repository."), { status: 400 });
  return {
    repository: normalizeGitHubRepository(identity.repository),
    eventName: identity.eventName || "local",
    ref: identity.ref || "",
    actor: identity.actor || "local",
    runId: identity.runId || `local-${Date.now()}`,
    workflow: identity.workflow || "local",
    source: "local",
  };
}

function validateClaims(claims: GitHubOidcClaims) {
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== GITHUB_OIDC_ISSUER) {
    throw Object.assign(new Error("OIDC token issuer is not GitHub Actions."), { status: 401 });
  }
  const audience = process.env.HIVE_AEON_BRAIN_OIDC_AUDIENCE?.trim() || "hivemindos-aeon-brain";
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud].filter(Boolean);
  if (!audiences.includes(audience)) {
    throw Object.assign(new Error("OIDC token audience is not allowed for AEON brain access."), { status: 401 });
  }
  if (typeof claims.exp !== "number" || claims.exp <= now) {
    throw Object.assign(new Error("OIDC token is expired."), { status: 401 });
  }
  if (typeof claims.nbf === "number" && claims.nbf > now + 30) {
    throw Object.assign(new Error("OIDC token is not valid yet."), { status: 401 });
  }
  if (!claims.repository) {
    throw Object.assign(new Error("OIDC token is missing the GitHub repository claim."), { status: 401 });
  }
}

function identityFromClaims(claims: GitHubOidcClaims, source: AeonBrainRunIdentity["source"]): AeonBrainRunIdentity {
  return {
    repository: normalizeGitHubRepository(claims.repository ?? ""),
    eventName: claims.event_name || "unknown",
    ref: claims.ref || "",
    actor: claims.actor || "unknown",
    runId: String(claims.run_id || "unknown-run"),
    workflow: claims.workflow || "unknown-workflow",
    source,
  };
}

async function getGitHubJwks() {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(GITHUB_JWKS_URL, { cache: "no-store" });
  if (!response.ok) throw Object.assign(new Error("Could not fetch GitHub Actions OIDC signing keys."), { status: 503 });
  const payload = await response.json().catch(() => null) as JwksResponse | null;
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  jwksCache = { keys, expiresAt: Date.now() + 60 * 60 * 1000 };
  return keys;
}

function parseJson<T>(encoded: string): T {
  return JSON.parse(base64UrlBuffer(encoded).toString("utf8")) as T;
}

function base64UrlBuffer(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}
