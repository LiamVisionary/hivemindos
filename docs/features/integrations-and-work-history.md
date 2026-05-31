# Integrations And Work History

The Integrations, My Apps, Phone, and Work History surfaces connect external accounts, expose local/Tailnet apps, and summarize work that has happened across the control room.

## Integrations

The Integrations view currently centers on Nango host setup and connected-account discovery.

How it works:

- UI: `src/features/integrations/NangoIntegrationsView.tsx`.
- Services: `src/lib/services/integrations/nango-client.ts` and `src/lib/services/integrations/nango-host.ts`.
- Routes: `/api/integrations/nango` and `/api/integrations/nango/setup`.
- Remote collector setup can proxy through `/integrations/nango/setup`.

Capabilities:

- Read and update local Nango host config.
- Check Nango host health.
- List Nango connections.
- Start setup on local or capable remote machines.

## My Apps

My Apps is the hivenet launcher for interactive apps and API services discovered through Fleet.

How it works:

- UI: `src/features/dashboard/views/MyAppsPanel.tsx`.
- Discovery route: `/api/fleet/apps`.
- Icon proxy route: `/api/fleet/app-icon`.
- Collector support: `/apps`, `/app-proxy/<port>`, and service health probes.

Capabilities:

- Show local and remote app cards with icons, machine names, online state, and launch URLs.
- Detect API-only services and show service details instead of treating them as broken web apps.
- Discover OpenAPI/Swagger route catalogs where available.
- Use Hivemind-owned service signatures as route catalogs where a known service lacks OpenAPI.
- Copy route URLs and open safe GET routes.

## Phone

Phone support connects the dashboard to the Claw Code Mobile / gateway voice path.

How it works:

- UI: `src/features/dashboard/views/PhonePanel.tsx` and `src/features/dashboard/views/chat/AgentCallsSettingsPanel.tsx`.
- API route: `/api/phone`.
- Gateway service: `src/lib/services/phone/call-gateway.ts`.

Capabilities:

- Read voice gateway config and device status.
- Pair a mobile device through the gateway's pairing flow.
- Ring stored prompts or selected agents.
- Start dashboard in-app agent calls without also ringing the mobile device.
- Build AEON-specific private call context from repo/workspace/memory/skills and recent MiroShark deliverables.

## Work History

Work History summarizes repository and dynamic changelog activity.

How it works:

- Service: `src/lib/services/work-history/dynamic-changelog.ts`.
- API route: `/api/work-history`.
- `src/app/page.tsx` prefetches recent history when the History view is requested.

Capabilities:

- List recent work items.
- Link completed work to Kanban, docs, changelog, and runtime activity.
- Provide a lightweight audit trail of local work.

## Main Code Paths

- `src/features/integrations/NangoIntegrationsView.tsx`
- `src/features/dashboard/views/MyAppsPanel.tsx`
- `src/features/dashboard/views/PhonePanel.tsx`
- `src/features/dashboard/views/chat/AgentCallsSettingsPanel.tsx`
- `src/lib/services/integrations/nango-client.ts`
- `src/lib/services/integrations/nango-host.ts`
- `src/lib/services/phone/call-gateway.ts`
- `src/app/api/fleet/apps/route.ts`
- `src/app/api/fleet/app-icon/route.ts`
- `src/app/api/phone/route.ts`
- `src/app/api/integrations/nango/route.ts`
- `src/app/api/integrations/nango/setup/route.ts`
- `src/lib/services/work-history/dynamic-changelog.ts`
- `src/app/api/work-history/route.ts`
