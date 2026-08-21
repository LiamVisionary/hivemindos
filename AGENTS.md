# Public Documentation Rules

These rules apply under `docs/` in addition to the repository root instructions.

## Public Scope

- Write for any HivemindOS installer. Do not publish personal names, machine names, hostnames, local paths, Tailnet details, current workspace state, private operations, or session history.
- Lead with what users can do, what they should expect, and which boundary applies. Avoid internal routes, service names, file paths, and test jargon unless the page is explicitly developer/API documentation.
- Use reproducible placeholders such as `<repo>` and `<host>`. Put personal operating state in Shared Brain Memory or the private vault, implementation receipts in `CHANGELOG.md`, and live status in the control room.
- Re-read a changed page as a stranger installing the product. Anything they cannot reproduce or should not know belongs elsewhere.

## Documentation Contracts

- Hive Superbrain docs live under the stable `docs/for-users/whole-brain/` path. Keep them synchronized with setup initializers, vault doctor behavior, shared skills, and `scripts/test-vault-structure-contract.mjs`.
- Packaged-skill changes must update `packaged-skills/README.md`, `docs/for-users/packaged-skills/`, and `docs/for-users/whole-brain/shared-skills.md` when shared-brain behavior changes.
- Slash-command changes must update `docs/for-users/slash-commands.md` in the same change.
- User-visible features and fixes should be written in release-note language that can be reused in app releases.

## Landing And Release Assets

- The public landing site is a separate Next.js repository. `src/app/page.tsx` here is the dashboard, not the landing page.
- Stable release filenames are a contract with the landing page and updater. A rename must update the workflow collection step, `scripts/build-updater-manifest.mjs`, and landing-site download cards together. Read `LANDING_PAGE.md` first.
