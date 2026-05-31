# AEON GitHub Actions Brain Access

AEON GitHub Actions runs can join the HivemindOS tailnet as short-lived clients
and call any online HivemindOS brain peer. The runner does not become a
Syncthing peer and does not receive raw filesystem access. It calls the
policy-enforced endpoint:

```text
POST /api/runtimes/aeon/brain
```

## Access Model

The endpoint verifies the GitHub Actions OIDC token, checks the repository
visibility against GitHub, and chooses a policy server-side:

- public or unknown repositories: restricted retrieval and scoped append only
- private repositories: unrestricted vault list, read, search, append, and bulk
- internal repositories: unrestricted by default, configurable in policy

If GitHub visibility cannot be verified, the repository is treated as unknown
and receives the restricted policy.

Restricted mode excludes private paths such as:

```text
PRIVATE/**
People/Private/**
Operations/Secrets/**
**/secrets/**
.obsidian/**
.trash/**
**/.env*
**/*.gpg
```

The local policy file can override defaults at:

```text
<vault>/.hivemindos/aeon-brain-policy.json
```

Example:

```json
{
  "visibility": {
    "public": {
      "maxResults": 20,
      "exclude": ["PRIVATE/**", "People/Private/**", "Finance/**"]
    }
  },
  "repos": {
    "LiamVisionary/specific-public-repo": {
      "mode": "unrestricted",
      "allowedActions": ["policy", "search", "read", "list", "append", "bulk"],
      "allowNoteOpen": true,
      "allowDirectoryListing": true,
      "allowBulkExport": true,
      "include": ["**"],
      "exclude": [],
      "appendAllow": ["**"]
    }
  }
}
```

## Tailnet Policy

Tag HivemindOS machines that serve the endpoint as `tag:hivemind-brain`.
GitHub-hosted AEON runners join as `tag:aeon-ci`. Allow only the brain endpoint
port from the runner tag to the brain-peer tag:

```jsonc
{
  "tagOwners": {
    "tag:aeon-ci": [],
    "tag:hivemind-brain": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["tag:aeon-ci"],
      "dst": ["tag:hivemind-brain"],
      "ip": ["tcp:443"]
    }
  ]
}
```

## Workflow

This follows the OIDC shape used by short-lived Tailscale/GitHub Actions
workflows: get a GitHub OIDC identity for the job, let Tailscale enroll the
runner as `tag:aeon-ci`, then call the HivemindOS brain endpoint.

```yaml
permissions:
  contents: read
  id-token: write

jobs:
  aeon:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Join HivemindOS tailnet
        uses: tailscale/github-action@v4
        with:
          oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
          audience: ${{ secrets.TS_AUDIENCE }}
          tags: tag:aeon-ci
          ping: ${{ vars.HIVE_BRAIN_HOST }}

      - name: Pull scoped brain context
        run: |
          token="$(curl -fsSL "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${HIVE_AEON_BRAIN_OIDC_AUDIENCE}" \
            -H "Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" | jq -r .value)"
          curl -fsSL "https://${HIVE_BRAIN_HOST}/api/runtimes/aeon/brain" \
            -H "Authorization: Bearer ${token}" \
            -H "content-type: application/json" \
            -d '{"action":"search","query":"repo context and prior decisions"}'
        env:
          HIVE_BRAIN_HOST: ${{ vars.HIVE_BRAIN_HOST }}
          HIVE_AEON_BRAIN_OIDC_AUDIENCE: ${{ vars.HIVE_AEON_BRAIN_OIDC_AUDIENCE }}
```

Each HivemindOS brain peer should set the same
`HIVE_AEON_BRAIN_OIDC_AUDIENCE` expected from the workflow token. If it is not
set, the endpoint expects `hivemindos-aeon-brain`. The endpoint uses
`GITHUB_TOKEN`, `GH_TOKEN`, or `GH_GLOBAL` only to verify private repository
visibility through GitHub's repository API.

## Verification

The local end-to-end test starts a real Next server on port `5021` or higher,
calls GitHub's live repository API for one public repo and one private repo,
and verifies the endpoint against a real temporary vault:

```bash
pnpm test:aeon-brain
```

By default it uses:

```text
HIVE_AEON_BRAIN_E2E_PUBLIC_REPO=LiamVisionary/hivemindos
HIVE_AEON_BRAIN_E2E_PRIVATE_REPO=LiamVisionary/claw-code-mobile-private
```

Set those variables to another public/private pair if needed.
