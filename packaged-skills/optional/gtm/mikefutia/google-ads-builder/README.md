# Google Ads Builder

**Point Claude Code at your website URL and it builds a complete, ready-to-launch Google Search Ads campaign.** No account credentials and no Google Ads login.

A [Claude Code](https://claude.com/claude-code) skill that turns one input — your homepage URL — into a paid-search manager's first-week build:

- **Reads your site** and works out what you sell, to whom, and your real offers
- **Groups keywords** into tight, high-intent ad groups (built for Quality Score, not a keyword dump)
- **Writes every Responsive Search Ad** — 15 headlines + 4 descriptions per ad group, to Google's exact character limits and policy
- **Builds a negative-keyword list** so you stop paying for junk clicks
- **Adds extensions + settings** — sitelinks, callouts, match types, bidding, and a budget split
- **Exports a Google Ads Editor CSV** you import in one click, plus a visual campaign dashboard

## Install

Clone straight into your Claude Code skills folder:

```bash
git clone https://github.com/mikefutia/google-ads-builder.git ~/.claude/skills/google-ads-builder
```

Restart Claude Code so it picks up the new skill.

## Use

In Claude Code, just point it at a site:

```
build search ads for https://yourstore.com
```

Claude reads the site, designs the campaign, and writes everything to `./search-ads-run/`:

- `google-ads-editor.csv` — import via **Google Ads Editor → Account → Import**
- `campaign-dashboard.html` — a dark-mode visual of the whole campaign (ad groups, keywords, ads with live character counts, negatives, extensions, settings)

## Requirements

- **Claude Code** (with web/fetch tools enabled — the skill reads your live site)
- **Python 3** — stdlib only, no packages to install (renders the dashboard + exports the CSV)

## What it is *not*

It builds the campaign **draft** — it cannot create or activate a live campaign, connect to your Google Ads account, or access account credentials. Review it, add conversion tracking and real budgets, and validate the keyword list in Google Keyword Planner before scaling the budget.

## Credit

Built by **[Mike Futia](https://x.com/mikefutia)** and shared free as part of **[SCALE AI](https://www.skool.com/scale-ai/about)** — the community for DTC brands and creative agencies building real marketing systems with AI.

If this saved you a campaign build, come say hi in SCALE AI.

## License

[MIT](LICENSE) © 2026 SCALE AI / Mike Futia
