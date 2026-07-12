# HivemindOS Browser Extension

This Manifest V3 side panel connects Chrome, Edge, Brave, and other compatible Chromium browsers to a running HivemindOS dashboard. It can attach the active page, selected text, readable DOM content, page metadata, and a privacy-filtered open-tab list to an agent turn.

## Build and load

In HivemindOS, open **Integrations → Connections** and use the **HivemindOS Browser** card to prepare the extension, reveal its folder, and open the selected browser's Extensions page.

For extension development from a source checkout:

```bash
pnpm browser-extension:build
```

Open the browser's extensions page, enable Developer mode, choose **Load unpacked**, and select `browser-extension/dist/`. Click the HivemindOS icon to open the side panel.

In the panel, enter the reachable HivemindOS dashboard URL and the dashboard unlock token. For the default local install, the URL is `http://127.0.0.1:5020`. The token is the value configured as `HIVEMINDOS_DASHBOARD_DEVICE_TOKEN`; never paste it into page content, screenshots, issues, or commits.

## Safety boundary

- The extension is read-only toward browser pages. It does not request debugger, native messaging, cookie, history, download, or form-control permissions.
- Banking, wallet, password-manager, checkout, payment, health, and tax destinations are omitted automatically.
- Captured page material is redacted in the extension and again by the HivemindOS server, then wrapped as untrusted context.
- The server returns only safe agent labels and model metadata. Full profiles, gateway URLs, environment overlays, and agent tokens stay server-side.
- **Ask** is the default agent mode. **Act** opts into the selected agent's normal HivemindOS tool and approval policies; it does not grant browser-page control.

## Development

```bash
pnpm test:browser-extension
node --check browser-extension/sidepanel.js
```

The loadable build is generated and should not be committed. Source provenance is recorded in `THIRD_PARTY_NOTICES.md` and the project assimilation manifest/log.
