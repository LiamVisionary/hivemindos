import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type Base64URLString,
  type CredentialDeviceType,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "node:path";

const STORE_VERSION = 1;
const CEREMONY_TTL_MS = 5 * 60_000;
const MAX_PASSKEYS = 24;
const RP_NAME = "HivemindOS Dashboard";

type StoredDashboardPasskey = {
  id: Base64URLString;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  rpId: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
};

type DashboardPasskeyStore = {
  version: typeof STORE_VERSION;
  passkeys: StoredDashboardPasskey[];
};

type PasskeyCeremony = {
  kind: "authentication" | "registration";
  challenge: string;
  origin: string;
  rpId: string;
  expiresAt: number;
};

type DashboardPasskeyStorageOptions = {
  storePath?: string;
};

export type DashboardPasskeySummary = {
  id: string;
  rpId: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  backedUp: boolean;
};

export type DashboardPasskeyRequestContext = {
  origin: string;
  rpId: string;
  secureContext: boolean;
};

type CeremonyGlobals = typeof globalThis & {
  __hivemindosDashboardPasskeyCeremonies?: Map<string, PasskeyCeremony>;
  __hivemindosDashboardPasskeyStoreQueue?: Promise<void>;
};

const ceremonyGlobals = globalThis as CeremonyGlobals;

function passkeyCeremonies() {
  ceremonyGlobals.__hivemindosDashboardPasskeyCeremonies ??= new Map();
  return ceremonyGlobals.__hivemindosDashboardPasskeyCeremonies;
}

function dashboardPasskeyStorePath(options?: DashboardPasskeyStorageOptions) {
  return options?.storePath ?? join(homedir(), ".hivemindos", "dashboard-passkeys.json");
}

function isLoopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  const ipv4 = host.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return Boolean(ipv4 && ipv4.slice(1).every((part) => Number(part) <= 255));
}

export function dashboardPasskeyRequestContext(request: Request): DashboardPasskeyRequestContext {
  const requestUrl = new URL(request.url);
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? `${forwardedProtocol}:`
    : requestUrl.protocol;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const url = new URL(`${protocol}//${forwardedHost || requestUrl.host}`);
  const rpId = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!rpId || rpId.length > 253 || /[\s/\\]/.test(rpId)) {
    throw new Error("The dashboard host cannot be used for device authentication.");
  }
  return {
    origin: url.origin,
    rpId,
    secureContext: url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(rpId)),
  };
}

function assertSecurePasskeyContext(context: DashboardPasskeyRequestContext) {
  if (!context.secureContext) {
    throw new Error("Face ID, Touch ID, and device passkeys require HTTPS or a localhost dashboard URL.");
  }
}

function cleanExpiredCeremonies(now = Date.now()) {
  for (const [id, ceremony] of passkeyCeremonies()) {
    if (ceremony.expiresAt <= now) passkeyCeremonies().delete(id);
  }
}

function rememberCeremony(kind: PasskeyCeremony["kind"], challenge: string, context: DashboardPasskeyRequestContext) {
  cleanExpiredCeremonies();
  const id = randomBytes(32).toString("base64url");
  passkeyCeremonies().set(id, {
    kind,
    challenge,
    origin: context.origin,
    rpId: context.rpId,
    expiresAt: Date.now() + CEREMONY_TTL_MS,
  });
  return id;
}

function consumeCeremony(id: string, kind: PasskeyCeremony["kind"], context: DashboardPasskeyRequestContext) {
  cleanExpiredCeremonies();
  const ceremony = passkeyCeremonies().get(id);
  if (id) passkeyCeremonies().delete(id);
  if (!ceremony || ceremony.kind !== kind || ceremony.expiresAt <= Date.now()) {
    throw new Error("The device-authentication request expired. Try again.");
  }
  if (ceremony.origin !== context.origin || ceremony.rpId !== context.rpId) {
    throw new Error("The device-authentication request does not match this dashboard address.");
  }
  return ceremony;
}

function validBase64Url(value: unknown, maxLength: number) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && /^[A-Za-z0-9_-]+$/.test(value);
}

const ALLOWED_TRANSPORTS = new Set<AuthenticatorTransportFuture>([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

function parseStoredPasskey(value: unknown): StoredDashboardPasskey | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<StoredDashboardPasskey>;
  if (!validBase64Url(record.id, 1024) || !validBase64Url(record.publicKey, 8192)) return null;
  if (!Number.isSafeInteger(record.counter) || (record.counter ?? -1) < 0) return null;
  if (record.deviceType !== "singleDevice" && record.deviceType !== "multiDevice") return null;
  if (typeof record.backedUp !== "boolean") return null;
  if (typeof record.rpId !== "string" || !record.rpId || record.rpId.length > 253 || /[\s/\\]/.test(record.rpId)) return null;
  if (typeof record.label !== "string" || !record.label.trim() || record.label.length > 80) return null;
  if (typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) return null;
  if (record.lastUsedAt !== undefined && (typeof record.lastUsedAt !== "string" || !Number.isFinite(Date.parse(record.lastUsedAt)))) return null;
  const transports = Array.isArray(record.transports)
    ? record.transports.filter((transport): transport is AuthenticatorTransportFuture => ALLOWED_TRANSPORTS.has(transport))
    : undefined;
  return {
    id: record.id as Base64URLString,
    publicKey: record.publicKey as string,
    counter: record.counter as number,
    deviceType: record.deviceType,
    backedUp: record.backedUp,
    rpId: record.rpId.toLowerCase(),
    label: record.label.trim(),
    createdAt: record.createdAt,
    ...(record.lastUsedAt ? { lastUsedAt: record.lastUsedAt } : {}),
    ...(transports?.length ? { transports } : {}),
  };
}

async function readPasskeyStore(options?: DashboardPasskeyStorageOptions): Promise<DashboardPasskeyStore> {
  const path = dashboardPasskeyStorePath(options);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: STORE_VERSION, passkeys: [] };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Dashboard passkey store is not valid JSON: ${path}`);
  }
  if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== STORE_VERSION) {
    throw new Error(`Dashboard passkey store has an unsupported format: ${path}`);
  }
  const rawPasskeys = (parsed as { passkeys?: unknown }).passkeys;
  if (!Array.isArray(rawPasskeys)) throw new Error(`Dashboard passkey store is missing its passkey list: ${path}`);
  const passkeys = rawPasskeys.map(parseStoredPasskey);
  if (passkeys.some((passkey) => !passkey)) {
    throw new Error(`Dashboard passkey store contains an invalid credential: ${path}`);
  }
  return { version: STORE_VERSION, passkeys: passkeys as StoredDashboardPasskey[] };
}

async function writePasskeyStore(store: DashboardPasskeyStore, options?: DashboardPasskeyStorageOptions) {
  const path = dashboardPasskeyStorePath(options);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function withPasskeyStoreLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = ceremonyGlobals.__hivemindosDashboardPasskeyStoreQueue ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  ceremonyGlobals.__hivemindosDashboardPasskeyStoreQueue = result.then(() => undefined, () => undefined);
  return result;
}

function publicSummary(passkey: StoredDashboardPasskey): DashboardPasskeySummary {
  return {
    id: passkey.id,
    rpId: passkey.rpId,
    label: passkey.label,
    createdAt: passkey.createdAt,
    ...(passkey.lastUsedAt ? { lastUsedAt: passkey.lastUsedAt } : {}),
    backedUp: passkey.backedUp,
  };
}

function deviceLabel(userAgent: string) {
  if (/iphone|ipad/i.test(userAgent)) return "Apple mobile device";
  if (/macintosh|mac os/i.test(userAgent)) return "Mac";
  if (/windows/i.test(userAgent)) return "Windows device";
  if (/android/i.test(userAgent)) return "Android device";
  if (/linux/i.test(userAgent)) return "Linux device";
  return "Device passkey";
}

export async function listDashboardPasskeys(options?: DashboardPasskeyStorageOptions) {
  const store = await readPasskeyStore(options);
  return store.passkeys.map(publicSummary);
}

export async function dashboardPasskeyStatus(request: Request, options?: DashboardPasskeyStorageOptions) {
  const context = dashboardPasskeyRequestContext(request);
  const store = await readPasskeyStore(options);
  return {
    available: store.passkeys.some((passkey) => passkey.rpId === context.rpId),
    secureContext: context.secureContext,
  };
}

export async function beginDashboardPasskeyRegistration(
  request: Request,
  options?: DashboardPasskeyStorageOptions,
): Promise<{ ceremonyId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const context = dashboardPasskeyRequestContext(request);
  assertSecurePasskeyContext(context);
  const store = await readPasskeyStore(options);
  const passkeys = store.passkeys.filter((passkey) => passkey.rpId === context.rpId);
  const userID = Uint8Array.from(createHash("sha256").update(`hivemindos-dashboard:${context.rpId}`).digest());
  const registrationOptions = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: context.rpId,
    userName: "Local dashboard owner",
    userDisplayName: "Local dashboard owner",
    userID,
    attestationType: "none",
    timeout: 60_000,
    excludeCredentials: passkeys.map((passkey) => ({ id: passkey.id, transports: passkey.transports })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
  });
  return {
    ceremonyId: rememberCeremony("registration", registrationOptions.challenge, context),
    options: registrationOptions,
  };
}

export async function finishDashboardPasskeyRegistration(input: {
  ceremonyId: string;
  request: Request;
  response: RegistrationResponseJSON;
  storage?: DashboardPasskeyStorageOptions;
}) {
  const context = dashboardPasskeyRequestContext(input.request);
  assertSecurePasskeyContext(context);
  const ceremony = consumeCeremony(input.ceremonyId, "registration", context);
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: ceremony.origin,
    expectedRPID: ceremony.rpId,
    requireUserPresence: true,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo?.userVerified) {
    throw new Error("The device did not complete user verification.");
  }
  const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo;
  const now = new Date().toISOString();
  const record: StoredDashboardPasskey = {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    ...(credential.transports?.length ? { transports: credential.transports } : {}),
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    rpId: context.rpId,
    label: deviceLabel(input.request.headers.get("user-agent") ?? ""),
    createdAt: now,
  };
  await withPasskeyStoreLock(async () => {
    const store = await readPasskeyStore(input.storage);
    if (store.passkeys.some((passkey) => passkey.id === record.id)) {
      throw new Error("This device passkey is already registered.");
    }
    if (store.passkeys.length >= MAX_PASSKEYS) {
      throw new Error(`Remove an existing device passkey before adding another (maximum ${MAX_PASSKEYS}).`);
    }
    store.passkeys.push(record);
    await writePasskeyStore(store, input.storage);
  });
  return publicSummary(record);
}

export async function beginDashboardPasskeyAuthentication(
  request: Request,
  options?: DashboardPasskeyStorageOptions,
): Promise<{ ceremonyId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const context = dashboardPasskeyRequestContext(request);
  assertSecurePasskeyContext(context);
  const store = await readPasskeyStore(options);
  const passkeys = store.passkeys.filter((passkey) => passkey.rpId === context.rpId);
  if (!passkeys.length) throw new Error("No device passkey is registered for this dashboard address.");
  const authenticationOptions = await generateAuthenticationOptions({
    rpID: context.rpId,
    timeout: 60_000,
    userVerification: "required",
    allowCredentials: passkeys.map((passkey) => ({ id: passkey.id, transports: passkey.transports })),
  });
  return {
    ceremonyId: rememberCeremony("authentication", authenticationOptions.challenge, context),
    options: authenticationOptions,
  };
}

export async function finishDashboardPasskeyAuthentication(input: {
  ceremonyId: string;
  request: Request;
  response: AuthenticationResponseJSON;
  storage?: DashboardPasskeyStorageOptions;
}) {
  const context = dashboardPasskeyRequestContext(input.request);
  assertSecurePasskeyContext(context);
  const ceremony = consumeCeremony(input.ceremonyId, "authentication", context);
  const store = await readPasskeyStore(input.storage);
  const passkey = store.passkeys.find((candidate) => candidate.id === input.response.id && candidate.rpId === context.rpId);
  if (!passkey) throw new Error("The selected device passkey is not registered for this dashboard.");
  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: ceremony.origin,
    expectedRPID: ceremony.rpId,
    requireUserVerification: true,
    credential: {
      id: passkey.id,
      publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64url")),
      counter: passkey.counter,
      transports: passkey.transports,
    },
  });
  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    throw new Error("The device did not complete user verification.");
  }
  const usedAt = new Date().toISOString();
  await withPasskeyStoreLock(async () => {
    const latest = await readPasskeyStore(input.storage);
    const current = latest.passkeys.find((candidate) => candidate.id === passkey.id && candidate.rpId === context.rpId);
    if (!current) throw new Error("The device passkey was removed during authentication.");
    current.counter = verification.authenticationInfo.newCounter;
    current.lastUsedAt = usedAt;
    await writePasskeyStore(latest, input.storage);
  });
  return { passkey: publicSummary({ ...passkey, counter: verification.authenticationInfo.newCounter, lastUsedAt: usedAt }) };
}

export async function removeDashboardPasskey(id: string, options?: DashboardPasskeyStorageOptions) {
  if (!validBase64Url(id, 1024)) throw new Error("A valid device passkey id is required.");
  return withPasskeyStoreLock(async () => {
    const store = await readPasskeyStore(options);
    const next = store.passkeys.filter((passkey) => passkey.id !== id);
    if (next.length === store.passkeys.length) return false;
    await writePasskeyStore({ version: STORE_VERSION, passkeys: next }, options);
    return true;
  });
}
