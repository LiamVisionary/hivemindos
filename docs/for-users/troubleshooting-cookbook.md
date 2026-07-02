---
title: "Troubleshooting Cookbook"
---

# Troubleshooting Cookbook

HivemindOS is a private agent-fleet control room. Most failures are not mysterious
product states; they are one of a few local-first surfaces needing attention:
dashboard auth, collectors, Link/Tailscale, the shared brain, shared env, local
model servers, or wallet/payment gates.

The dashboard exposes the machine-readable cookbook through
`/api/system/troubleshooting`. The entries are intentionally short, secret-free,
and written as operator fixes rather than stack traces.

## Common Fixes

### Dashboard Auth

Symptoms:

- the dashboard unlock screen repeats
- API routes return `Dashboard authentication is required`

Checks:

- run `dashboard-auth status`
- confirm `.env.local` contains dashboard auth keys

Fixes:

- run `dashboard-auth copy-token` to recover the device token
- run `dashboard-auth reset-token` if the token is lost
- restart the dashboard after rotating auth values

### Collector Unreachable

Symptoms:

- Fleet shows a machine without a ready collector
- remote chat, files, or env sync fail

Checks:

- inspect Fleet collector state
- check the collector URL through Hivemind Link or the Tailnet path
- review the machine monitor service logs on the target machine

Fixes:

- run the setup repair flow for the target machine
- restart only the HivemindOS collector service for that machine
- preserve remote Link `/peer/...` URLs instead of rewriting them to local loopback

### Shared Brain Index Stale

Symptoms:

- `hive-brain` returns old or incomplete answers
- skills or memories are present in Obsidian but not found

Checks:

- run `pnpm vault:doctor`
- inspect the generated full-vault search index status
- confirm the configured vault path is readable

Fixes:

- rebuild the full-vault search index
- refresh shared skill sync from Brain Services
- resolve Syncthing conflict copies before relying on stale indexes

### Shared Env Not Syncing

Symptoms:

- a runtime says a provider key is missing on another machine
- `hive-env-check KEY` succeeds locally but remote agents fail

Checks:

- run `hive-env-check KEY`
- check Fleet for env-sync-ready collectors
- inspect whether peer collectors are online

Fixes:

- run `hive-env-add --reconcile`
- let queued sync retry when peer collectors return
- avoid pinning raw Tailnet IPs in `HIVE_ENV_TAILNET_TARGETS`

### Local Model Server Off

Symptoms:

- local OpenAI-compatible chat fails quickly
- LM Studio or Ollama shows a loaded model but `/v1/models` is unreachable

Checks:

- verify the model server's OpenAI-compatible API is enabled
- check `LOCAL_OPENAI_BASE_URL` or the selected agent provider profile

Fixes:

- start the LM Studio or Ollama server
- select a reachable hosted fallback
- use Fleet model-fit recommendations to move local inference to the right machine

### Wallet Action Blocked

Symptoms:

- wallet or x402 action prepares but does not execute
- an agent reports missing rail readiness

Checks:

- review the wallet approval queue
- check provider readiness by key name only
- confirm spend budget and kill-switch state

Fixes:

- approve the prepared action from Wallets
- configure the missing provider rail
- do not bypass spend gates from chat or tool output
