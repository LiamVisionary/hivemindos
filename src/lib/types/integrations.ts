export type ConnectionProviderKey = "github" | "linear" | "slack" | "notion" | "google" | "google-cloud" | "posthog" | "plausible" | "clawbank";

export type ConnectionProviderStatus = {
  key: ConnectionProviderKey;
  label: string;
  detail: string;
  /** A credential for this app is saved in the shared hive env. */
  connected: boolean;
  /** The saved credential passed a live check against the provider API. */
  verified: boolean;
  /** Verified account identity (login, email, or workspace). */
  account?: string;
  /** Live-check failure, when connected but not verified. */
  error?: string;
  tokenHint: string;
  tokenPlaceholder: string;
  authMode?: "api-token" | "oauth-refresh-token";
  credentialKeys?: string[];
  operations?: string[];
  /** In-app OAuth is available for this provider (client credentials present). */
  oauthReady: boolean;
  checkedAt: string;
};

export type ConnectionsPayload = {
  ok: boolean;
  providers: ConnectionProviderStatus[];
};
