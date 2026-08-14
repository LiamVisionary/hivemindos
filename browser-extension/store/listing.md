# Chrome Web Store listing

## Store identity

- Name: HivemindOS Browser
- Summary: Bring the active page into your HivemindOS hive and work with any configured agent from Chrome's side panel.
- Category: Functionality & UI
- Language: English
- Homepage: https://hivemindos.app/
- Support: https://github.com/LiamVisionary/hivemindos/issues
- Privacy policy: https://hivemindos.app/privacy/#hivemindos-browser-extension
- Visibility: Public
- Regions: All regions supported by the Chrome Web Store

## Detailed description

HivemindOS Browser brings your local or private HivemindOS agents into Chrome's side panel.

Open the extension on a page to summarize it, explain technical material, rewrite selected text, compare open tabs, extract action items, or continue with your own prompt. Choose the configured HivemindOS agent and context mode for each task while staying on the page you are working with.

Privacy is part of the product boundary:

- Page access is temporary and begins only when you invoke the extension.
- Chat-only mode sends no browser-page material.
- Banking, wallet, password-manager, checkout, payment, health, and tax destinations are omitted by the built-in privacy guard.
- Connection settings stay in unsynchronized extension-local storage.
- Page context and prompts go only to the HivemindOS dashboard you configure, which may use the local or remote model provider you select.
- The extension includes no advertising, analytics, remote code, or data sale.

HivemindOS Browser requires the HivemindOS desktop app or a reachable self-hosted HivemindOS dashboard. HivemindOS is open source and local-first.

## Single purpose

Let a user intentionally bring the active page, selected text, and visible tab context into a HivemindOS side panel and send that context to a user-selected HivemindOS agent.

## Permission justifications

- `activeTab`: Temporarily reads the page where the user invokes the extension. Access ends when the tab navigates to another origin or closes.
- `scripting`: Injects the packaged context collector into the invoked active tab. No remote script is downloaded or executed.
- `sidePanel`: Renders the user-visible HivemindOS chat beside the active page.
- `storage`: Keeps the dashboard URL, dashboard unlock token, selected agent, context mode, agent mode, and current session identifier in unsynchronized extension-local storage.
- `tabs`: Reads titles and URLs for the visible Compare tabs feature and identifies the tab where the user opened the side panel.
- `http://127.0.0.1/*` and `http://localhost/*`: Connects to the default local HivemindOS dashboard on the user's own computer.
- Optional `http://*/*` and `https://*/*`: Allows the user to grant only the exact non-local HivemindOS dashboard host they enter. The extension requests this access from the Save & connect gesture and does not receive broad host access at installation.

## Remote code declaration

No. All executable JavaScript is included in the submitted extension package. Network responses contain agent data and streamed text, not executable code.

## Data-use disclosures

Disclose these handled categories in the Privacy tab:

- Authentication information: the dashboard unlock token, stored only in unsynchronized extension-local storage and transmitted only to the dashboard selected by the user.
- Website content: active-page readable text, selected text, description, language, headings, and visible links or controls, collected only after invocation and attached only when the selected context mode requires it.
- Web history: active-page URL/title and open-tab URL/title metadata used for the user-visible page and Compare tabs features.
- Personal communications: prompts typed into the side panel and the agent responses returned to it.

Certify that data is used only for the extension's disclosed single purpose, is not sold, is not used for advertising or creditworthiness, and is not transferred except to the user-selected HivemindOS dashboard and the model/runtime providers configured there to fulfill the user's request.

## Reviewer test instructions

1. Install the current HivemindOS desktop release from https://hivemindos.app/ and complete local setup.
2. Open the HivemindOS dashboard and copy its dashboard unlock token from the app's connection settings.
3. Install HivemindOS Browser, open any ordinary HTTPS article, and select its toolbar action.
4. In the side panel, keep the default dashboard URL `http://127.0.0.1:5020`, paste the dashboard unlock token, and choose **Save & connect**.
5. Confirm that configured agents load. Choose **Chat only** and send a message; then choose **Active page**, invoke the toolbar action on the article again if needed, and select **Summarize**.
6. Confirm that restricted destinations are labeled **Sensitive page omitted** and send no page context.

No shared reviewer credential is required because the companion app creates the local dashboard and user-controlled token during setup.

## Release assets

- Package icon: `browser-extension/assets/icon-128.png`
- Screenshot: `browser-extension/store/assets/screenshot-side-panel-1280x800.png`
- Small promotional tile: `browser-extension/store/assets/small-promo-440x280.png`
- Marquee promotional tile: `browser-extension/store/assets/marquee-1400x560.png`
