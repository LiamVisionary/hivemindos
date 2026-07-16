---
title: "Beeline Family Profiles"
---

# Beeline Family Profiles

Beeline gives each person you help a separate identity inside HivemindOS. A family card records who the person is, the names an agent may recognize, what kinds of help you are authorized to provide, and which dedicated browser identity belongs to them.

## What You Can Do

- Add a family member or another person you support.
- Give the person aliases such as “mom” or “grandpa” so chat can resolve natural requests.
- Choose allowed areas such as calendar, healthcare, messaging, shopping, travel, or browser access.
- Keep authority pending until you explicitly confirm it, and revoke authority later.
- Bind a dedicated Google Chrome profile without importing that profile's account email, passwords, cookies, or session values into Beeline.
- Open the bound profile from Beeline after a clear confirmation.
- Connect a separate Google Calendar account through hosted OAuth custody.
- Connect a public HTTPS MCP server with a family-specific bearer credential and capability scope.
- Save a website login or API token in the device's operating-system credential store, where agents can select and use an opaque handle but cannot ask Beeline to reveal or export the value.
- Ask an agent about a person by name or relationship. The agent receives only the matched card's consent, allowed areas, and browser-binding metadata.

Beeline does not treat confirmed authority as blanket approval. A healthcare booking, purchase, message, form submission, or other consequential action still needs its normal review or confirmation.

## Dedicated Chrome Profiles

A separate Chrome profile is the usable connection path in the first Beeline release. Create one Chrome profile per person, sign in to the sites they want to use, then select that profile on their Beeline card.

Choose one of two access modes:

- **Manual-first** opens the correct profile so you can supervise the work.
- **Trusted agent** lets HivemindOS route bounded Browser Use actions through the selected real Chrome profile. It requires Browser Use Full permissions and an exact confirmation for the action and website. An automated browser can observe authenticated pages and session state, so this mode should be reserved for agents and tasks you trust.

Chrome may need to be fully closed before some browser-automation tools can attach to an existing profile.

## Local Credentials Without Agent Access

Beeline profile storage is intentionally non-secret. It stores names, authority, allowed areas, and connection metadata; it does not store passwords, OAuth tokens, session cookies, or vault keys.

In the HivemindOS desktop app, you can optionally save a website username/password or HTTP token for one family card. Secret values go directly from the form to the operating system's protected credential store:

- macOS Keychain on Mac.
- Windows Credential Manager on Windows.
- Secret Service-compatible storage on Linux.

The family card keeps only a random credential ID, label, kind, exact website origin, and security policy. There is no reveal or export action. The agent can list that non-secret metadata, infer which credential matches the person and website, and ask the native broker to use it. The native broker performs the login fill or authenticated HTTPS request and returns only the sanitized result.

Local credential use is flexible by default. You do not have to predict every operation or tell the agent which low-level API call is needed. The broker still enforces the exact saved public HTTPS origin, refuses redirects and private-network destinations, prevents agent-supplied authentication/cookie/transport headers, and redacts a reflected secret from the response.

Turn on **Extra-restricted agent use** for a credential when you want another security layer. Restricted credentials require a separate confirmation on each use. HTTP credentials can also be limited to selected methods such as `GET` or `POST`.

For a saved website login, the agent first opens the family member's trusted-agent Browser Use session at the sign-in page. The native broker verifies the current origin, fills the selected username and/or password fields, verifies the origin again, and submits. Credentials are sent over the browser tool's authenticated local connection rather than command-line arguments. HivemindOS temporarily locks that family browser session during the fill so another HivemindOS browser action cannot interleave.

This boundary prevents normal agents, MCP tools, Next.js routes, tool results, and HivemindOS logs from receiving the plaintext. It is not a promise against malware, an administrator or same-user process with debugging access, a compromised operating-system account, a malicious page at the saved website, or a separate process that bypasses HivemindOS and directly controls the browser. The destination page necessarily receives a login when you ask the broker to submit it. Use a dedicated Chrome profile, manual supervision, and extra-restricted mode for higher-risk accounts.

## Hosted OAuth And MCP Accounts

Separate OAuth accounts and family-scoped MCP servers use the hosted Beeline action broker. Provider secrets are encrypted in HivemindOS-controlled infrastructure. The downloaded app authenticates the request, and the broker returns only connection metadata or action results.

The first broker integration supports:

- Google Calendar reads and confirmation-gated event creation.
- Remote MCP discovery and resource reads through an allowlist.
- Confirmation-gated MCP `tools/call` operations.
- Retry-safe write actions, so repeating the same approved calendar or MCP request does not perform it twice.
- Public HTTPS MCP endpoints only. Localhost, private-network destinations, URL credentials, nonstandard ports, private DNS answers, and redirects are rejected.

When the hosted broker or local hosted-account credential is unavailable, Beeline keeps these connections disabled and never falls back to the operator's own integrations.

External password managers such as KeePassXC or Bitwarden may still be recorded as the chosen login source. Beeline does not embed their vaults or copy their secrets unless you separately choose to save a value with the local credential form.

Removing a family card deletes its local OS-stored credentials and revokes its hosted Beeline connections before removing the card. If cleanup cannot be confirmed, the card stays visible so you can retry rather than silently abandoning a credential.

The app's uninstaller offers a separate conservative prompt to delete Beeline entries from the operating-system credential store. It runs the native broker before removing local metadata so a failed cleanup does not leave secret entries with no tracking record.

## Safe Setup

1. Create a dedicated Chrome profile for the person and let them sign in directly when practical.
2. Add their Beeline card and list only aliases they are comfortable using.
3. Select the smallest set of allowed areas.
4. Bind the dedicated Chrome profile and keep access manual-first initially. Existing signed-in browser sessions require no credential import.
5. Confirm authority only after the person has agreed to the arrangement.
6. Connect their Google Calendar or MCP server from their card. Enter MCP bearer tokens yourself; they are sent directly to encrypted hosted storage and are not saved in the family card.
7. If needed, add a local website login or HTTP token in the desktop app. Leave flexible use on for natural agent operation, or enable Extra-restricted agent use for confirmation and method limits.
8. Enable trusted-agent browser access only when the person understands that automation can inspect their signed-in pages and that the destination receives submitted login values.
9. In chat, name the person naturally. If more than one card matches, the agent asks which person you mean.
