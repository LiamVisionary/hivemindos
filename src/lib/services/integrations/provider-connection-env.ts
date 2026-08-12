export const GOOGLE_CLIENT_ID_ENV = "GOOGLE_OAUTH_CLIENT_ID";
export const GOOGLE_CLIENT_SECRET_ENV = "GOOGLE_OAUTH_CLIENT_SECRET";
export const GOOGLE_REFRESH_TOKEN_ENV = "GOOGLE_OAUTH_REFRESH_TOKEN";

export const GOOGLE_CLOUD_CLIENT_ID_ENV = "GOOGLE_CLOUD_OAUTH_CLIENT_ID";
export const GOOGLE_CLOUD_CLIENT_SECRET_ENV = "GOOGLE_CLOUD_OAUTH_CLIENT_SECRET";
export const GOOGLE_CLOUD_REFRESH_TOKEN_ENV = "GOOGLE_CLOUD_OAUTH_REFRESH_TOKEN";
export const GOOGLE_CLOUD_ACCOUNT_EMAIL_ENV = "GOOGLE_CLOUD_OAUTH_ACCOUNT_EMAIL";

// Microsoft Entra's client id is public and baked into the app. Only the
// refresh token and display-only account metadata are stored in the shared hive
// env; the confidential-client secret stays in the hosted OAuth broker.
export const AZURE_OAUTH_CLIENT_ID_ENV = "AZURE_OAUTH_CLIENT_ID";
export const AZURE_REFRESH_TOKEN_ENV = "AZURE_OAUTH_REFRESH_TOKEN";
export const AZURE_ACCOUNT_EMAIL_ENV = "AZURE_OAUTH_ACCOUNT_EMAIL";
export const AZURE_TENANT_ID_ENV = "AZURE_OAUTH_TENANT_ID";

// Slack connects via a PKCE public client (no client secret). The public client
// id is baked into HivemindOS (or supplied via SLACK_OAUTH_CLIENT_ID). The flow
// yields a Slack *user* token (xoxp-), which is stored in SLACK_TOKEN_ENV — the
// same key a pasted bot token used, so the send/verify paths are unchanged.
export const SLACK_OAUTH_CLIENT_ID_ENV = "SLACK_OAUTH_CLIENT_ID";
export const SLACK_TOKEN_ENV = "SLACK_BOT_TOKEN";

// Meta Messaging supports multiple reusable business accounts. The directory is
// durable non-secret metadata; each account's token is stored under the
// generated env key referenced by that directory entry.
export const META_MESSAGING_DIRECTORY_ENV = "META_MESSAGING_CONNECTIONS_JSON";
export const META_MESSAGING_LEGACY_TOKEN_ENV = "META_MESSAGING_ACCESS_TOKEN";
export const META_MESSAGING_OAUTH_CLIENT_ID_ENV = "META_MESSAGING_OAUTH_CLIENT_ID";

export const MONID_API_KEY_ENV = "MONID_API_KEY";
