export const GOOGLE_CLIENT_ID_ENV = "GOOGLE_OAUTH_CLIENT_ID";
export const GOOGLE_CLIENT_SECRET_ENV = "GOOGLE_OAUTH_CLIENT_SECRET";
export const GOOGLE_REFRESH_TOKEN_ENV = "GOOGLE_OAUTH_REFRESH_TOKEN";

export const GOOGLE_CLOUD_CLIENT_ID_ENV = "GOOGLE_CLOUD_OAUTH_CLIENT_ID";
export const GOOGLE_CLOUD_CLIENT_SECRET_ENV = "GOOGLE_CLOUD_OAUTH_CLIENT_SECRET";
export const GOOGLE_CLOUD_REFRESH_TOKEN_ENV = "GOOGLE_CLOUD_OAUTH_REFRESH_TOKEN";
export const GOOGLE_CLOUD_ACCOUNT_EMAIL_ENV = "GOOGLE_CLOUD_OAUTH_ACCOUNT_EMAIL";

// Slack connects via a PKCE public client (no client secret). The public client
// id is baked into HivemindOS (or supplied via SLACK_OAUTH_CLIENT_ID). The flow
// yields a Slack *user* token (xoxp-), which is stored in SLACK_TOKEN_ENV — the
// same key a pasted bot token used, so the send/verify paths are unchanged.
export const SLACK_OAUTH_CLIENT_ID_ENV = "SLACK_OAUTH_CLIENT_ID";
export const SLACK_TOKEN_ENV = "SLACK_BOT_TOKEN";
