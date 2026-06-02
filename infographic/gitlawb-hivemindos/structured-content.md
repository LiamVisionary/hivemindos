# HivemindOS + GitLawb

## Overview
GitLawb integrates as HivemindOS Code Proof: lightweight CLI + DID by default, optional local node only when a project needs repo hosting.

## Learning Objectives
The viewer will understand:
1. GitLawb is proof-ready by default without forcing the full node.
2. HivemindOS Brain and GitLawb have separate responsibilities.
3. Code Proof appears in the simple daily surfaces: Setup, Work, Fleet, Agents, and Integrations.

---

## Section 1: Default Setup

**Key Concept**: First run makes code provenance available without blocking normal setup.

**Content**:
- GitLawb CLI + DID: enabled by default, non-blocking if install fails.
- Do not register with the public node by default.
- Do not start a GitLawb node by default.

**Visual Element**:
- Type: numbered setup rail
- Subject: detect CLI, create DID, keep node off
- Treatment: compact blueprint steps with check marks

**Text Labels**:
- Headline: "1. Code Proof Setup"
- Labels: "Detect CLI", "Create DID", "Node stays off"

---

## Section 2: Private Brain

**Key Concept**: HivemindOS remains the private operating memory and coordination system.

**Content**:
- HivemindOS Brain remains private memory/audit.
- Projects in shared vault: Operations/Code Projects/projects.json.
- Local fallback: ~/.hivemindos/projects.json.

**Visual Element**:
- Type: protected vault core
- Subject: Obsidian vault, project registry, work tasks, agent audit
- Treatment: shielded left-side module

**Text Labels**:
- Headline: "Private Brain"
- Labels: "Vault notes", "Project registry", "Task audit", "Machine routing"

---

## Section 3: Code Provenance

**Key Concept**: GitLawb owns signed code identity and proof metadata.

**Content**:
- GitLawb provides signed code provenance.
- GitLawbIdentity: did, source, publicOnly, lastCheckedAt.
- GitLawbProof: issue/PR/commit/ref metadata with actorDid, repo, branch, commit/ref, status, and verifiedAt.

**Visual Element**:
- Type: signed proof module
- Subject: DID key, signed refs, repo proof badge
- Treatment: right-side module with cryptographic callouts

**Text Labels**:
- Headline: "Signed Code Proof"
- Labels: "DID", "Signed commits", "Repo provenance", "Proof badge"

---

## Section 4: Work Flow

**Key Concept**: Several projects can live on one machine and link to separate GitLawb repos.

**Content**:
- HivemindProject: id, name, localPath, vaultNotePath, preferredMachineKey, gitlawbRepo?, allowedAgentIds, timestamps.
- Work tasks add optional projectId and proofs.
- Multiple projects can link to multiple repos on one machine.

**Visual Element**:
- Type: branching project map
- Subject: one machine connected to project A, project B, project C, each with optional repo link
- Treatment: center-lower branch diagram

**Text Labels**:
- Headline: "Many Projects, One Machine"
- Labels: "Project A", "Project B", "Project C", "Optional repo link"

---

## Section 5: Lazy Node

**Key Concept**: The full GitLawb node is a machine capability, not a first-run requirement.

**Content**:
- GitLawb node: optional, one-click, local/Tailnet-only by default.
- Public node/federation: explicit opt-in only.
- If Docker/Postgres is missing, keep CLI-only proof readiness active.

**Visual Element**:
- Type: dormant server block
- Subject: local/Tailnet-only node with health, peers, repos, ref updates
- Treatment: machine capability callout under Fleet

**Text Labels**:
- Headline: "Lazy Local Node"
- Labels: "Health", "Repo count", "Peer count", "Recent refs", "Public opt-in"

---

## Section 6: Redaction Boundary

**Key Concept**: Proof metadata must not leak private operational details.

**Content**:
- No private keys, secret env values, Tailnet IPs, or exact private vault paths should enter proof metadata.

**Visual Element**:
- Type: boundary gate
- Subject: allowed proof metadata passing through, secrets blocked
- Treatment: redaction strip across the private/public boundary

**Text Labels**:
- Headline: "Redaction Boundary"
- Labels: "Allowed: actorDid, repo, branch, commit/ref, status", "Blocked: keys, secrets, Tailnet IPs, vault paths"

---

## Design Instructions

### Style Preferences
- technical-schematic
- blueprint grid
- deep blue, cyan, amber, white lines

### Layout Preferences
- structural-breakdown
- exploded system core with callout labels
- landscape 16:9
