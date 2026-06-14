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
- Cloudflare Agentic Inbox as a scaffoldable and deployable email-agent Worker.
- OpenHands and Aider as optional coding runtime adapters.
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

## n8n Service

The Apps & Services view includes n8n as an installable provider. The install action starts n8n through Docker, binds it to `127.0.0.1:5678`, sets localhost-safe HTTP settings, and keeps workflow execution outside the HivemindOS process. Once n8n is running, the existing connected-app discovery can surface its UI and API handles.

## Agentic Inbox Setup

`GET /api/cloudflare/agentic-inbox` returns the Cloudflare inbox blueprint plus setup status. `POST /api/cloudflare/agentic-inbox` supports:

- `action: "scaffold"` or `"install"` to create a real Worker project under the HivemindOS home directory.
- `action: "deploy"` or `"start"` to install dependencies and run `wrangler deploy`.

The scaffold includes Email Routing handling, a SQLite-backed Durable Object inbox store, R2 attachment binding, Workers AI binding, an Email Sending binding, health/catalog routes, draft creation, and explicit approval before replies are sent. Generated package scripts use `npx wrangler`, so `npm run check` can validate the Worker dry-run before a local dependency install. Deployments still require Cloudflare account auth, an onboarded sending domain, and Email Routing configured to deliver the mailbox to the Worker before it receives real mail.

## PRD Decomposition

`POST /api/queen-bee` with `action: "decompose-prd"` parses a PRD into an epic and linked implementation tasks. Use `preview: true` to inspect the generated task set without writing to the Work Board.
