# INTEGRATIONS.md — Adding a connector, esp. OAuth "Connect" buttons

How the **Integrations** panel connectors work, and the exact steps to add one — with
the non-obvious gotchas that cost real debugging time. **Read the "Desktop reality"
section first**: HivemindOS is a *downloaded desktop app*, which rules out the naive
localhost-OAuth flow and dictates where the client secret lives.

This is engineering/agent guidance, not product docs — it names files, hosts, and internals,
so it lives at the repo root next to `OPTIMIZATIONS.md`, **not** under `docs/` (see
`AGENTS.md → Docs Scope`). The private Worker source lives outside this MIT repo — see the
(gitignored) `WORKERS.local.md` for the map.

---

## The two auth models

Every connector in `src/lib/services/integrations/connector-manifests.ts` declares one
`ConnectorAuthMode` (`src/lib/types/integrations.ts`):

- **`api-token`** — the user pastes a token/key. One password field; validated live, then stored.
- **`oauth-refresh-token`** — a browser OAuth sign-in that yields a **refresh token**. Google / Google Cloud.
- **`oauth-user-token`** — a browser OAuth sign-in that yields one or more long-lived provider tokens. **Slack**
  (`user_scope=chat:write` → an `xoxp-` user token, stored in the existing `SLACK_BOT_TOKEN`
  hive-env key so the send path and verifier are unchanged) and **Meta Messaging** (Page access
  tokens stored per named Facebook Page / Instagram professional account).

The rest of this doc is about the **OAuth models** — the "Connect with …" button.

## Desktop reality: the secret cannot ship, and localhost usually can't be the redirect

HivemindOS is distributed and installed on machines we don't control, so:

1. **A client secret must never be in the binary or this MIT repo.** Anyone could extract it.
   → The secret lives ONLY in a hosted **Cloudflare Worker** (`hivemindos-google-oauth-exchange`,
   the shared OAuth broker) as a `wrangler secret`. The app never sees it.
2. **A per-user `localhost:<random-port>` callback usually can't be pre-registered** with the
   provider. Whether you can avoid a hosted redirect depends entirely on the provider:

| | **Loopback-wildcard providers** (Google desktop client) | **Exact-match / HTTPS providers** (Slack, Meta) |
|---|---|---|
| Redirect lands on | the app's own `http://127.0.0.1:<port>` callback (provider wildcards the port) | the **Worker's** stable HTTPS `/…/callback` (one URL registered once) |
| Worker's job | token **exchange only** (adds the secret) | **receive the redirect + exchange + rendezvous** the token back to the app |
| App gets the token via | its own callback route did the exchange (through the Worker) | **polls** the Worker, proving ownership with a `poll_secret` |
| Reference | `google-cloud-oauth.ts` | `slack-oauth.ts` |

Both keep the secret in the Worker. Pick the row by testing the provider's redirect rules — do
**not** assume a localhost callback will work (it won't for Slack: exact-match, HTTPS-only).

### Slack broker flow (the exact-match path), step by step

```
[Connect button] POST /api/integrations/slack/oauth/start  (requireAuth)
   app mints sid (public) + poll_secret (private); POST <worker>/slack/start {sid, sha256(poll_secret), client_id, redirect_uri}
   → returns { authorizationUrl, flowId=sid };  openExternalUrl(authorizationUrl)
[Slack consent] user approves
   → Slack 302 → https://<worker>/slack/callback?code&state=sid       (redirect_uri = the WORKER, HTTPS, registered once)
[Worker] exchanges code WITH client_secret it holds → xoxp- user token; stores it in KV under sid; shows "return to app" page
[app] UI poll loop → POST /api/integrations/slack/oauth/poll {flowId}
   → server POST <worker>/slack/result {sid, poll_secret}; Worker verifies sha256, returns token ONCE, deletes it
   → server persists token to shared hive env (SLACK_BOT_TOKEN); tile flips to Connected
```

The token never appears in any URL and is released only to the caller holding `poll_secret`
(which never traversed the browser or Slack). `poll_secret` is kept server-side in a small
file-backed store (`~/.hivemindos/slack-oauth-pending.json`); the UI only ever holds the public
`sid`. See gotcha 6 for why that store must NOT be a module-level `Map`.

### Meta Messaging account-directory variant

Meta uses the same exact-match Worker rendezvous at `/meta/start`, `/meta/callback`, and
`/meta/result`, but one authorization can return several assets: each granted Facebook Page and
each linked Instagram professional account. The app saves a non-secret account directory in
`META_MESSAGING_CONNECTIONS_JSON` and stores every Page access token under its own derived shared-env
key. A Zero Human Company stores only `{ providerKey: "meta-messaging", connectionId }`, so two
companies can deliberately share one inbox or select different ones without copying credentials.

The open-source/BYOK path accepts a Page access token plus the numeric Page or Instagram business
account id, verifies the identity live, and enters it into the same directory. It stays available
when the official Meta app id/secret has not been configured. Meta's messaging APIs are not a cold
outreach rail: the recipient must have initiated the conversation (and provider messaging-window
rules still apply). The current HivemindOS connector only verifies, stores, and assigns credentials;
it does not yet sync conversations or send replies, so product copy and agent context must describe
it as setup-only until those execution adapters ship.

---

## Checklist: adding an OAuth connector

**App side (this repo):**
1. **Service** — `src/lib/services/integrations/<provider>-oauth.ts`: build the authorize URL,
   talk to the broker Worker, persist the token to the shared hive env. Baked-in **public client id**
   default constant (+ a `<PROVIDER>_OAUTH_CLIENT_ID` env override).
2. **Start route** — `.../oauth/start/route.ts`: `POST`, `requireAuth`, returns `{ authorizationUrl, flowId }`.
   First line **must** be the `// guard:allow-hive-action-route …` pragma (connect flow, not an
   agent action — keeps `guard:hive-action-route-drift` green).
3. **Poll route** (exact-match providers) — `.../oauth/poll/route.ts`: `POST`, `requireAuth`, same
   pragma; persists the token server-side on `connected`, never returns it to the client.
   *(Loopback-wildcard providers instead have a `callback` GET route — see gotcha 1.)*
4. **UI** — `src/features/integrations/ConnectionsPanel.tsx`: add to `OAUTH_START_URL`, the
   `oauthOnly`/`usesOAuthClient` flags, and (for the broker/poll model) advance the flow inside the
   modal's poll loop via the `flowId`.
5. **Manifest / env / verify / type** — `connector-manifests.ts` (auth mode), `provider-connection-env.ts`
   (env key names), `provider-connections.ts` (verify fn + `providerOAuthReady`), `types/integrations.ts`
   (provider key).
6. **Changelog** — `CHANGELOG.md` entry (see `AGENTS.md → Changelog Discipline`).

**Worker side (private `hivemind-cloud-services` repo — never in this MIT repo):**
7. Add the provider's routes to `workers/google-oauth-exchange/src/index.ts` (the shared broker).
   Exact-match providers need `/<p>/start` (pre-register), `/<p>/callback` (receive + exchange), and
   `/<p>/result` (poll) plus a KV namespace binding.
8. `wrangler secret put <PROVIDER>_CLIENT_SECRET`; `wrangler kv namespace create …` if new; `wrangler deploy`.

**Provider-side app:** create the OAuth app, register the redirect URL (below), scopes.

---

## Gotchas (each one cost real time)

### 1. Proxy allowlist — for a callback that lands on the APP (loopback-wildcard providers only)
If the provider redirects to the app's own `/api/.../oauth/callback` (Google), that route is a
top-level browser redirect with no dashboard credential, so `src/proxy.ts`'s gate rejects it with
JSON `{"ok":false,"error":"Dashboard authentication is required."}` before the route runs. Fix: add
the callback path to `SELF_AUTHENTICATING_API_PREFIXES`. **The broker/poll model (Slack) does NOT need
this** — its redirect lands on the Worker, and its `poll` route is a normal authed dashboard call.

### 2. Redirect URI must match **exactly** — so use the stable Worker URL, not localhost
Slack does exact-match (no loopback-port wildcard) and requires **HTTPS**. Register exactly one URL:
`https://hivemindos-google-oauth-exchange.hivemindos.workers.dev/slack/callback`. The old symptom of
getting this wrong: `redirect_uri did not match any configured URIs. Passed URI: http://127.0.0.1:5121/…`
— that was the abandoned localhost approach; a downloaded user's port is never registrable.

Meta likewise registers exactly
`https://hivemindos-google-oauth-exchange.hivemindos.workers.dev/meta/callback`. The public
`META_MESSAGING_OAUTH_CLIENT_ID` in the app must equal the Worker's `META_CLIENT_ID`; only
`META_CLIENT_SECRET` belongs in the Worker's secret store.

### 3. `bad_client_secret` = confidential client with no secret reaching Slack
Slack's `oauth.v2.access` needs a `client_secret` unless the app is a **public/PKCE** client. We keep
the app **confidential** and put the secret in the Worker (`wrangler secret put SLACK_CLIENT_SECRET`).
**Do NOT enable PKCE / "public client" on the Slack app** — it's a one-way switch (undoable only via
Slack support) and it's the wrong model for a secret-in-Worker broker.

### 4. Client id is public → bake it in. Client secret → only in the Worker
Commit the client id as `SLACK_OAUTH_CLIENT_ID_DEFAULT` (precedent: `GOOGLE_CLOUD_OAUTH_CLIENT_ID_DEFAULT`).
The secret is set once via `wrangler secret put` in the private repo and never appears here.

### 5. Slack app manifest (broker model)

```json
{
  "display_information": { "name": "HivemindOS" },
  "oauth_config": {
    "redirect_urls": ["https://hivemindos-google-oauth-exchange.hivemindos.workers.dev/slack/callback"],
    "scopes": { "user": ["chat:write"] }
  },
  "settings": {
    "org_deploy_enabled": false, "socket_mode_enabled": false,
    "is_hosted": false, "token_rotation_enabled": false
  }
}
```

- **No `pkce_enabled`** (confidential client — see gotcha 3).
- **User scopes**, not bot scopes.
- **`token_rotation_enabled: false`** — long-lived token, no refresh machinery.

### 6. Pending-flow state must survive HMR — do NOT use a module-level `Map`
The broker/poll model needs the server to remember each flow's `poll_secret` between `/start` and
`/poll`. A module-level `Map` is the obvious choice and it is **wrong**: Next dev wipes module state on
recompile (this tree has heavy multi-session HMR churn), and `/start` and `/poll` are separate route
modules that don't reliably share a singleton — so the poll finds nothing and the UI shows *"The Slack
sign-in expired."* Persist to a small file instead (`~/.hivemindos/slack-oauth-pending.json`, mode
`0600`, TTL-pruned) — shared across routes, survives recompiles/restarts, and works in the packaged app.

### 7. A stale Worker deploy looks like a routing bug
If the app hits the broker and gets an error that belongs to the *old* Worker code — e.g. `/slack/start`
returning `Not found. Use POST /token or POST /refresh.` (the Google-only 404) — the Worker just wasn't
redeployed. `wrangler deploy` from the worker dir, then confirm with a live curl (below) that the new
routes answer. Deploys are additive here; keep the other providers' routes byte-identical.

---

## Verifying

App-half without a browser (dev server):

```bash
# start returns a broker authorize URL + flowId (client id must be baked in / set):
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}' http://127.0.0.1:<port>/api/integrations/slack/oauth/start
```

Worker-half (after deploy + secret + KV):

```bash
# pre-register a flow, then confirm the callback + poll shape (no real Slack code needed for the 4xx paths):
curl -s -X POST https://hivemindos-google-oauth-exchange.hivemindos.workers.dev/slack/start \
  -H 'content-type: application/json' -d '{"sid":"testsidtestsidtest","poll_hash":"x","client_id":"c","redirect_uri":"r"}'
```

The full Connect → consent → callback → poll → Connected round-trip needs a real browser + Slack
login on a machine where the app is running — that's the user's to confirm.
