---
title: "Local Document Reader"
---

# Local Document Reader

HivemindOS desktop includes a native Rust document reader that turns selected files into Markdown on the same machine. It is part of the app: there is no Python runtime, separate converter, API key, or optional download to manage.

There is no cloud upload for conversion. If you use a cloud-backed agent or model in Chat, however, the extracted Markdown becomes part of that model request just like text you type. Choose a local runtime when the extracted content must remain entirely on the device.

## Where You Can Use It

| Workflow | What you do | What HivemindOS creates |
| --- | --- | --- |
| Chat | Attach a supported document to a message. | Bounded Markdown context for the selected agent and current request. The content is labeled as untrusted source material. |
| Feed the brain | Open **Brain > Hive Vault**, then use the lower-right control to select multiple files or folders, or drag them onto the vault. | Reviewable Markdown notes in the Shared Brain's Imported Sources area, including the source name, content hash, conversion version, and import time. |
| Company data room | Choose a local data-room folder while importing a Zero Human Company. | A preview first, then a Sources library in the company cockpit with links to the corresponding Shared Brain notes. |

The original files stay where you selected them. HivemindOS keeps a private content-hash cache so unchanged documents do not need to be converted repeatedly. Feed the brain and company imports create durable Markdown notes; attaching a file in Chat does not silently turn it into Shared Brain memory.

## 16 Supported File Extensions

The reader accepts these 16 supported file extensions:

| Extension | Format | Extracted result |
| --- | --- | --- |
| `.md` | Markdown | Existing Markdown text. |
| `.markdown` | Markdown | Existing Markdown text. |
| `.txt` | Plain text | Readable text. |
| `.csv` | Comma-separated values | A Markdown table. |
| `.json` | JSON | Validated, formatted JSON in a code block. |
| `.xml` | XML | Readable XML in a code block. |
| `.html` | HTML | Page content converted to Markdown. |
| `.htm` | HTML | Page content converted to Markdown. |
| `.pdf` | PDF | Text from readable pages. |
| `.docx` | Microsoft Word | Document text. |
| `.pptx` | Microsoft PowerPoint | Text grouped by slide. |
| `.xlsx` | Microsoft Excel | Sheet content rendered as Markdown tables. |
| `.xls` | Legacy Microsoft Excel | Sheet content rendered as Markdown tables. |
| `.epub` | EPUB ebook | Readable chapter content converted from HTML. |
| `.msg` | Microsoft Outlook message | Message headers, body text, and attachment names. |
| `.zip` | Document archive | Supported documents combined into one Markdown result, grouped by archive path. |

These are 16 accepted extensions rather than 16 unrelated document families: `.md` and `.markdown` are both Markdown, while `.html` and `.htm` are both HTML.

## What Conversion Preserves

The result is semantic Markdown for reading and reasoning, not a pixel-perfect recreation. Headings, paragraphs, rows, cells, slide boundaries, message fields, and other readable structure are kept where the source format exposes them.

The reader does not run OCR. An image-only PDF, a scan without a text layer, or text embedded only in an image may produce a no-readable-content error. Complex page layout, visual styling, charts, macros, animations, and embedded media are not reproduced as working Markdown.

## Safety And Trust Boundaries

Every converted document is treated as evidence, not authority. Text inside a file cannot by itself become a system instruction, standing company directive, spending approval, entitlement, credential, or permission. Chat wraps extracted content as untrusted document context, and durable imports keep source hashes and conversion provenance for review.

The native reader also enforces bounded local processing:

- The selected source must be a local regular file. Remote URLs and symbolic links are rejected.
- A source file may be at most 64 MiB.
- Extracted Markdown may be at most 1,000,000 characters.
- A standalone ZIP may contain at most 200 entries, with at most 64 MiB per expanded file and 128 MiB expanded in total.
- ZIP paths that escape the archive, link entries, unsupported file types, nested ZIP files, and extreme compression ratios are rejected.
- Empty, malformed, unreadable, and unsupported documents fail with an actionable error instead of being passed to an agent as successful content.

ZIP is intended as a bounded batch of supported documents. If one entry is unsupported or unsafe, the entire archive is rejected so an import cannot quietly skip material the user expected it to include.

## Troubleshooting

### The file type is unsupported

Export or save a copy using one of the extensions in the table above. Executables and arbitrary archive contents are intentionally not accepted.

### A PDF has pages but no text was extracted

The PDF is probably image-only or uses a text representation the reader cannot recover. Run OCR in a trusted local tool, save a searchable PDF or plain-text export, and import that copy.

### A large document is rejected

Split it into smaller logical files or export only the relevant sheets, slides, pages, or messages. This also gives agents cleaner source boundaries and more useful citations.

### A ZIP is rejected

Remove nested ZIP files, links, executables, unsupported formats, and unusually compressed generated data. Keep the archive to 200 supported documents or fewer and under the expanded-size limits above.

### HivemindOS says the reader is unavailable

Install or repair the current HivemindOS desktop release. Installing Python or MarkItDown separately will not repair the bundled native reader.

## Related Guides

- [Hivemind Office Companion](hivemind-office.html)
- [Agents, Runtimes, And Chat](runtimes-and-chat.html)
- [Brain, Vault, And Skills](brain-vault-and-skills.html)
- [Zero Human Companies](zero-human-companies.html)
