# Third-party notices

HivemindOS Browser Extension adapts concrete modules and tests from [abundantbeing/hermes-browser-extension](https://github.com/abundantbeing/hermes-browser-extension), copyright Jon Komet and contributors, licensed under the MIT License.

Adapted areas:

- read-only page and selection extraction from `extension/content.js`
- restricted-page privacy rules, secret redaction, and untrusted prompt boundaries from `extension/lib/browser-context-protocol.mjs`
- quick-command prompts from `extension/lib/commands.mjs`
- Manifest V3 side-panel and background-worker structure from `manifest.json` and `extension/background.js`

The HivemindOS transport, safe agent projection, server-side profile resolution, dashboard authentication, UI, build pipeline, and tests are HivemindOS adaptations. Hermes Cloud/dashboard attach, the dynamic dashboard bridge, companion plugin, voice dictation, browser element picker, and promotional media were not included.
