---
name: local-business-scraper
description: Use when the user explicitly wants consent-gated local business lead research with the audited athm793/local-business-scraper Google Maps scraper. Optional GTM skill; never auto-install, auto-run, use real browser profiles, or scrape without user confirmation.
license: MIT
---

# Local Business Scraper

Use this optional skill only when the user explicitly asks to collect public local business data with `athm793/local-business-scraper` or asks for Google Maps local business scraping.

The audited upstream target is:

- Repository: `https://github.com/athm793/local-business-scraper`
- Commit: `60e42d903dc52f43dcc9964f2d1c3d491c15ab5c`
- License: MIT
- HivemindOS verdict: conditionally approved for optional, consent-gated local use only.

## Required Gates

Before installing or running anything, confirm:

- The user wants this exact scraper and understands it automates Google Maps.
- The search keyword, locations, maximum results per location, worker count, review scraping depth, and output folder.
- The user accepts responsibility for applicable laws, site terms, rate limits, and respectful use.
- Browser automation may trigger Google anti-abuse checks; do not bypass CAPTCHAs or access controls.
- `playwright install chromium` downloads a Chromium browser binary.
- The run will use a fresh project-local Playwright profile, not the user's main browser profile, cookies, keychain, SSH files, cloud CLIs, shared env, or wallet data.

Do not auto-install this skill's upstream tool during setup. Do not create a desktop shortcut, LaunchAgent, scheduled job, shell profile change, or background service unless the user asks for that exact persistent behavior.

## Security Boundaries

Use a dedicated checkout and virtual environment:

```bash
git clone https://github.com/athm793/local-business-scraper.git local-business-scraper
cd local-business-scraper
git checkout 60e42d903dc52f43dcc9964f2d1c3d491c15ab5c
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
playwright install chromium
python scraper.py --help
```

Keep output local unless the user explicitly approves sharing it. The scraper writes CSV, SQLite, browser profile, and config files in its checkout:

- `outputs/*.csv`
- `<keyword>.db`, `<keyword>.db-shm`, `<keyword>.db-wal`
- `browser_profile*/`
- `scraper_config.json`

Treat scraped phone numbers, addresses, websites, review text, and business metadata as sensitive lead data. Do not upload, email, enrich externally, or commit outputs without explicit approval.

## Running

Prefer a small CLI smoke before any broad run:

```bash
. .venv/bin/activate
python scraper.py --keyword "dentist" --location "Miami, FL" --depth 10 --db dentist-miami.db
```

For the GUI, use the upstream instructions only after install is complete:

```bash
. .venv/bin/activate
python gui.py
```

Start with one worker and a small depth. Increase worker count only after the user approves the risk of higher request volume. Stop if the scraper reports CAPTCHA, block, unusual traffic, or access-denied signals.

## Do Not

- Do not run against logged-in personal browser profiles.
- Do not add proxies, CAPTCHA solving, account login, or credential harvesting.
- Do not run broad unattended scrapes.
- Do not use the Windows shortcut helper unless the user asks; it invokes PowerShell to create a `.lnk`.
- Do not present the output as verified contact data without user-approved validation.

## Re-Audit Triggers

Re-run the security audit before use if:

- The upstream commit changes.
- Dependencies move from the audited resolution.
- Any new install script, binary, browser-profile import, proxy support, upload/sync behavior, or credential use appears.
- The user asks for a service, scheduled job, cloud runner, or multi-machine scraper.

## Audit Summary

See `SECURITY_AUDIT.md` in this packaged skill for the scoped HivemindOS audit. In short: no known dependency vulnerabilities were found for the temp-venv resolution, no high Bandit findings were found, and the source does not read host secrets by default. The main risks are legal/ToS, Google anti-abuse friction, persistent project-local browser profiles, local scraped lead-data handling, and optional Windows PowerShell shortcut creation.
