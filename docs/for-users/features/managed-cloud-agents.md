---
title: "Managed Cloud Agents"
---

# Managed Cloud Agents

Managed Cloud Agents run a dedicated Hermes agent on cloud compute so it can
keep working when your laptop, desktop, and other personal machines are off.
Each agent has its own persistent workspace, a stable endpoint, managed model
access, and start/stop controls in HivemindOS.

Open **More → Cloud Agents** to deploy and operate them.

## What You Get

- a dedicated Hermes runtime on cloud compute
- a persistent workspace that survives compute replacement
- browser chat from the HivemindOS dashboard
- server-metered running and stopped rates
- automatic compute shutdown when managed credit runs out
- one-click funding from an eligible governed Base wallet
- start, stop, health, and permanent-delete controls

The initial deployment usually takes a few minutes while the pinned runtime
image is installed. Starting a stopped agent recreates compute around the same
workspace and may take a similar amount of time.

## Plans

| Plan | Compute | Persistent storage | Running | Stopped | Setup |
| --- | --- | --- | --- | --- | --- |
| Small | 2 vCPU · 4 GB RAM | 10 GB | $0.020/hour | $0.0025/hour | $0.050 |
| Medium | 2 vCPU · 4 GB RAM | 20 GB | $0.045/hour | $0.0050/hour | $0.075 |
| Large | 4 vCPU · 8 GB RAM | 40 GB | $0.090/hour | $0.0100/hour | $0.100 |

Model and tool use is billed separately from compute and storage. Current
prices are always loaded from the managed service; rebuilding or editing the
downloaded app cannot change official rates, recipients, balances, or resource
entitlements.

## Funding And Wallet Safety

Funding uses Base USDC. The managed service issues the amount, network, USDC
contract, recipient, expiry, and quote identifier. HivemindOS verifies those
requirements before asking the selected local wallet to sign.

The selected wallet still enforces its normal controls:

- spend must be enabled
- the wallet must use local custody on Base
- the top-up must fit the per-payment cap
- daily, monthly, and company budgets still apply
- company kill switches still apply
- approval thresholds still pause the payment when required
- the same onchain transaction cannot be credited twice

The hosted account credential is encrypted in the local HivemindOS vault. Model
provider keys, infrastructure credentials, official payment policy, and hosted
runtime credentials are not shipped in the app.

## Stop, Start, And Persistence

**Stop** deletes the compute instance while retaining the persistent workspace,
stable address, and firewall. The account moves to the lower stopped rate.

**Start** creates fresh compute, attaches the same workspace, and starts Hermes
again. Files, runtime configuration, and Hermes state stored in the managed
workspace remain available.

**Delete** removes both compute and the persistent workspace. This cannot be
undone.

## Integrations When Personal Machines Are Off

An integration only stays available when the service that owns it is still
running:

| Capability | While personal machines are off |
| --- | --- |
| Managed inference and files in the cloud workspace | Available |
| A cloud API or cloud-hosted MCP promoted into managed secret storage | Available after it is connected in the managed environment |
| Shared Brain content replicated into the managed workspace | Available after managed sync is enabled |
| A Tailnet app or MCP running on another always-on machine | Available while that source machine and its private bridge are online |
| A local MCP, filesystem, browser session, or app on an offline Mac | Unavailable |

The beta does **not** silently copy existing OAuth tokens, MCP configuration,
Shared Brain contents, or Tailnet access from a laptop into the cloud. Those are
separate trust decisions. A future promotion flow can move cloud-safe
connections into hosted custody, while machine-bound capabilities remain
clearly tied to the machine that owns them.

This distinction prevents a cloud agent from pretending it can use an offline
Mac and prevents local secrets from being uploaded without an explicit setup
step.

## Open-Source Boundary

Local, bring-your-own-key, and self-hosted HivemindOS remain available without
managed credits. The public app contains the client, UI, wallet-policy checks,
and self-hosted-compatible contract. Official balances, payment settlement,
prices, metering, resource ownership, provider secrets, and cloud entitlements
are enforced by HivemindOS-managed infrastructure.

