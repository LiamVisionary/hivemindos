---
title: Capability Plan Approvals
description: Review, replace, remove, or approve the capabilities an agent proposes before a chat build begins.
---

# Capability Plan Approvals

When you ask an agent in Chat to build something, HivemindOS maps the request to the capabilities the task needs before execution begins. The resulting capability plan distinguishes tools and workflows that are already available from those that need setup.

This keeps the conversation focused on what the agent will actually use. It also gives you a chance to change the shape of the task before an agent installs a workflow or starts producing outputs you do not want.

## Review A Chat Build

Each task step appears as a capability row:

- **Available now** means the capability is already installed, connected, or otherwise ready. Use **Browse** to pick another discovered option, supply a GitHub repository, or add instructions such as “look through GitHub for a better capability.”
- **Setup required** means the proposed capability is not ready yet. Setup approval defaults to **Approve setup**; choose **Reject** when the agent should avoid that installation and redesign that part around what is already available.
- Use the remove button to delete the entire capability step. For example, removing image generation from a larger launch task removes the image output itself, and the agent redesigns the remaining plan so it still makes sense without imagery.

The agent waits until you press **Approve capability plan**. The submitted choices and notes return to the same agent as part of the task context.

New websites, web apps, dashboards, games, and clones use one **App workspace** capability. It creates a separate conversation-bound project and does not mean that the HivemindOS desktop app will be changed. Requests for assets or features *for* an app—such as a logo, checkout component, browser extension, spreadsheet dashboard, or native mobile app—keep their own capability families instead of creating an unrelated web workspace.

Repository-specific engineering workflows are selected only when the request explicitly targets that repository or the chat is attached to its checkout. Merely mentioning a product API as a dependency—for example, writing a separate CLI that calls an API—does not authorize changes to that product’s source tree.

## Set Up A Capability Without Leaving Chat

When a proposed capability is not ready, its row includes **Set up now**. The setup window stays over the current conversation and shows what will be installed or connected, its requirements, source, and safety notes before anything changes.

- Local tools and apps install through the same reviewed setup system used by **My Apps**. The initial installers cover yt-dlp, Whisper, AppFlowy, n8n, Graphify, TradingAgents, and Ghost.
- Hosted or self-hosted services connect through the normal HivemindOS credential flow. Plausible supports its managed cloud and a self-hosted base URL; Cal.com supports hosted or self-hosted API endpoints; Medusa connects to a Store API with a publishable key; Shopify uses a permanent store domain and an Admin API access token.
- Providers with a supported sign-in flow use the existing browser OAuth handoff and return to the same setup window automatically.

After setup succeeds, the capability changes to **Available now** in the plan. You can finish reviewing the rest of the plan and continue the original chat without navigating to another dashboard view.

HivemindOS shows the actual upstream boundary in the catalog: n8n is source-available under its Sustainable Use License, while the free `cal.diy` self-host is intended for personal, non-production use. TradingAgents remains research-only and is not connected to a broker or order-execution path.

Chats waiting on this decision show a highlighted approval icon in Chat history. The same decision appears in **Alerts**, where **Review capability plan** opens the exact chat that is waiting.

## Chats Without Dynamic Controls

Codex, Claude Code, terminal agents, and other chat surfaces that cannot display HivemindOS controls use the same policy in natural language. The agent lists available and setup-required capabilities, names the proposed defaults and important alternatives, and asks one final question before continuing.

## Autonomous Work

Work Board tasks and Zero Human Companies choose and set up capabilities automatically by default. This prevents ordinary tool setup from pausing autonomous work.

- On a Work Board task, open **Assign task** and change **Capability decisions** from **Automatic** to **Ask first** when that individual task should stop for review.
- In a company’s **Approval policies**, change **installing, enabling, or substituting task capabilities** from **Automatic** to **Ask first** when every company task should request capability approval.

Ask-first autonomous work uses the normal **Needs You** workflow. It presents the proposed capability list and waits for a response before setup or substitution.

## Approval Boundary

A capability-plan approval covers capability selection and ordinary setup only. It does not approve spending, reveal credentials, authorize a deployment, permit destructive changes, send an external message, or confirm a payment. Those actions keep their own approval and safety checks.
