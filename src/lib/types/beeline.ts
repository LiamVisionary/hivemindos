export const BEELINE_RELATIONSHIPS = [
  "parent",
  "child",
  "partner",
  "sibling",
  "grandparent",
  "relative",
  "friend",
  "other",
] as const;

export type BeelineRelationship = (typeof BEELINE_RELATIONSHIPS)[number];

export const BEELINE_CAPABILITIES = [
  "browser",
  "calendar",
  "healthcare",
  "messaging",
  "shopping",
  "travel",
] as const;

export type BeelineCapability = (typeof BEELINE_CAPABILITIES)[number];

export type BeelineConsentStatus = "pending" | "confirmed" | "revoked";

export type BeelineConsent = {
  status: BeelineConsentStatus;
  confirmedAt?: string;
  revokedAt?: string;
};

export type BeelinePasswordManager =
  | "none"
  | "chrome"
  | "bitwarden"
  | "keepassxc"
  | "other";

export type BeelineBrowserBinding = {
  browserId: "chrome";
  profileDirectory: string;
  profileName: string;
  passwordManager: BeelinePasswordManager;
  automationMode: "manual-first" | "trusted-agent";
};

export type BeelineConnectionReference = {
  id: string;
  kind: "oauth" | "mcp" | "login";
  providerId: string;
  label: string;
  status: "setup-required";
};

export type BeelineBrokerConnection = {
  id: string;
  profileId: string;
  provider: "google-calendar" | "mcp";
  label: string;
  capability: BeelineCapability;
  remoteIdentity?: string | null;
  endpointOrigin?: string | null;
  auth: "oauth" | "bearer" | "none";
  createdAt: string;
  updatedAt: string;
};

export type BeelineLocalCredentialKind = "login" | "http-header";
export type BeelineLocalCredentialUseMode = "flexible" | "restricted";

export type BeelineLocalCredential = {
  id: string;
  profileId: string;
  label: string;
  kind: BeelineLocalCredentialKind;
  origin: string;
  agentUseMode: BeelineLocalCredentialUseMode;
  allowedHttpMethods: string[];
  headerName?: string;
  headerPrefix?: string;
  createdAt: string;
  updatedAt: string;
};

export type BeelineLocalCredentialStoreInput = {
  profileId: string;
  label: string;
  kind: BeelineLocalCredentialKind;
  origin: string;
  agentUseMode?: BeelineLocalCredentialUseMode;
  allowedHttpMethods?: string[];
  headerName?: string;
  headerPrefix?: string;
  username?: string;
  password?: string;
  token?: string;
};

export type BeelineLocalCredentialUseInput = {
  profileId: string;
  credentialId?: string;
  usage: "browser-login" | "http";
  destinationUrl: string;
  capability: BeelineCapability;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  usernameElement?: number;
  passwordElement?: number;
  submitElement?: number;
  confirmation?: "CONFIRM_BEELINE_LOCAL_CREDENTIAL";
};

export type BeelineProfile = {
  id: string;
  displayName: string;
  relationship: BeelineRelationship;
  aliases: string[];
  capabilities: BeelineCapability[];
  consent: BeelineConsent;
  browserBinding?: BeelineBrowserBinding;
  connections: BeelineConnectionReference[];
  createdAt: string;
  updatedAt: string;
};

export type BeelineProfilesFile = {
  version: 1;
  profiles: BeelineProfile[];
  updatedAt: string;
};

export type BeelineProfileResolution =
  | { status: "no-match"; profile?: undefined; matches: [] }
  | { status: "matched"; profile: BeelineProfile; matches: BeelineProfile[] }
  | { status: "ambiguous"; profile?: undefined; matches: BeelineProfile[] };

export type BeelineProfileCreateInput = {
  displayName: string;
  relationship: BeelineRelationship;
  aliases?: string[];
  capabilities?: BeelineCapability[];
};

export type BeelineProfileUpdateInput = Partial<Pick<
  BeelineProfile,
  "displayName" | "relationship" | "aliases" | "capabilities" | "browserBinding"
>> & {
  consentStatus?: BeelineConsentStatus;
};
