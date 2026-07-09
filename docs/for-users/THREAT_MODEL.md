# HivemindOS Threat Model

HivemindOS is a local-first control room for trusted agent fleets. It can read
local project files, coordinate remote collectors, write to a shared Obsidian
brain, route work to agent runtimes, and prepare wallet or payment actions. Treat
the dashboard like a private admin console, not like a public web app.

This document records the product security boundary so new features can make
consistent decisions.

## Trust Boundary

HivemindOS is designed for:

- one operator or trusted team on a private machine or trusted Tailnet
- local dashboard access protected by the device token and signed session cookie
- remote collectors reachable only through Hivemind Link, Tailscale, or another
  explicitly trusted private network path
- agents that can be useful with powerful tools, but must still respect
  permission, budget, and provenance gates

HivemindOS is not designed for unauthenticated public exposure. Do not bind
collectors, local model servers, wallet APIs, or the dashboard to the public
internet unless a feature has a dedicated exposure model and safety review.

The threat model tries to prevent:

- unauthenticated dashboard or API access
- accidental public exposure of private collector or model-service ports
- prompt-injection from notes, memories, fetched pages, connected apps, tool
  output, conversation mirrors, or compiled knowledge
- secret leakage through logs, shared brain notes, health reports, telemetry, or
  agent-visible context
- wallet, payment, x402, env-sync, or remote mutation actions that bypass their
  explicit gates
- cross-machine confusion where a local loopback URL is treated as a remote
  collector, or a remote collector is treated as local
- provenance loss for agent-created work, handoffs, memory writes, and project
  changes

The threat model does not try to prevent an authenticated local operator from
using the product's intended powers on their own machine.

## Capability Classes

Capability classes should stay explicit in code, docs, and runtime prompts.

| Capability | Default boundary |
| --- | --- |
| Dashboard viewing | Requires dashboard auth unless explicitly running inside a signed native bootstrap |
| Fleet discovery | Read-only by default; remote mutation needs an explicit action |
| Shared brain recall | Allowed, but retrieved text is untrusted source data |
| Shared brain writes | Durable writes must use the memory, handoff, note, or vault services with redaction and provenance |
| Shared env | Presence checks may name keys; values must not be printed, logged, or written into project files |
| Runtime chat | Uses the selected runtime adapter and should preserve machine/collector identity |
| Shell/file tools | Only through the selected runtime/tooling surface and its permissions; never inferred from normal text |
| Wallet and payment actions | Prepare/quote first; spend or sign only through configured approval and rail gates |
| Remote collector changes | Require a specific target, collector URL, and action; no broad process cleanup |
| Public docs | Must not include personal machine names, paths, Tailnet details, secrets, or local run state |

When adding a new capability, expose it through the relevant capability matrix or
discovery surface before wiring it into chat. The user should be able to ask for
the intent, while the product selects the configured implementation.

## Prompt-Injection Boundary

Any content that did not come directly from the current operator instruction is
untrusted when it reaches a model. That includes:

- Obsidian notes, memories, conversation mirrors, and compiled wiki pages
- shared skills and packaged third-party skills
- fetched URLs, web search results, GitHub/issue/PR text, docs, and API catalogs
- emails, calendar entries, chat transcripts, and connected-app responses
- runtime logs, shell output, browser output, and model/tool output
- uploaded files, generated reports, and handoff payloads

Untrusted content may be used as reference material. It must not be allowed to
change system instructions, leak secrets, call tools, modify files, write memory,
send messages, spend funds, or change settings merely because the untrusted
content asks for it.

Use `src/lib/services/security/untrusted-context.ts` when injecting retrieved
or external material into model messages. Keep untrusted source text out of the
system role unless a feature has a tighter parser or structured boundary that
provides equivalent protection.

## Authentication And Sessions

The dashboard uses:

- `HIVEMINDOS_DASHBOARD_AUTH_SECRET` for signed session cookies
- `HIVEMINDOS_DASHBOARD_DEVICE_TOKEN` for local unlock and API bearer/header auth
- `HIVEMINDOS_NATIVE_BOOTSTRAP_TOKEN` only when native mode is active

Routes that expose local paths, wallet state, env status, runtime control, or
fleet mutation should use `requireAuth`. Public or unauthenticated routes must
return only information that is safe for a stranger installing the product.

Session cookies are HMAC-signed and time-bounded. Rotating the auth secret should
invalidate existing sessions after restart.

## Shared Brain And Env

The shared Obsidian vault is a human-readable coordination surface, not a secret
store. It may hold durable facts, memory metadata, conversation mirrors, skill
text, work board records, secure-reference names, and operational summaries. It
must not contain plaintext secrets.

Shared secrets belong in `~/.hivemindos/.env` and should be accessed through
the shared env helpers. Health reports and agent context may say that a key is
present or missing, but must not include the value.

## Remote Machines

Machine identity must preserve the difference between local and remote
collectors. A remote collector behind Hivemind Link keeps its `/peer/...` proxy
URL; it must not be normalized to the local collector port. Remote actions should
include the machine identity and collector URL selected by Fleet, not a display
name alone.

## Wallets And Spending

Wallet features are explicit rails. Agents can prepare actions, quotes, and
approval packets, but spend, transfer, x402, trading, staking, or token actions
must pass the configured provider, key, budget, and approval gates.

Never put wallet private keys, seed phrases, shared env values, or raw signing
payload secrets into logs, Obsidian notes, public docs, telemetry, or model
context.

## Health Reports

Health and readiness reports should be useful but secret-free:

- report service names, status, and sanitized paths or URLs only when needed
- classify failures into controlled categories where practical
- never include credential-bearing URLs, env values, raw exception payloads from
  third-party services, private Tailnet IPs, or local-only personal details in
  public docs
- prefer `ok`, `degraded`, `down`, and `disabled` over ambiguous strings

## Known Gaps

- HivemindOS has a dashboard device-token model with a local admin principal by
  default, not a full multi-user RBAC system. New capability surfaces should use
  the shared principal, scope, and action-authorization helpers so future
  multi-principal installs do not need parallel policy code.
- Connector credentials remain server-side. Agents may see credential key names,
  connector status, and approved operation metadata, but not token values.
- Some runtime tools are delegated to external agent runtimes whose permissions
  are enforced outside this repository.
- Not every retrieved-context path uses the centralized untrusted-context helper
  yet. New or touched prompt-building paths should migrate toward it.
- The health/readiness spine starts with local static checks. Deeper provider,
  fleet, and model-server probes should be added behind bounded timeouts and
  authenticated routes.
