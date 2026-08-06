---
title: "Hivemind Office Companion"
---

# Hivemind Office Companion

Hivemind Office is HivemindOS's guarded companion path for visually reviewing office documents while agents keep working through the local HivemindOS control plane. It can discover an existing compatible Hivemind Office, HermesOffice, or GenOffice desktop app on macOS or Windows. The editor owns visual editing; HivemindOS owns agent routing, permitted paths, file hashes, confirmations, and final writes.

The companion is optional and is not bundled with HivemindOS. Automatic installation is currently blocked because the reviewed HermesOffice source does not publish a signed, immutable binary artifact with a reviewed SHA-256 digest. An existing compatible app can still be detected and opened without running an installer.

## What It Adds

The bridge supports these visual-office formats:

| Extension | Use |
| --- | --- |
| `.docx` | Word-processing documents |
| `.xlsx` | Modern spreadsheets |
| `.xls` | Legacy spreadsheets |
| `.csv` | Tabular data |
| `.pptx` | Presentations |
| `.pdf` | Fixed-layout review |

The bundled [Local Document Reader](local-document-reader.html) remains the broader extraction path for Chat, Shared Brain imports, and company data rooms. Hivemind Office complements it with desktop visual review. It does not replace the reader and does not make layout, charts, formulas, media, or pagination recoverable from extracted Markdown.

## Recommended Workflow

1. Check **My Apps** for **Hivemind Office**. HivemindOS reports whether a compatible bundle is installed and open, whether its source metadata and macOS code signature can be verified, and whether the credentialless local agent gateway is healthy.
2. Ask the agent to inspect the original. The bridge resolves the canonical local path, rejects files outside the dashboard host's home or configured vault boundary, enforces the 64 MiB limit, and returns a full SHA-256 digest with bounded extracted text.
3. Create a separate candidate file. The bridge refuses to treat the original itself as the candidate and requires the candidate to keep the original extension.
4. Open the candidate in the compatible desktop app and inspect layout, formulas, media, pagination, and other visual details that text extraction cannot prove.
5. Prepare the update. This writes nothing. HivemindOS returns the original and candidate hashes, destination, review fingerprint, exact required confirmation, and review checklist.
6. Apply the untouched review receipt. If either file, path, mode, destination, hash, or fingerprint changed, HivemindOS stops with a conflict and writes nothing.

When a compatible macOS app is installed, HivemindOS also prioritizes it in document **Open in** discovery. The app can be launched from My Apps, and an agent can open a specific supported file through the guarded bridge.

## Agent And MCP Tools

The existing bundled HivemindOS MCP server exposes five narrow tools. No second MCP server and no HermesOffice API key are required.

| Tool | Class | Result |
| --- | --- | --- |
| `hivemind_office_status` | Read-only | Reports app discovery, provenance checks, gateway health, and the bridge contract. |
| `hivemind_office_inspect_document` | Read-only | Returns canonical metadata, SHA-256, and optional bounded Markdown extraction. |
| `hivemind_office_open_document` | Desktop side effect | Opens one validated local file in an already-installed compatible app. |
| `hivemind_office_prepare_update` | Read-only | Produces a hash-bound review receipt and writes nothing. |
| `hivemind_office_apply_update` | High-risk filesystem write | Saves a reviewed copy or replaces the original after mode-specific confirmation. |

MCP descriptors mark the status, inspect, and prepare tools as read-only and mark apply-update as destructive. Opening the desktop editor is a side effect even though it does not modify the file.

## Save Modes And Recovery

Copy is the default and preferred mode.

| Mode | Required confirmation | Write behavior | Recovery |
| --- | --- | --- | --- |
| `copy` | `CONFIRM_HIVEMIND_OFFICE_SAVE_COPY` | Creates a new file exclusively. It refuses an existing destination and leaves the original unchanged. | Delete the created copy. |
| `replace-original` | `CONFIRM_HIVEMIND_OFFICE_REPLACE_ORIGINAL` | Creates and verifies a timestamped sibling backup, rechecks the original hash, then atomically renames a verified candidate copy over the original. | Restore the reported backup over the replaced file. |

Confirmations are never inferred from a general request to edit, open, or review a document. A replacement confirmation cannot authorize copy mode, and a copy confirmation cannot authorize replacement. The final write revalidates the complete review receipt instead of trusting stale tool state.

The bridge substantially narrows lost-update risk with content hashes and a second pre-rename check. It does not acquire an operating-system lock in every external editor, so another process can still race a replacement at the filesystem level. Keep the original closed during the final apply step and treat any conflict as a signal to inspect and prepare again.

## Security And Provenance

The integration is conditionally approved against:

- Source: [criptogus/HermesOffice](https://github.com/criptogus/HermesOffice)
- Reviewed commit: `70374e037e1afa97f42948d31df238c0b38250ae`
- Deterministic source-tree archive SHA-256: `aa6f1d98ea96d753928f697dd6b290b5d9d8a33b852053f6a82c5fbe7375aeae`
- Declared upstream lineage: [genspark-ai/genoffice](https://github.com/genspark-ai/genoffice) at `8f523289d6c34f940cd691472ee56b2013d148c8`

The reviewed open-source tree is Apache-2.0 outside its separately licensed `ee/` directory. HivemindOS did not import Enterprise-licensed code.

The focused review found no high-, medium-, or low-severity issues in the provider/configuration/update paths selected for this bridge. That is a source-scope result, not approval of an arbitrary future binary or the repository's mutable default branch. HivemindOS therefore:

- does not clone or execute mutable `main` during setup;
- does not run HermesOffice's updater, ad-hoc build scripts, or dependency installation;
- does not automatically install an unsigned or unpinned binary;
- does not read or persist an API key for the companion;
- talks only to the credentialless loopback health endpoint at `127.0.0.1:8642` during readiness checks;
- treats document text and app metadata as untrusted data, not agent instructions or authority.

Do not paste a shared HivemindOS model or gateway credential into a third-party editor. Agents should use the bundled HivemindOS MCP tools so credentials remain in their established runtime boundary.

## Installation Status

The My Apps card intentionally shows **Install blocked** until a signed immutable release artifact, binary digest, dependency review, and sandbox smoke test are available. This is not a broken button: it prevents the desktop app from silently building or downloading mutable third-party code.

If you already installed a compatible bundle yourself, HivemindOS can report and open it. A found bundle is not automatically trusted: review the source-revision and code-signature rows before using it with consequential documents. Removing that external app disables visual opening without affecting the HivemindOS document reader, MCP server, source documents, or Shared Brain.

## Related Guides

- [Local Document Reader](local-document-reader.html)
- [Agent Provider Integrations](agent-provider-integrations.html)
- [Agents, Runtimes, And Chat](runtimes-and-chat.html)
- [Computer Interaction](computer-interaction.html)
