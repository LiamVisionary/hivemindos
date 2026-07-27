---
title: "AEON v0.1 Control Plane"
---

# AEON v0.1 Control Plane

HivemindOS can operate a current AEON checkout from the AEON view without asking you to edit configuration files by hand. Link or clone an AEON v0.1 repository, open the agent, and use the Control tab for runtime-wide configuration.

AEON is optional. HivemindOS still works with native crews and other runtimes when no AEON workspace is configured. When you do use AEON, its own workspace and command-line control plane remain the authority for AEON skills, configuration, schedules, runs, logs, and outputs. That authority applies to the linked AEON workspace—not to unrelated HivemindOS features.

The AEON view is an operator interface over that authority. Actions such as enabling a skill, changing a schedule, selecting a model, or installing an MCP server are sent through AEON's own control plane and validation. HivemindOS does not keep a second competing copy of those settings.

## Navigate The AEON View

| Tab | What you can do |
|---|---|
| **Overview** | See whether the workspace is working, scheduled, paused, or idle, plus recent performance and next actions. |
| **Work** | Browse the current skill catalog, run a skill now, put it on duty, pause it, or create an automation with a cadence, brief, and model. |
| **Activity** | Review AEON-only run history, open real run logs, and inspect recent outputs without unrelated repository jobs mixed in. |
| **Deliverables** | Preview artifacts and hand them to another machine through HivemindOS. |
| **Control** | Manage model, harness, gateway, packs, MCP servers, Strategy, Soul, health evidence, provenance, and Telegram delivery. |
| **Settings** | Check workspace compatibility, sync skills and required keys, update or save the repository, inspect memory, and control the Obsidian mirror. |

## Work, Automations, And Activity

The **Work** tab reads the skills AEON actually discovers in the linked workspace. Each skill shows its current duty state, schedule, model, description, source, and declared credential or MCP requirements where available.

From this tab you can:

- run a manual skill immediately
- put a skill on duty, pause it, or resume it
- create an automation without editing YAML or GitHub Actions by hand
- choose a cadence, operating brief, and model override for that skill
- stop the on-duty automations in the selected workspace

The **Activity** tab uses AEON's filtered run history rather than the repository's entire automation history. Open a run to see its real status, conclusion, summary, and logs. Outputs and handoff-ready artifacts remain attached to the selected AEON workspace.

## Control Tab

- choose AEON's default model, Claude or Grok harness, and gateway provider
- browse first-party and community skill packs
- add featured MCP servers and remove configured servers
- read, write, or generate the Strategy document
- build the agent's Soul and Style documents
- review chain definitions and artifacts, reactive rules, and provenance attestations
- review self-healing health records and native OKF knowledge-bundle readiness
- register Telegram delivery using AEON's credential-safe flow
- inspect the exact credential names declared by skills without exposing values

Community packs and MCP servers extend what the workspace can execute. Review their source, requested credentials, and external side effects before installing or enabling them.

## Settings, Sync, And Memory

The **Settings** tab shows whether the current workspace has its configuration, v0.1 CLI, and skill catalog. It also shows repository changes and whether the local checkout is ahead of or behind its remote.

From Settings you can:

- sync the Shared Brain skill library into AEON
- sync only the credential names required by the active harness, gateway, and enabled skills
- update the workspace from GitHub or save current changes to GitHub
- review AEON topics, logs, and issue memory
- start, stop, or run the Obsidian mirror once

Secret values are never returned to the panel. The UI shows credential names and set, shared, local, or missing status so you can configure access without exposing the value.

## Use AEON As A Company Engine

A Zero Human Company can use one linked AEON workspace and one runnable skill as its optional autonomy engine. This is a company-level binding: HivemindOS keeps the charter, apex goal, launch and stop controls, freeze state, and company Runs record, while AEON owns the detailed background execution.

In this mode:

- a native HivemindOS company crew is optional
- the company editor offers only saved AEON workspaces and skills currently discovered there
- the binding is checked again when the company dispatches
- queued or active work in the selected workspace prevents overlapping company dispatches
- company Runs records the accepted handoff without inventing a completed Work Board task
- detailed logs and outputs stay in the AEON view

See [Use AEON With Zero Human Companies](zero-human-companies.html) for the complete operator walkthrough and [Zero Human Companies](../../features/zero-human-companies.html) for the full company cockpit.

## Workspace requirements

A compatible workspace contains:

- `aeon.yml`
- the `apps/cli/aeon` launcher (or a root `aeon` launcher)
- `catalog/skills.json`
- a `skills/` directory

HivemindOS no longer creates an empty AEON-shaped folder. Initialize clones the official AEON repository, while Link validates the selected checkout. A workspace from before AEON v0.1 is reported as legacy and must be updated or re-cloned.

## Artifacts and evidence

HivemindOS discovers current AEON artifacts in `output/articles/`, `output/images/`, `output/.chains/`, `output/.attest/`, and `apps/dashboard/outputs/`. Older output folders remain readable during migration, but new work follows the v0.1 layout.

Run logs come from AEON's filtered run history, so the Activity tab excludes unrelated repository CI. The Deliverables tab can preview local evidence and hand it to another machine through HivemindOS.

## Shared Brain skills and credentials

Shared Brain skills are copied into the checkout's `skills/` directory. AEON v0.1 discovers them from their `SKILL.md` files; HivemindOS does not create the removed root `skills.json` manifest.

Credential sync is allowlisted from the active harness/gateway's core authentication choices plus requirements declared by enabled skills and AEON's secret catalog. Selecting a single missing key syncs only that key. Secret values stay in local/shared credential stores and GitHub secrets; the dashboard receives names and set/missing state only.

## Updating an older workspace

If the AEON status says **legacy**:

1. Commit or back up any work you want to keep in the old repository.
2. Update the checkout from its upstream if it can fast-forward cleanly, or clone a fresh official AEON repository.
3. Reapply custom skills as folders under `skills/`.
4. Link the updated checkout in HivemindOS.
5. Open Control and confirm the CLI, catalog, Strategy/Soul, packs, and MCP inventory load successfully.

HivemindOS intentionally refuses to manufacture missing v0.1 files because a partial workspace looks connected but cannot run AEON correctly.

## Related Guides

- [Use AEON With Zero Human Companies](zero-human-companies.html)
- [Zero Human Companies](../../features/zero-human-companies.html)
- [AEON GitHub Actions Brain Access](github-actions-brain-access.html)
