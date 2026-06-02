# GitLawb Code Proof

GitLawb integration gives HivemindOS a signed code-provenance layer without making GitLawb own the private Brain, Work board, or machine routing model.

HivemindOS remains the operator UX and private audit surface. GitLawb provides public-key identity, signed code metadata, optional repo hosting, and future decentralized transport hooks.

## Default Setup

HivemindOS uses a proof-ready default:

- GitLawb CLI and remote helper are recommended during macOS/Linux setup.
- A local DID can be created during setup with `gl identity new`.
- Public node registration is not performed by default.
- A GitLawb node is not started by default.
- Public federation, staking, IPFS, Arweave, and public exposure remain explicit opt-in work.

The Tauri first-run wizard opens a user-approved Terminal command that runs `setup.sh --interactive ...`. That setup path prompts for Code Proof from the terminal. The wizard itself does not silently install GitLawb in the background.

Windows setup currently detects an existing `gl` and can create a DID if present, but it does not run the macOS/Linux static installer automatically.

## Full Node Weight

The full local GitLawb node is lazy because it is heavier than CLI proof readiness.

The upstream Docker Compose stack starts:

- `postgres:16-alpine`
- one `gitlawb-node` container
- a Postgres data volume
- a GitLawb repo/key data volume
- HTTP/git smart-HTTP on port `7545`
- libp2p UDP on port `7546`

The first setup can be meaningfully heavier because Docker builds the Rust node image. Once built, the runtime footprint is closer to a small database plus one API daemon. HivemindOS therefore keeps this as a project-triggered capability instead of a first-run requirement.

## UI Surfaces

| Surface | GitLawb behavior |
|---|---|
| Setup | Detects/offers CLI and DID, never starts a node by default |
| Integrations | Shows Code Proof status, setup actions, DID status, and lazy node guidance |
| Work | Lets tasks optionally attach a project and displays a compact proof badge |
| Fleet | Shows a compact Code Node/Code Proof chip on the primary machine |
| Agents | Agent profiles may carry public-only DID status; private keys are never mirrored |

Advanced GitLawb protocol details belong in Integrations, not the primary Work or Fleet surfaces.

## Project Model

Projects are independent records. A machine can work on many projects and each project can link to its own GitLawb repo.

Project registry storage:

- Shared vault: `Operations/Code Projects/projects.json`
- Local fallback: `~/.hivemindos/projects.json`

Kanban tasks may include:

- `projectId`
- `proofs`

Proof metadata is sanitized before storage. HivemindOS must not store private keys, secret env values, Tailnet IPs, or exact private vault paths inside GitLawb proof metadata.

## API Routes

| Route | Purpose |
|---|---|
| `GET /api/gitlawb/status` | Safe CLI, DID, node, repo-count, peer-count, and MCP availability status |
| `POST /api/gitlawb/setup-cli` | Install or repair the lightweight GitLawb CLI path where supported |
| `POST /api/gitlawb/identity` | Create or refresh a local GitLawb DID |
| `POST /api/gitlawb/node/setup` | Lazy node setup status/guidance |
| `GET /api/projects` | Read project registry from the shared vault or local fallback |
| `POST /api/projects` | Create or update a project |
| `POST /api/projects/link-gitlawb` | Link a project to GitLawb repo metadata and degrade gracefully when the node is offline |

All GitLawb commands are wrapped with short timeouts and safe structured responses. Missing or broken GitLawb must never block normal HivemindOS setup or task execution.

## Uninstall

The uninstall scripts mirror setup one prompt at a time:

- Remove HivemindOS GitLawb status/config cache.
- Remove fallback HivemindOS project registry only when approved.
- Remove HivemindOS-managed GitLawb CLI binaries only when an install marker exists.
- Remove GitLawb env keys from `.env.local` when approved.
- Remove local GitLawb identity only behind a destructive warning.
- Stop/remove a GitLawb node only if HivemindOS created and marked it.

## Main Code Paths

- `src/lib/services/gitlawb/gitlawb-service.ts`
- `src/lib/services/projects/project-registry.ts`
- `src/app/api/gitlawb/**`
- `src/app/api/projects/**`
- `src/features/integrations/GitLawbIntegrationPanel.tsx`
- `src/features/dashboard/views/KanbanPanel.tsx`
- `src/components/fleet/FleetView.tsx`
- `src/components/fleet/roster.tsx`
- `setup.sh`
- `setup.ps1`
- `uninstall.sh`
- `uninstall.ps1`
