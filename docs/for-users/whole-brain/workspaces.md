---
title: Whole Brain Workspaces
description: Isolate multiple HivemindOS shared brains, shared env files, and shared skills shelves.
---

# Whole Brain Workspaces

HivemindOS can register more than one whole-brain workspace. A workspace is a named bundle of:

- an Obsidian vault path
- a shared env file
- a shared skills folder
- a brain-services folder for memory indexes, proofs, and service state

This lets an operator keep the main shared brain separate from a bot, client, project, team, or experiment while reusing the same HivemindOS retrieval, memory, backlinking, shared-env, and shared-skills logic.

## Workspace Store

Workspace definitions live in:

```text
~/.hivemindos/workspaces.json
```

The default workspace is `main`. If the store does not exist, HivemindOS behaves like older versions and uses:

```text
vault: ~/Documents/Obsidian/hivemindos-vault
env:   ~/.hivemindos/.env
skills: <vault>/Skills
brain: <vault>/Operations/Brain Services
```

A workspace entry looks like:

```json
{
  "id": "support-bot",
  "name": "Support Bot Brain",
  "vaultPath": "~/Documents/Obsidian/support-bot-vault",
  "envPath": "~/.hivemindos/workspaces/support-bot/.env",
  "skillsPath": "~/Documents/Obsidian/support-bot-vault/Skills",
  "brainServicesPath": "~/Documents/Obsidian/support-bot-vault/Operations/Brain Services"
}
```

## CLI

Show the current default workspace:

```bash
hive-workspace
```

The command prints the current workspace name, vault/env paths, any other registered workspaces, and the follow-up hint:

```text
want to change your default workspace? run hive-workspace-switch
```

Switch the default workspace:

```bash
hive-workspace-switch
```

In a terminal, this opens an arrow-key picker. Use ↑/↓ to cycle through registered workspaces, Enter to select, or `q` to cancel. Non-interactive callers can pass the id directly:

```bash
hive-workspace-switch support-bot
```

Add a workspace with guided prompts:

```bash
hive-workspace-add
```

For scripts or setup automation, pass the fields directly:

```bash
hive-workspace-add \
  --id support-bot \
  --name "Support Bot Brain" \
  --vault-path "~/Documents/Obsidian/support-bot-vault" \
  --set-active \
  --scaffold
```

## API

List workspaces:

```bash
curl http://127.0.0.1:5020/api/hive/workspaces
```

Create or update a workspace and scaffold the folders:

```bash
curl -X POST http://127.0.0.1:5020/api/hive/workspaces \
  -H 'content-type: application/json' \
  -d '{
    "id": "support-bot",
    "name": "Support Bot Brain",
    "vaultPath": "~/Documents/Obsidian/support-bot-vault",
    "setActive": true,
    "scaffold": true
  }'
```

`setActive` updates the default workspace in `workspaces.json`. `scaffold` creates the vault, skills, brain-services, agent-memory, secure, and env parent folders.

## Runtime Selection

Use an environment variable to select a workspace for a process:

```bash
HIVE_WORKSPACE_ID=support-bot hive-brain answer "what does this bot know?"
HIVE_WORKSPACE_ID=support-bot hive-env-add OPENAI_API_KEY
```

The `hive-brain` CLI also accepts an explicit workspace:

```bash
hive-brain answer "latest commitments" --workspace support-bot
hive-brain remember --workspace support-bot --type learning --title "Refund policy" --content "Refunds are handled by support."
```

Passing `--vault` still wins for one-off local recall. Existing `vaultPath` query/body fields on brain APIs continue to work, so callers can route to a workspace vault without adopting the workspace store immediately.

## Isolation Rules

- Shared env values are read from the selected workspace env file unless a process env value is already set.
- Shared skills are rooted at the selected workspace's `Skills` folder.
- Brain memory indexes and proof receipts live under the selected workspace's `Operations/Brain Services` folder.
- Public docs and setup examples should use placeholder workspace names. Do not document private machine names, personal vault paths, Tailnet IPs, or secret values.
