---
title: "Use AEON With Zero Human Companies"
description: Choose an AEON workspace and skill as the optional autonomy engine for a Zero Human Company.
---

# Use AEON With Zero Human Companies

AEON can run the recurring background duty for a Zero Human Company. This is optional: HivemindOS works without AEON, and every company starts with **HivemindOS crew** as its default autonomy engine.

Choose AEON when the company goal already maps to one repeatable skill that should run in a managed AEON workspace. Keep the HivemindOS crew engine when the goal should be planned into multiple Work Board tasks and routed across a team.

## Before You Start

You need:

- a current AEON workspace linked in HivemindOS
- at least one runnable skill in that workspace
- the credentials and permissions required by that skill
- an apex goal for the company

If you have not linked AEON yet, start with the [AEON v0.1 Control Plane](v01-control-plane.html) guide.

## Choose The Right Engine

| Choose | Best for | Crew requirement | Where work appears |
|---|---|---|---|
| **HivemindOS crew** | Goals that need planning, delegation, approvals, and several agent roles | At least one company agent | Work Board, Deliverables, Learning, and Runs |
| **AEON background skill** | One repeatable background duty already represented by an AEON skill | Native company agents are optional | Company Runs for the dispatch record; AEON for detailed run state and outputs |

You can change the engine later from **Edit company**. Switching back to the HivemindOS crew engine requires a staffed company before launch.

## Connect A Company To AEON

1. Open **Companies**.
2. Choose **Found a company**, or open an existing company and choose **Edit company**.
3. Under **Autonomy engine**, choose **AEON background skill**.
4. Choose a saved **AEON workspace**.
5. Choose one of the skills currently available in that workspace.
6. Add a company crew if it is useful for oversight, email, wallets, or other company work. A native crew is optional for AEON execution.
7. Save or found the company.

HivemindOS checks the workspace and skill before saving. It checks them again before each dispatch, so a renamed, removed, or disconnected binding cannot silently run something else.

## Launch And Monitor It

1. Open the company's **Board** tab.
2. Choose **Launch AEON skill**.
3. Open **Runs** to confirm that AEON accepted the company dispatch.
4. Open the **AEON** view to follow detailed run state, logs, and outputs in the selected workspace.

The company reuses the saved workspace and skill on later autonomy cycles. A cycle runs only when the selected AEON workspace has no queued or active run. If HivemindOS cannot read workspace activity, it waits rather than starting another job blindly.

Because activity is checked at the workspace level, companies that share one AEON workspace are serialized behind any queued or active run there. Use separate workspaces when companies need independent concurrency or different permission boundaries.

## What Each Layer Owns

| HivemindOS owns | AEON owns |
|---|---|
| Company identity, charter, apex goal, and selected binding | Skill implementation and runtime configuration |
| Launch, stop, freeze, and home-machine ownership | Runtime credentials and provider permissions |
| The accepted-dispatch record in company Runs | Detailed run status, logs, schedules, and outputs |
| Company governance and operator-facing controls | Workspace-level execution and artifact history |

An accepted AEON dispatch does not create a fake completed Work Board task. The company Runs tab proves that HivemindOS handed off the goal; the AEON workspace remains the source of truth for what the skill did afterward.

## Safety And Cost Boundaries

- **Stop autonomy** prevents future company dispatches. A job AEON already accepted may finish.
- Freezing the company prevents future cycles, but it does not revoke a provider request already in flight.
- Company Work Board budgets do not automatically cap external AEON provider usage. Configure provider limits and permissions in the AEON workspace.
- Keep destructive actions, public publishing, customer contact, and money movement behind the approvals appropriate to the selected skill and provider.
- Fleet outages can pause native-crew companies without stopping an AEON-backed company whose workspace remains reachable.

## Troubleshooting

### The workspace does not appear

Open the AEON view and confirm that the workspace is linked and recognized as current. Legacy or unavailable workspaces are not offered as new company bindings.

### The skill does not appear

Confirm that the skill exists in the selected workspace and is runnable there. Refresh the company editor after updating the AEON workspace.

### A previously selected value says unavailable

The company keeps the old name visible so you can see what changed, but it will not silently substitute another workspace or skill. Choose a current value before saving.

### Launch waits even though this company has no Work Board tasks

Check the selected AEON workspace. Any queued or active run there makes the workspace busy, including work launched outside the company.

### Runs shows an accepted dispatch but no Work Board card

That is expected in AEON mode. Follow the detailed run and its outputs in the AEON view. Choose the HivemindOS crew engine when the work should be decomposed into Work Board tasks.

## Related Guides

- [Zero Human Companies](../../features/zero-human-companies.html)
- [AEON v0.1 Control Plane](v01-control-plane.html)
- [Work Board And Scheduler](../../features/work-and-scheduler.html)
- [AEON GitHub Actions Brain Access](github-actions-brain-access.html)
