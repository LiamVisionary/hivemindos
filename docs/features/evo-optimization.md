# Evo Optimization Runtime

[Evo](https://github.com/evo-hq/evo) (Apache-2.0) is an autoresearch orchestrator: it runs
benchmark-driven optimization loops where parallel agents explore improvement branches in
isolated git worktrees, with regression/safety gates inherited down the experiment tree and a
local web dashboard for monitoring. HivemindOS manages evo as a background runtime, the same
way it manages Hermes, OpenClaw, and Aeon.

## Install

```sh
uv tool install evo-hq-cli       # installs `evo`, `evo-dashboard`, `evo-drain`
evo install <host>               # register the evo plugin with an orchestrator host
evo doctor <host>                # verify
```

Supported orchestrator hosts include Hermes, OpenClaw, Claude Code, Codex, OpenCode, and Pi.
The host is the agent framework that drives the optimization loop; Hermes registration adds
an entry-point to the Hermes venv and enables the plugin in the gateway config. Note that
`evo install claude-code` writes hooks into Claude Code's own settings, so agents should not
run it on a user's behalf — run it manually where the `/evo:` slash commands are wanted.

## How HivemindOS integrates evo

Evo is a `KnownAgentRuntime` ("evo", kind `background`):

- Detection: `src/lib/services/runtime-availability.ts` checks `EVO_BIN` / `~/.local/bin/evo`.
- Adapter: `src/lib/services/runtime-adapters/evo.ts` reads workspace state directly from
  `<repo>/.evo/` — `meta.json` (active run + orchestrator host), the active run's
  `config.json` (target, benchmark, metric, frontier strategy) and `graph.json` (experiment
  tree). `getStatus` reports workspace/config/best-score plus `dashboardUrl`; `listRuns` maps
  experiment nodes to runtime runs (pending→queued, active→active, committed→completed,
  pruned/discarded→failed).
- Dashboard discovery: a running evo dashboard stamps its real port into
  `.evo/dashboard.port` (starts at 8080 and auto-increments — it never steals a busy port).
  The adapter probes that port and returns the URL; no fleet-wide port scan is needed.
- Scheduler/agent shell: `evo` and `uv` are allowlisted executables in the scheduler
  skill-action route and `AGENT_SHELL_COMMANDS`, so skills and scheduled jobs can run
  `evo status`, `evo dispatch`, etc.
- Profile mapping: an evo agent profile's `localDataDir` points at the repo being optimized
  (falls back to `EVO_WORKSPACE_ROOT`, then the app's working directory).

## Setting up a workspace

Initialize evo against any git repo with a measurable target:

```sh
evo init --name "<project>" \
  --target "<what to optimize and what must not regress>" \
  --benchmark "<command that measures it deterministically>" \
  --metric min|max --host <host> --per-exp-timeout <seconds>
```

Pick a benchmark that runs in seconds and prints a stable metric; experiments report their
result back with `evo done --score`. Add gates so experiments cannot cheat or regress —
gates added to `root` are inherited by the whole tree, and `--phase pre` gates run before any
benchmark spend:

```sh
evo gate add root --name benchmark-untouched --phase pre \
  --command "git diff --quiet HEAD -- <benchmark script>"
```

Add `.evo/` to the repo's `.gitignore`: it holds experiment worktrees and run state.
Inspect with `evo status`, `evo tree`, `evo report --watch`, or the web dashboard. The
optimization loop itself is driven from the orchestrator host and spends agent tokens —
start it deliberately, not as a side effect.

## Fleet machines as evo execution backends

Evo experiments can run on remote SSH hosts (dashboard → Backend tab) in addition to local
worktrees and cloud sandboxes (Modal, E2B, Daytona, AWS, Azure). Fleet machines reachable
over Tailscale SSH are ready-made distributed workers. Configure backends with tailnet
MagicDNS hostnames, never raw Tailnet IPs, and keep collectors private to the tailnet per
the safety rules in `AGENTS.md`.
