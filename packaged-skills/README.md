# Packaged Skills

This folder is the product-facing catalog for HivemindOS skills used by setup and future one-click install flows.

Use this folder only for skills intended to ship with HivemindOS as installable user content. Agent-only working skills should live in the shared Obsidian brain skill shelf, not in this repository.

Expected layout:

```text
packaged-skills/
  auto-install/
    <slug>/
      SKILL.md
      ...
  optional/
    <slug>/
      SKILL.md
      ...
```

## Auto-Install

Skills in `auto-install/` are copied into the user's shared HivemindOS brain `Skills/` shelf during setup. Agents discover those skills from the shared brain after installation, not because they live in this repository folder.

Keep this folder small and foundational. These skills become part of the default shared context for HivemindOS users.

## Optional

Skills in `optional/` are a store/catalog for later one-click install. They must not be automatically copied into the shared brain, mirrored into runtime skill folders, or injected into agent context.

When a user installs an optional skill, the app should copy that skill from `packaged-skills/optional/<slug>/` into the configured shared brain `Skills/<slug>/` folder and rebuild the shared skill index.

Keep packaged skills self-contained, user-safe, and installable without relying on Liam's local agent runtime paths.
