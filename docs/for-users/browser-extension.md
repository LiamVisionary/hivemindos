---
title: Browser Extension
description: Use a Chromium side panel to ask HivemindOS agents about the active page, selected text, and open tabs.
---

# Browser Extension

HivemindOS Browser adds the hive to the side of Chrome, Edge, Brave, and compatible Chromium browsers. You can ask any configured agent to summarize a page, explain technical material, rewrite a selection, compare tabs, or extract action items without copying browser text into Chat by hand.

## Install from HivemindOS

1. Open **Integrations** and stay on **Connections**.
2. Find **HivemindOS Browser**, choose Chrome, Edge, Brave, or another detected compatible browser, then select **Prepare & open browser**.
3. HivemindOS prepares a stable extension folder, reveals it in your file manager, and opens the browser's Extensions page.
4. Turn on **Developer mode**, choose **Load unpacked**, and select the revealed `browser-extension` folder.
5. Select the HivemindOS extension icon to open its side panel.

Browser security requires the final **Load unpacked** confirmation, so HivemindOS cannot silently complete that last click. The Integrations card keeps **Show folder**, **Open Extensions**, and **Copy path** actions available if you need them again.

## Install from a source checkout

From a HivemindOS source checkout, build the extension:

```bash
pnpm browser-extension:build
```

Then:

1. Open `chrome://extensions` or the equivalent extensions page in your browser.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the generated `browser-extension/dist/` folder.
5. Click the HivemindOS extension icon to open its side panel.

The unpacked build is intended for the current alpha. It is not a browser-store install yet.

## Connect to HivemindOS

Open connection settings in the panel and provide:

- **Dashboard URL:** the HivemindOS address reachable from this browser. The default local address is `http://127.0.0.1:5020`.
- **Dashboard unlock token:** the token configured for `HIVEMINDOS_DASHBOARD_DEVICE_TOKEN` during setup.

The unlock token remains in the extension's local browser profile and is used only as an authorization header to the selected HivemindOS dashboard. Do not place it in a page, prompt, screenshot, support report, or repository.

After connecting, select an agent and choose a context mode:

- **Active page** attaches readable page text, selection, headings, visible actions, and a filtered open-tab list.
- **Selection first** prioritizes highlighted text while retaining page identity and tab context.
- **Chat only** sends no browser-page material.

**Ask** is the safe default agent mode. **Act** lets the chosen agent use its normal HivemindOS tools and approval policies, but the extension itself still cannot click, type, submit forms, download files, or control the page.

## Privacy and security

The extension does not request browser debugger, native messaging, cookie, history, bookmark, download, or form-control permissions. Banking, wallet, password-manager, checkout, payment, health, and tax destinations are omitted automatically. Common token and private-key shapes are redacted before transmission and again by the HivemindOS server.

Page content is always marked as untrusted. Instructions embedded in websites do not become agent instructions simply because the page is attached.

For remote dashboards, use a private network or HTTPS endpoint. Do not expose a local HivemindOS dashboard directly to the public internet.
