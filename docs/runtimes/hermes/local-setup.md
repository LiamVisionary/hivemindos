# HivemindOS Local Setup

Use a local, read-only by default clone of `shannhk/hermes-agent-control-room` as the seed for VPS and Hermes deployment workflows:

```text
~/agent-control-room
```

Pin the clone to a reviewed commit before running any bootstrap scripts. The commit below is an example of the version this project was initially inspected against:

```text
48a1a5a2c3a64416f51b0199a1acc9aba05e6261
```

Safety posture:

- The VPS bootstrap script was inspected but not run.
- Live installers were not executed.
- Docker images were not pulled.
- For audit-only clones, disable pushes with `git remote set-url --push origin DISABLED`.
- The HivemindOS dashboard validates this folder and forwards its path to opted-in agents as context.

Known live-code risks in the upstream bootstrap:

- NodeSource installer
- Docker installer
- Hermes installer
- global npm packages for Claude Code and Codex
- `nousresearch/hermes-agent:latest` in Docker templates

Use HivemindOS as docs, templates, registry, runbooks, and task bus structure on this computer. Install or run Hermes runtime pieces separately only after reviewing and pinning each external dependency.
