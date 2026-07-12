---
title: App Builder And Hosting
description: The local-first app-building funnel, hosted Site revenue streams, and web-hosting unit economics.
---

# App Builder And Hosting

HivemindOS now offers a Replit/Lovable-style app-building experience with a
local-first advantage: users can ask an agent to create and refine their app on
hardware they already control, then purchase hosting only when the result needs
to be shared or kept online.

This separates two jobs cleanly:

- **App Builder drives adoption.** Local and linked-machine creation, file
  operations, dependency installation, and loopback previews do not require a
  managed cloud agent.
- **Hive Publish drives recurring revenue.** HivemindOS operates the public
  route, release storage, access policy, renewal lifecycle, and isolated dynamic
  runtime.

For the product workflow, plan limits, and user-facing hosting lifecycle, see
the [App Builder guide](../../for-users/features/app-builder.html).

## Current Revenue Streams

| Revenue stream | Customer value | Current charge |
| --- | --- | ---: |
| Share Preview | A branded URL for a finished static build without an ongoing commitment | **$1 for seven days** |
| Hosted Site | Renewable static hosting for ordinary websites | **$5 per 30 days** |
| Pro Site | Renewable static hosting with a larger release allowance | **$15 per 30 days** |
| Dynamic App | Renewable isolated server-side edge execution | **$25 per 30 days** |

Each charge applies to one Site. One customer can host several Sites, and a
customer who builds entirely on their own machine can still buy any compatible
hosting plan. This expands the paid funnel beyond users who need a Managed Cloud
Agent.

Renewable plans use an opt-in auto-renew setting and debit the customer's hosted
credit balance every 30 days. A seven-day grace period protects an app from an
immediate outage after a failed renewal, and a 30-day retention window gives the
customer time to recover an expired or unpublished release. This is renewable
hosting revenue, not a lifetime-hosting promise.

## Why The Economics Can Scale

The HivemindOS price is collected per Site, while Cloudflare's base Workers
subscription and included request/CPU allowances are shared at the account
level. Current Cloudflare pricing starts with a **$5 monthly account minimum**,
then meters additional requests and CPU at low unit rates. Dynamic Workers also
meter unique workers invoked per day. See Cloudflare's current
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [Dynamic Workers pricing](https://developers.cloudflare.com/dynamic-workers/pricing/).

An illustrative portfolio of **3,000 Dynamic Apps at $25 each produces $75,000
in 30-day hosting revenue**. If all 3,000 stable-ID apps are invoked every day,
the current Dynamic Worker creation schedule contributes approximately $178
above its included allocation, plus the $5 account minimum. At an average of
10,000 dynamic invocations per Site per month and approximately 2.2ms of dynamic
CPU per invocation, the published Cloudflare request, CPU, and worker-creation
rates imply roughly **$190-$200 in monthly Cloudflare compute charges** before
storage, logs, payment processing, support, taxes, and other operating costs.
That illustration produces approximately **99.7% cloud-infrastructure gross
margin**, but it is a utilization example rather than a guaranteed company
margin.

The same low unit rates preserve strong portfolio economics as usage grows. The
important distinction is that the $5 is a monthly minimum, not an unlimited
flat bill: aggregate request, CPU, worker-creation, storage, and database usage
can all create overages.

## Margin Protection

The Dynamic App plan now enforces 10 million requests, 250 million reserved
CPU-ms, 1 million storage operations, and 1 GiB of runtime storage per Site.
Every request reserves the full 25ms invocation ceiling, making the CPU budget
conservative even when actual code usually finishes faster. Exhausted request
or CPU allowances return HTTP 429 until reset; exhausted storage-operation
allowances reject further calls, while capacity-limited writes fail closed
without overwriting the prior value.

At current Cloudflare overage rates, a Site consuming its full conservative
allowance remains bounded relative to its $25 plan revenue, even after the
shared account allocation is exhausted. This replaces an unlimited tail risk
with a known maximum; future published overage packs can create incremental
revenue without silently passing through an unbounded bill.

Investor models should therefore use two cases:

- **Ordinary utilization:** shared fixed infrastructure and inexpensive
  overages can support very high infrastructure gross margins.
- **Heavy utilization:** revenue and enforced allowances remain per Site. The
  product is deliberately bounded and should not be marketed as unlimited.

Official prices, entitlements, renewals, credit debits, and public slug ownership
remain server-authoritative. The open-source app can display and submit a plan,
but it cannot redefine official hosting economics.

<nav class="nextNav" aria-label="Paid feature reading path">
  <a href="index.html">Back to paid features</a>
  <a href="hivemind-cloud-agent-calls.html">Next: Cloud Agent Calls</a>
</nav>
