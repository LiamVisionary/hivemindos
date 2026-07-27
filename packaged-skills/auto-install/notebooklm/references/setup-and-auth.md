# Setup And Authentication

## Supported Path

NotebookLM is optional and local to each machine.

1. Open HivemindOS **Integrations**.
2. Find **NotebookLM** and choose **Install NotebookLM**.
3. Wait for the package, virtual environment, Chromium runtime, and runtime registration to finish.
4. Choose **Sign in with Google**.
5. Complete sign-in in the opened browser. The browser flow detects success; no cookie paste or terminal confirmation is required.
6. Restart an agent runtime after registration so it loads the new MCP tools.

The integration requires Python 3.10 or newer. HivemindOS searches standard portable interpreter locations and reports a setup error if none is available.

## Health Checks

Prefer the MCP `server_info` tool. A healthy result identifies the package version and reports authentication ready without exposing credentials.

For a CLI-only diagnostic, use the installed binary and a live passive check:

```bash
~/.hivemindos/integrations/notebooklm/venv/bin/notebooklm auth check --test --passive --json
```

Require both `status: "ok"` and `checks.token_fetch: true`. A local-only check can prove that the cookie file parses but cannot prove Google still accepts the session.

Use `notebooklm list --json` as a second read-only smoke test. An empty notebook list is valid for a new account.

## Recovery

- **Not installed:** install from Integrations. Do not install a floating version directly from PyPI or GitHub.
- **Authentication missing or stale:** choose **Sign in with Google** again in Integrations.
- **Runtime has no NotebookLM tools:** choose **Sync runtimes**, then restart that runtime.
- **Package error:** retry installation. The installer verifies the pinned wheel hash and restores the prior integration directory when an upgrade fails.
- **Upstream API error:** report that NotebookLM uses undocumented APIs. Retry only when the action is safe and the error appears transient.

## Credential Rules

NotebookLM's local profile contains bearer browser credentials. Never:

- print or parse the saved browser-state JSON
- move it into `~/.hivemindos/.env`
- store it in source control, Obsidian, Shared Brain Memory, logs, chat, or artifacts
- send it through a remote MCP tunnel
- use another account or profile without the user's direction

Removing the HivemindOS package preserves the separate NotebookLM authentication profile. **Sign out** clears the active local NotebookLM session; **Remove package** removes the managed package and runtime registrations. These are separate confirmed actions.

## Multiple Accounts

Use named profiles only when requested. Pass a profile explicitly and keep notebook IDs explicit. Never export inline auth JSON or copy storage files between profiles as part of an ordinary agent workflow.
