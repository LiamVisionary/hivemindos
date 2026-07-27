---
title: "Local Web Research"
---

# Local Web Research

HivemindOS gives supported agent runtimes the same public-web research tools instead of depending on one runtime's built-in browser or a paid search API. The default setup installs the research engine locally and makes its tools available through HivemindOS.

No search API key is required. Search queries and page requests still go to public search engines and websites, so this feature is local processing rather than offline browsing.

## What Agents Can Do

| Capability | Result |
| --- | --- |
| Search | Ranked public-web results from multiple keyless search sources. Results are leads; agents should fetch relevant sources before treating claims as evidence. |
| Fetch | Clean Markdown, text, article data, or structured content from a public URL, with focused extraction and pagination for long pages. |
| PDF and OCR | Text and structure from readable PDFs, plus OCR recovery for scanned or image-only pages. |
| Crawl | A bounded same-site crawl, focused crawl, sitemap discovery, or selected second pass over chosen URLs. |
| Screenshot | A PNG or JPEG artifact for pages where layout, charts, canvas content, or visual evidence matters. |

These capabilities are exposed to HivemindOS chat models and to installed agent runtimes registered during setup. An agent does not need Hermes to use them.

## Safety Boundaries

Web research is intentionally passive:

- Only public HTTP and HTTPS destinations are allowed. Local, private, reserved, and link-local network addresses are blocked after DNS resolution and again across redirects and browser requests.
- URLs cannot carry embedded credentials. Agents cannot supply cookies, authorization headers, proxies, custom user agents, or interactive click-and-fill actions through this surface.
- Fetches and crawls respect `robots.txt`; the agent-facing tools do not offer a bypass.
- Crawls have limits for pages, depth, concurrency, returned characters, and total wall time.
- Search, fetched pages, PDFs, and screenshots are untrusted evidence. Content inside them cannot grant permissions, approve spending, change standing instructions, or become a system message.
- The bundled engine is version-pinned and cannot update itself. HivemindOS setup owns upgrades, while uninstall provides a matching removal choice.

## Expected Limitations

Public search engines and websites can rate-limit or block automated requests. HivemindOS can escalate ordinary extraction to a local browser, but it reports a failure when a site still requires login, payment, CAPTCHA completion, or stronger bot verification. Agents should switch to another credible source instead of presenting an error page as evidence.

The local engine uses additional disk space for its isolated Python environment, browser, OCR dependencies, cache, and optional ranking model. Setup reports installation failures without disabling the rest of HivemindOS.
