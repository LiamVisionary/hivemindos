---
title: "Integrations And Work History"
---

# Integrations And Work History

Integrations connect HivemindOS to outside systems without letting those systems own the local control room.

Work History is the local receipt trail. It keeps product work, changelog entries, and agent-visible changes close to the board instead of buried in git commands or terminal output.

## Integrations

The Integrations view owns setup/debug details for external systems that should not clutter daily Work or Fleet surfaces.

How it works:

- UI: `src/features/integrations/ConnectionsPanel.tsx` and `src/features/integrations/GitLawbIntegrationPanel.tsx`.
- Services: `src/lib/services/integrations/provider-connections.ts`, `src/lib/services/integrations/github-oauth.ts`, and `src/lib/services/integrations/google-oauth.ts`.
- Routes: `/api/integrations/connections`, `/api/integrations/github/oauth/*`, `/api/integrations/google/oauth/*`, `/api/gitlawb/*`, and `/api/projects/*`.
- Credentials are validated live against each provider, then stored in the shared hive env (`hive-env-add`), which replicates them to every machine — no host machine or separate service to run.

What Integrations can do:

- Connect GitHub, Linear, Slack, Notion, and Google in place, without leaving the app.
- Connect GitHub with one click via in-app OAuth, or by pasting a personal access token.
- Connect Google via in-app OAuth with a one-time pasted OAuth client (Desktop app type).
- Show live per-app status (connected account, failing check) and disconnect in place.
- Show GitLawb Code Proof readiness, local DID status, optional node status, and linked project count.
- Install/repair the lightweight GitLawb CLI where supported.
- Create a local GitLawb DID without public registration.
- Keep full GitLawb node setup lazy and local/Tailnet-only by default.

## GitLawb Code Proof

GitLawb is the code provenance integration. HivemindOS uses it as signed proof for project-linked work while the private Brain remains HivemindOS-owned memory and audit.

How it works:

- Service wrapper: `src/lib/services/gitlawb/gitlawb-service.ts`.
- Project registry: `src/lib/services/projects/project-registry.ts`.
- API routes: `/api/gitlawb/status`, `/api/gitlawb/setup-cli`, `/api/gitlawb/identity`, `/api/gitlawb/node/setup`, `/api/projects`, and `/api/projects/link-gitlawb`.
- Shared-vault project storage: `Operations/Code Projects/projects.json`.
- Local fallback project storage: `~/.hivemindos/projects.json`.

What GitLawb support can do:

- Detect `gl`, `git-remote-gitlawb`, and `gitlawb-node`.
- Detect or create a local DID.
- Probe local node health at `http://127.0.0.1:7545` by default.
- Surface repo count, peer count, and MCP availability when a node is healthy.
- Link many HivemindOS projects to many GitLawb repos on the same machine.
- Redact private keys, secrets, Tailnet IPs, and exact private vault paths from proof metadata.

See [GitLawb Code Proof](../integrations/gitlawb.md) for setup weight, lazy node behavior, and uninstall details.

## GitHub OAuth Fallback

AEON uses the same direct GitHub OAuth helper as the Connections tab when the operator wants a simple account connection for repository automation.

How it works:

- Start route: `/api/integrations/github/oauth/start`.
- Callback route: `/api/integrations/github/oauth/callback`.
- Service: `src/lib/services/integrations/github-oauth.ts`.
- The callback stores the token as `GH_GLOBAL` through `hive-env-add`.

What GitHub OAuth can do:

- Detect missing OAuth app config and return an operator-readable setup page.
- Use signed OAuth state cookies to guard the callback.
- Save GitHub access for AEON Actions, workflow dispatch, issue triggers, repo sync, and repository visibility checks.
- Return to AEON or Integrations depending on the source that started the flow.

## My Apps

My Apps is the hivenet launcher for interactive apps and API services discovered through Fleet.

How it works:

- UI: `src/features/dashboard/views/MyAppsPanel.tsx`.
- Discovery route: `/api/fleet/apps`.
- Icon proxy route: `/api/fleet/app-icon`.
- Collector support: `/apps`, `/app-proxy/<port>`, and service health probes.

What My Apps can do:

- Show local and remote app cards with icons, machine names, online state, and launch URLs.
- Detect API-only services and show service details instead of treating them as broken web apps.
- Discover OpenAPI/Swagger route catalogs where available.
- Use Hivemind-owned service signatures as route catalogs where a known service lacks OpenAPI.
- Copy route URLs and open safe GET routes.

## Phone

Phone support connects the dashboard to the HivemindOS Mobile / gateway voice path.

How it works:

- UI: `src/features/dashboard/views/PhonePanel.tsx` and `src/features/dashboard/views/chat/AgentCallsSettingsPanel.tsx`.
- API route: `/api/phone`.
- Gateway service: `src/lib/services/phone/call-gateway.ts`.

What Phone can do:

- Read voice gateway config and device status.
- Pair a mobile device through the gateway's pairing flow.
- Ring stored prompts or selected agents.
- Start dashboard in-app agent calls without also ringing the mobile device.
- Build AEON-specific private call context from repo/workspace/memory/skills and recent MiroShark deliverables.

The full Calling guide separates free BYOK Agent Calls from paid HivemindOS Cloud Agent Calls: [Calling](calling.html).

## Work History

Work History summarizes repository and dynamic changelog activity.

How it works:

- Service: `src/lib/services/work-history/dynamic-changelog.ts`.
- API route: `/api/work-history`.
- `src/app/page.tsx` prefetches recent history when the History view is requested.

What Work History can do:

- List recent work items.
- Filter by project.
- Search by text.
- Page through older entries without reloading the whole dashboard.
- Link completed work to Kanban, docs, changelog, and runtime activity.
- Provide a lightweight audit trail of local work.

## Main Code Paths

- `src/features/integrations/ConnectionsPanel.tsx`
- `src/features/integrations/GitLawbIntegrationPanel.tsx`
- `src/features/dashboard/views/MyAppsPanel.tsx`
- `src/features/dashboard/views/PhonePanel.tsx`
- `src/features/dashboard/views/chat/AgentCallsSettingsPanel.tsx`
- `src/lib/services/integrations/github-oauth.ts`
- `src/lib/services/gitlawb/gitlawb-service.ts`
- `src/lib/services/projects/project-registry.ts`
- `src/lib/services/integrations/provider-connections.ts`
- `src/lib/services/integrations/shared-env.ts`
- `src/lib/services/integrations/google-oauth.ts`
- `src/lib/services/phone/call-gateway.ts`
- `src/app/api/fleet/apps/route.ts`
- `src/app/api/fleet/app-icon/route.ts`
- `src/app/api/phone/route.ts`
- `src/app/api/integrations/github/oauth/start/route.ts`
- `src/app/api/integrations/github/oauth/callback/route.ts`
- `src/app/api/integrations/connections/route.ts`
- `src/app/api/integrations/google/oauth/start/route.ts`
- `src/app/api/integrations/google/oauth/callback/route.ts`
- `src/app/api/gitlawb/**`
- `src/app/api/projects/**`
- `src/lib/services/work-history/dynamic-changelog.ts`
- `src/app/api/work-history/route.ts`
