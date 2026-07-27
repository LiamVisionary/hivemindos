---
title: "MiroShark Companion Integration"
---

# MiroShark Companion Integration

MiroShark support is optional.

HivemindOS owns real fleet coordination. MiroShark can run beside it as a rehearsal and swarm simulation engine.

## Integration Model

- HivemindOS checks `/health` on the configured or detected backend.
- HivemindOS detects common local MiroShark installs, including `MIROSHARK_HOME`,
  `~/.openclaw/companions/MiroShark`, and the Codex candidate cache.
- When MiroShark is installed but stopped, the Swarm screen can start it.
- When MiroShark is missing, the Swarm screen offers an install-and-start action.
- The managed setup uses `git`, `uv`, `python3.11`, `docker`, and `screen` when
  available. It starts Neo4j in Docker and runs the MiroShark Flask backend in a
  detached screen session.
- If the HivemindOS runtime environment has `OPENROUTER_API_KEY`,
  `OPENAI_API_KEY`, or `LLM_API_KEY`, it can write MiroShark's local `.env`
  automatically with private file mode.

## Local Defaults

MiroShark's launcher serves:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:5001`
- Health: `GET /health`
- API docs: `GET /api/docs`
- OpenAPI spec: `GET /api/openapi.yaml`
- Templates: `GET /api/templates/list`
- Simulations: `GET /api/simulation/list`

Set either variable when the backend is somewhere else:

```bash
MIROSHARK_HOME=~/code/MiroShark
MIROSHARK_BASE_URL=http://127.0.0.1:5001
NEXT_PUBLIC_MIROSHARK_BASE_URL=http://127.0.0.1:5001
```

Prefer `MIROSHARK_BASE_URL` for server-only configuration. The public variable
is supported for local convenience.

## Zero-Friction Flow

The Swarm tab should never stop at "companion not running." It should show one of these states:

- **Connected**: open MiroShark or inspect setup details.
- **Detected**: start the local install from the dashboard.
- **Missing**: install and start from the dashboard when prerequisites and an
  API key are available.
- **Needs configuration**: show exactly which prerequisite or key is missing.

Manual fallback commands remain visible in setup details, but they are a backup, not the primary path.

## Chat Launch

Dashboard chat can launch a lightweight simulation request with:

```text
/swarm-sim <scenario>
```

The command posts the scenario to HivemindOS' `/api/miroshark/swarm` route, queues the MiroShark run when the companion is connected, and writes the queued job/status link back into the chat. If the companion is missing or stopped, the chat reply should explain the setup problem instead of silently dropping the request. Use the Swarm tab for template fields, round/platform controls, archive loading, analysis-agent selection, and publishing.

## Strategy

Use MiroShark for rehearsal:

- test a proposed swarm plan before real execution
- compare likely agent disagreements
- import summaries, stance distributions, and risk signals
- later suggest roles, voting thresholds, and handoff checks

Keep operational swarm state inside HivemindOS:

- task ownership
- agent attribution
- handoffs
- quorum and synthesis decisions
- dashboard-visible execution state
