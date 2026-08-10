# Upstream provenance

- Repository: <https://github.com/MadsLorentzen/ai-job-search>
- Pinned commit: `fab1e78fa293d0255d739162a4f8f82db4144876`
- Commit date: 2026-08-09
- Source archive SHA-256: `3e10d2bdd790937264a88231c5d8fe416c6fb247821178c2b7d3f9e44d6d7d03`
- License: MIT; copied in `LICENSE`

## Assimilated paths

| Upstream | Packaged target | Reuse |
| --- | --- | --- |
| `CLAUDE.md` | `references/application/00-overview.md` | adapted provider-neutral workspace overview |
| `.claude/commands/*.md` | `references/workflows/*.md` | copied workflow specifications with workspace-path and connector bindings adapted for HivemindOS |
| `.claude/skills/job-application-assistant/*` | `references/application/*` | copied profile/application methodology with workspace-path adaptation; nested `SKILL.md` renamed `workflow.md` |
| `.claude/skills/job-scraper/*` | `references/job-search/*` | copied scraper and search configuration with workspace-path adaptation |
| `.claude/skills/upskill/SKILL.md` | `references/job-search/upskill.md` | copied learning-gap workflow with workspace-path adaptation |
| `.agents/skills/*/SKILL.md` and `url-reference.md` | `references/portals/*/portal.md` and `url-reference.md` | copied portal contracts; nested skill files renamed so the HivemindOS catalog exposes one aggregate skill |
| `.agents/skills/*/cli/` | `scripts/portals/*/` | copied TypeScript clients and tests |
| `cv/`, `cover_letters/`, `templates/` | `templates/` | copied application templates and fonts |
| `salary_lookup.py`, `tools/convert_salary_excel.py`, `tools/verify_pdf.py`, `tools/robots_check.py` | `scripts/` | copied executable helpers; robots checker adapted to accept the active runtime agent token |
| `documents/README.md`, `tools/README_SALARY_TOOL.md` | `references/` | copied workspace and salary documentation |

`SKILL.md`, `SECURITY_AUDIT.md`, `THIRD_PARTY_NOTICES.md`, catalog metadata, HivemindOS tests, and public documentation are HivemindOS adaptations around those concrete upstream resources.

## Intentional exclusions

- `SETUP.md`: excluded because it contains a mutable curl-to-shell Bun installer. HivemindOS never runs or recommends that path.
- `.claude/settings.json`: excluded because runtime permission declarations are provider-specific and do not grant HivemindOS authority.
- `.github/`, contribution templates, funding metadata, mascot assets, upstream changelog, and project-level CI: repository-maintenance material, not runtime capability.
- Mutable personal state and example directory placeholders: the installed skill creates missing state only in a user-chosen private workspace.
