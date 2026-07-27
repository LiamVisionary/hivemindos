# Publish, Install, and Verify

This is the release path for a HivemindOS-packaged skill that must also work inside Bankr.

## 1. Author the package

Create:

```text
packaged-skills/auto-install/<slug>/
├── SKILL.md
├── references/          # focused markdown loaded on demand
├── scripts/             # deterministic helpers/resources only when useful
└── evals/evals.json
```

The frontmatter needs a clear trigger description. Keep the main body compact and route detail into references. The `name` and integer `version` in `SKILL.md` must exactly match `skill` and `version` in `evals/evals.json`.

If the skill relies on a script inside Bankr, do not assume installation included it merely because `SKILL.md` installed. After installation, inspect the installed resources or exercise the exact script path. Bankr's current format documents script resources, while the GitHub installation page explicitly describes fetching `SKILL.md` and references; real-path verification resolves any installer drift.

## 2. Integrate it with HivemindOS

HivemindOS auto-discovers `packaged-skills/auto-install/*/SKILL.md` through the packaged-skill context index. Also update:

- `packaged-skills/README.md` for the auto-install catalog;
- `docs/for-users/packaged-skills/hive-skills.md` for public user documentation;
- a focused static contract under `scripts/`;
- `CHANGELOG.md` before committing.

Run the generic verifier:

```bash
node packaged-skills/auto-install/bankr-skill-deployment/scripts/verify-bankr-skill.mjs \
  packaged-skills/auto-install/<slug>
```

Then run the feature's focused regression and the repository gates proportionate to the files changed.

## 3. Sync to the Shared Brain

The canonical repository sync engine is:

```bash
node scripts/hive-brain-sync.mjs \
  --content-base <hivemindos-repo> \
  --vault <shared-vault>
```

Run it with `--dry` first. It checks checksums, updates only managed unedited projections, preserves user-edited or unmanaged skills, and writes managed source metadata. The command scans the whole packaged shelf and docs, so read the dry-run output and do not broaden a one-skill task into unrelated vault updates.

After syncing, rebuild or update `Skills/README.md` and verify the new index entry. Compare the packaged and Shared Brain directory hashes while excluding `.hivemind-skill-source.json`, whose provenance timestamp and checksum are projection metadata rather than authored skill content.

Runtime-local skill folders are projections, not the source of truth. Use the existing shared-skill projection flow only when the user also wants a runtime projection; preserve unmanaged collisions.

## 4. Publish before remote installation

Bankr installs from a URL it can reach. The package must be committed and pushed to a public branch or another accessible HTTPS location first.

A local directory or unpushed branch is not remotely installable.

For this repository, the normal prompt is:

```text
install the <slug> skill from https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install/<slug>
```

Installing the same name replaces the current installed copy. This is also the update mechanism.

Before asking Bankr to install, compare the public `SKILL.md` to local source:

```bash
node packaged-skills/auto-install/bankr-skill-deployment/scripts/verify-bankr-skill.mjs \
  packaged-skills/auto-install/<slug> \
  --remote-url https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install/<slug>
```

## 5. Install through Bankr

### Bankr terminal or CLI

Send the install prompt through the user's Bankr agent. The Bankr CLI is convenient because it handles Agent API job polling:

```bash
bankr agent "install the <slug> skill from https://github.com/<owner>/<repo>/tree/main/<path>"
```

Never put a credential in the prompt. Authenticate the CLI through its protected config or env path.

### Agent API

When using REST directly:

1. `POST https://api.bankr.bot/agent/prompt` with the install prompt.
2. Capture the returned `jobId` from the `202 Accepted` response.
3. Poll `GET https://api.bankr.bot/agent/job/{jobId}` about every two seconds.
4. Stop only on `completed`, `failed`, or `cancelled`.
5. Treat timeout as unverified, not success.
6. Read the terminal response and error field; do not accept `pending` or `processing` as installation.

Never log the `X-API-Key` header. Bankr recommends a dedicated, minimally funded account/key for agents.

## 6. Verify the installed copy

Use the Bankr Skills tab or an agent request to inspect:

- installed skill name;
- installed version;
- description;
- required reference and script resource names;
- declared environment-variable names only.

Then exercise a harmless read-only request that should trigger the skill. For a wallet capability, verify identity and balance before any write. For a write, use the smallest authorized amount and inspect the transaction independently.

The session failure mode to prevent is a partially updated package: `SKILL.md` was newer while the installed eval manifest still named an older version. A reinstall is not verified until Bankr reports the new version/resources and the expected behavior runs through the Bankr entry path.

## 7. Deploy and verify x402 Cloud

The current CLI sequence is:

```bash
bankr x402 init
bankr x402 add <service-name>
bankr x402 configure <service-name>
bankr x402 deploy <service-name>
bankr x402 list
bankr x402 schema https://x402.bankr.bot/<wallet>/<service-name>
```

An unpaid request should return `402`:

```bash
curl -i https://x402.bankr.bot/<wallet>/<service-name>
```

Make the smallest explicitly authorized paid call:

```bash
bankr x402 call https://x402.bankr.bot/<wallet>/<service-name> --max-payment <small-usd-cap>
```

Keep the confirmation prompt on unless the user explicitly authorized unattended payment. Verify:

- schema matches the intended input/output contract;
- service URL, network, token, price, and pay-to wallet;
- handler result;
- payment settlement and service revenue;
- no secret values in logs;
- idempotent behavior on a repeated request when the operation changes state.

Use `bankr x402 env list` to inspect variable names only. Do not print values.

## 8. Rollback

- Skill: reinstall the previously published version or remove it from the Bankr Skills tab.
- x402: pause first; delete only when permanent removal is intended.
- External backend: disable new work, preserve receipts, and roll back the known prior deployment.
- Credential: revoke the dedicated key and erase the hosted encrypted copy without deleting transaction audit records.

Report separately what was verified locally, what was verified from public GitHub, what Bankr installed, what was exercised end to end, and what remains unverified.
