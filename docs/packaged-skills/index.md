---
title: Packaged Skills
description: HivemindOS packaged skill catalog, auto-install policy, and optional skill boundaries.
---

# Packaged Skills

Packaged skills are repository-shipped agent procedures that HivemindOS can install into the shared brain `Skills/` shelf.

They are different from one-off runtime skills. A packaged skill is product content: it can be copied into the user's vault, indexed by the shared brain, mirrored to compatible runtimes, and documented for GitHub Pages.

## Catalog Split

| Subdivision | Location | Install behavior |
| --- | --- | --- |
| Hive skills | `packaged-skills/auto-install/` | Installed into the shared brain during setup because they teach HivemindOS-native workflows. |
| Third-party packaged skills | `packaged-skills/auto-install/` or `packaged-skills/optional/` | Curated external or optional skills. Auto-install only when foundational; otherwise install on demand. |

## Auto-Install Skills

Setup copies auto-install skills into:

```text
<shared-vault>/Skills/<slug>/SKILL.md
```

Agents should discover them from the shared brain index, not from the repository folder directly.

Auto-install is reserved for foundational workflows that make a fresh HivemindOS install usable for agents immediately.

## Optional Skills

Optional packaged skills live under:

```text
packaged-skills/optional/<slug>/
packaged-skills/optional/<category>/<source>/<slug>/
```

They are catalog content until a user installs them. Optional skills must not be silently copied into the shared brain or runtime homes.

Grouped optional directories can appear as installable packs in the Skill Browser. Installing one of those packs copies every local packaged skill in the directory into the shared brain after audit; it does not run upstream installer commands.

## Current Guides

<div class="docGrid">
  <section class="docCard">
    <h3>Hive Skills</h3>
    <p>HivemindOS-owned skills for assimilation, capability search, skill fusion, workflow fusion, and AEON fusion.</p>
    <a href="hive-skills.html">Open Hive skills</a>
  </section>
  <section class="docCard">
    <h3>Third-Party Skills</h3>
    <p>Curated external and optional skills, including the Obsidian Native Brain Pack and optional UI, media, and automation skill packs.</p>
    <a href="third-party-skills.html">Open third-party skills</a>
  </section>
</div>

## Maintenance Rule

Any packaged skill addition, removal, rename, install-policy change, or source relocation must update:

- `packaged-skills/README.md`
- this docs section
- `docs/whole-brain/shared-skills.md` when shared brain behavior changes
- `AGENTS.md` so future agents know the docs contract
- `scripts/test-vault-structure-contract.mjs` when the skill affects required brain setup or docs navigation
