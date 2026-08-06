export const BROWSER_USE_SECURITY_NOTES = [
  "Installed from PyPI with uv; HivemindOS does not run the upstream curl-to-shell installer.",
  "Normal install validates with doctor and never runs browser-use setup or browser-use install silently.",
  "HivemindOS launches Browser Use with anonymized telemetry disabled.",
  "Full permissions can unlock Browser Use cloud tasks, real-profile/CDP launch options, uploads, and JavaScript eval after a slide-to-unlock warning.",
];

export const MCP_EMAIL_SERVER_SECURITY_NOTES = [
  "Mailbox credentials give agents direct access to private email. Use a dedicated agent mailbox or app password whenever possible.",
  "HivemindOS only installs the local stdio MCP bridge; it does not read mailbox credentials, probe inboxes, or keep the bridge running in the background.",
  "Omitting MCP_EMAIL_SERVER_SMTP_HOST keeps the bridge in read-only IMAP mode, so outbound email tools stay hidden.",
  "Enable attachment downloads only for trusted workflows; email attachments can contain sensitive or unsafe files.",
];
