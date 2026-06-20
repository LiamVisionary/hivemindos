---
title: Agent Provider Integrations
nav_order: 12
---

# Agent Provider Integrations

HivemindOS can discover and route work to external agent tooling without replacing its own fleet, Work Board, shared brain, or Queen Bee control plane.

## Provider Catalog

The provider catalog makes external options retrievable by agents through `/api/context-index`:

- Browser Use for browser automation tasks such as navigation, forms, extraction, and screenshots.
- Awesome MCP Servers as a curated MCP discovery lane for tools such as GitHub, Slack, Linear, Stripe, Postgres, and Notion.
- Agent Mailboxes as the product-facing one-click mailbox flow for persistent agent email addresses.
- Cloudflare Agentic Inbox as one provider backend for routable email-agent Workers.
- MCP Email Server as an advanced local stdio bridge for existing IMAP and optional SMTP mailboxes.
- OpenHands and Aider as optional coding runtime adapters.
- Palmier Pro as an installable macOS video editor with a local MCP endpoint for timeline and media workflows.
- RentAHuman as a REST and MCP provider for real-world human work through profile search, conversations, bounties, service bookings, escrow, and transfers.
- n8n as an installable workflow automation service.
- Queen Bee PRD decomposition for turning product requirements into linked Work Board tasks.

Catalog entries name required credential keys only. They do not store secret values.

## Runtime Adapters

OpenHands and Aider appear as optional runtimes. HivemindOS checks for their CLIs, can install them through `uv`, and exposes a `run-task` runtime action for background coding work. Runtime task launches include uv/Homebrew CLI paths and load shared hive env credentials into the child process so provider keys saved with `hive-env-add` are available without restarting the dashboard.

- OpenHands runs documented headless automation with `openhands --headless --json --override-with-envs -t <task>` and maps the selected model plus shared OpenAI key into OpenHands' expected `LLM_MODEL` and `LLM_API_KEY` variables.
- Aider runs one-shot scripting with `aider --message <task> --yes --no-auto-commits --no-dirty-commits`.

Runs are recorded under HivemindOS runtime logs and are visible through the runtime runs/log APIs. Autonomous coding runs should still use project-specific safety rules, including disposable worktrees when the task can mutate code.

## Browser Use Service

The Apps & Services view includes Browser Use as an installable provider. HivemindOS installs the CLI through `uv tool install browser-use[cli]`, validates with `browser-use doctor`, starts a persistent local session with `browser-use open about:blank`, and can close sessions with `browser-use close --all`. HivemindOS does not run Browser Use's upstream `curl | bash` installer, `browser-use setup`, or `browser-use install` silently from the app.

`/api/browser-use` exposes the executable bridge for bounded local CLI actions by default: `doctor`, `open`, `state`, `click`, `input`, `type`, `screenshot`, and `close`. HivemindOS launches those commands with Browser Use anonymized telemetry disabled, only opens `http`/`https` URLs or `about:blank`, and stores screenshots inside the HivemindOS Browser Use run directory instead of accepting arbitrary output paths.

The Browser Use provider card has a Full permissions toggle. Enabling it requires a slide-to-unlock warning and persists server-side under the HivemindOS home directory. Full permissions let agents use the high-agency actions wired through the HivemindOS bridge, including Browser Use Cloud task creation, real Chrome profile/CDP launch options, file upload, and JavaScript eval. Setup/install commands remain controlled by the app installer rather than the runtime bridge.

## MCP Catalog

`GET /api/mcp/catalog` returns a curated MCP server list with capability tags, credential key names, side-effect classes, install hints, and safety notes. Agents should verify credentials and side effects before installing or calling a server.

## RentAHuman REST API

`/api/rentahuman` is the HivemindOS REST facade for RentAHuman. It reads `RENTAHUMAN_API_KEY` and optional `RENTAHUMAN_API_URL` from shared env at runtime and reports only whether those keys are present. The default upstream base URL is `https://rentahuman.ai/api`.

`GET /api/rentahuman?action=status` returns credential presence and the supported action matrix. Read-only discovery actions such as `search-humans`, `get-human`, `list-bounties`, `get-bounty`, `browse-services`, and `get-service-availability` can be called through GET or POST. Authenticated read actions such as listing conversations, rentals, transfers, escrow state, and bounty applications require `RENTAHUMAN_API_KEY`.

Actions that can message people, create bounties, book services, open escrow, release payments, or send transfers are prepare-first. A POST without confirmation returns the prepared request and the confirmation string. To execute, repeat the POST with `confirmation: "RENTAHUMAN_ACTION"` after the user has reviewed the human-facing task, payment amount, deadline, evidence requirements, and destination.

The curated MCP catalog also includes RentAHuman. Use `npx -y rentahuman-mcp` for runtimes that prefer MCP stdio, or the local `/api/rentahuman` route when HivemindOS should enforce shared-env loading and confirmation gates.

## n8n Service

The Apps & Services view includes n8n as an installable provider. The install action starts n8n through Docker, binds it to `127.0.0.1:5678`, sets localhost-safe HTTP settings, and keeps workflow execution outside the HivemindOS process. Once n8n is running, the existing connected-app discovery can surface its UI and API handles.

## Palmier Pro Service

The Apps & Services view includes Palmier Pro as an installable macOS video editor for agent-assisted timeline work. HivemindOS installs the reviewed GitHub release DMG by downloading the pinned asset, verifying its SHA-256 digest, mounting it read-only, and copying the app bundle into Applications. It does not run a shell installer.

Palmier Pro requires macOS 26 Tahoe on Apple Silicon. When the app is open, it exposes a local MCP endpoint at `http://127.0.0.1:19789/mcp`. Agents should connect to that loopback endpoint only after the user has opened the intended Palmier project and confirmed that timeline or media mutations are in scope.

## Agent Mailboxes

Agent Settings exposes a mailbox action for existing agents. The intended user flow is: select an agent, press **Create mailbox**, and receive a persistent address for that agent. The app stores mailbox ownership under HivemindOS state and does not ask the user for per-agent IMAP, SMTP, password, or host settings in the primary flow.

`GET /api/agents/mailbox?agentId=<agent>` returns existing mailbox records plus provider readiness. `POST /api/agents/mailbox` with `action: "create"`, `agentId`, and `agentName` attempts live provisioning. A mailbox is marked ready only when the selected provider can both receive mail for the address and send live internet email from the same domain. If no provider is live-ready, the API returns a blocked provider report with concrete setup blockers instead of creating a fake mailbox.

Cloudflare Agentic Inbox is one backend for this contract. It requires a Cloudflare DNS domain with Email Routing and Email Sending ready, and an Agentic Inbox Worker target for routing rules. The app may create the per-agent routing rule automatically once the provider is ready; the user should not configure IMAP or SMTP for each agent.

MCP Email Server remains useful for advanced bring-your-own-mailbox deployments and regression tests. It is not the default mailbox creation UX.

## Agentic Inbox Setup

`GET /api/cloudflare/agentic-inbox` returns the Cloudflare inbox blueprint plus setup status. `POST /api/cloudflare/agentic-inbox` supports:

- `action: "scaffold"` or `"install"` to create a real Worker project under the HivemindOS home directory.
- `action: "deploy"` or `"start"` to install dependencies and run `wrangler deploy`.

The scaffold includes Email Routing handling, a SQLite-backed Durable Object inbox store, R2 attachment binding, Workers AI binding, an Email Sending binding, health/catalog routes, draft creation, and explicit approval before replies are sent. Generated package scripts use `npx wrangler`, so `npm run check` can validate the Worker dry-run before a local dependency install. Deployments still require Cloudflare account auth, an onboarded sending domain, and Email Routing configured to deliver the mailbox to the Worker before it receives real mail.

## MCP Email Server

The Apps & Services view includes MCP Email Server as an installable local bridge for agent-readable mailboxes. HivemindOS installs the PyPI package with `uv tool install mcp-email-server` and reports setup readiness through `/api/fleet/apps/installable-services`.

The bridge is intended to be spawned by an MCP client over stdio, for example with `mcp-email-server stdio` after installation or `uvx mcp-email-server@latest stdio` when the operator prefers a per-run package launch. HivemindOS does not keep the email bridge running in the background and does not read mailbox credentials during status checks.

For advanced deployments, configure mailbox access through environment variables in the MCP client or shared env. The required read keys are `MCP_EMAIL_SERVER_EMAIL_ADDRESS`, `MCP_EMAIL_SERVER_PASSWORD`, and `MCP_EMAIL_SERVER_IMAP_HOST`. `MCP_EMAIL_SERVER_SMTP_HOST` and related SMTP keys are optional; when SMTP is omitted, the MCP server runs in read-only IMAP mode and hides outbound email tools.

Regression coverage is available with `pnpm test:mcp-email`. The default suite launches throwaway local SMTP and IMAP fixtures plus real `mcp-email-server stdio` processes to verify agent-to-agent delivery across distinct email addresses, reply threading, message search and date filters, read state, mailbox listing, moving, deleting, draft saving, Sent copies, HTML parsing, CC/BCC delivery privacy, attachment download, MCP process restart persistence, and read-only IMAP behavior when SMTP is not configured.

Production-provider coverage is available with `pnpm test:mcp-email:real`. It is opt-in and skips unless `MCP_EMAIL_REAL_E2E=1` is set. Configure two live test accounts with `MCP_EMAIL_REAL_ALPHA_EMAIL_ADDRESS`, `MCP_EMAIL_REAL_ALPHA_PASSWORD`, `MCP_EMAIL_REAL_ALPHA_IMAP_HOST`, `MCP_EMAIL_REAL_ALPHA_SMTP_HOST`, and the matching `MCP_EMAIL_REAL_BETA_*` keys. Optional per-account keys include `ACCOUNT_NAME`, `FULL_NAME`, `USER_NAME`, `IMAP_PORT`, `IMAP_SSL`, `IMAP_START_SSL`, `IMAP_VERIFY_SSL`, `SMTP_PORT`, `SMTP_SSL`, `SMTP_START_SSL`, and `SMTP_VERIFY_SSL`. The real-provider suite sends unique test messages between the two accounts, verifies live delivery, reads, replies, attachments, HTML, mailbox listing, read-only mode, and deletes the test messages unless `MCP_EMAIL_REAL_KEEP_MESSAGES=1` is set.

## PRD Decomposition

`POST /api/queen-bee` with `action: "decompose-prd"` parses a PRD into an epic and linked implementation tasks. Use `preview: true` to inspect the generated task set without writing to the Work Board.
