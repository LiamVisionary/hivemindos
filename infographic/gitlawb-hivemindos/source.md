# HivemindOS + GitLawb Integration

GitLawb becomes a proof-ready default in HivemindOS without making first setup heavy.

Default posture:

- GitLawb CLI + DID: enabled by default, non-blocking if install fails.
- GitLawb node: optional, one-click, local/Tailnet-only by default.
- Public node/federation: explicit opt-in only.
- HivemindOS Brain remains private memory/audit.
- GitLawb provides signed code provenance.

Core flow:

1. Setup detects or installs the lightweight GitLawb CLI.
2. Setup detects or creates a local DID.
3. Work tasks can optionally link to a Hivemind Project.
4. A Hivemind Project can link to a GitLawb repo.
5. Agents and humans produce commits, refs, issue/PR metadata, and signed writes.
6. Work and Fleet show compact proof status.
7. A full local GitLawb node starts only when a project needs local repo hosting.

Boundary:

- Private memory, audit trails, vault notes, machine routing, and task coordination stay in HivemindOS.
- Public-key identity, signed repo provenance, clone/fetch/push health, repo count, peer count, and recent ref updates belong to GitLawb.
- No private keys, secret env values, Tailnet IPs, or exact private vault paths should enter proof metadata.
