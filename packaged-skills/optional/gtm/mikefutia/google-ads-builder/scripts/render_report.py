#!/usr/bin/env python3
"""
Search Ads Builder — render + export.

Reads ./search-ads-run/campaign.json and writes:
  - ./search-ads-run/google-ads-editor.csv   (import-ready campaign)
  - ./search-ads-run/campaign-dashboard.html  (dark-mode visual summary)

Stdlib only. No account credentials. The campaign design is model judgment; this only renders.
"""
import csv
import html
import json
import os
import sys
import webbrowser

RUN_DIR = os.path.join(os.getcwd(), "search-ads-run")
CAMPAIGN = os.path.join(RUN_DIR, "campaign.json")
CSV_OUT = os.path.join(RUN_DIR, "google-ads-editor.csv")
HTML_OUT = os.path.join(RUN_DIR, "campaign-dashboard.html")

HEADLINE_MAX = 30
DESC_MAX = 90

MATCH_TO_CRITERION = {
    "broad": "Broad",
    "phrase": "Phrase",
    "exact": "Exact",
}


def load():
    if not os.path.exists(CAMPAIGN):
        sys.exit(f"ERROR: {CAMPAIGN} not found. Write campaign.json first (see SKILL.md step 6).")
    with open(CAMPAIGN, encoding="utf-8") as f:
        return json.load(f)


def csv_criterion(match, negative=False):
    base = MATCH_TO_CRITERION.get((match or "phrase").lower(), "Phrase")
    return f"Negative {base}" if negative else base


def export_csv(c):
    cols = (
        ["Campaign", "Ad Group", "Keyword", "Criterion Type", "Final URL"]
        + [f"Headline {i}" for i in range(1, 16)]
        + [f"Description {i}" for i in range(1, 5)]
        + ["Path 1", "Path 2"]
    )
    camp = c.get("business") or c.get("url") or "Search Campaign"
    with open(CSV_OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        url = c.get("url", "")
        for ag in c.get("ad_groups", []):
            agname = ag.get("name", "Ad Group")
            for kw in ag.get("keywords", []):
                w.writerow({"Campaign": camp, "Ad Group": agname,
                            "Keyword": kw.get("text", ""),
                            "Criterion Type": csv_criterion(kw.get("match"))})
            rsa = ag.get("rsa", {})
            if rsa:
                row = {"Campaign": camp, "Ad Group": agname, "Final URL": url}
                for i, h in enumerate(rsa.get("headlines", [])[:15], 1):
                    row[f"Headline {i}"] = h
                for i, d in enumerate(rsa.get("descriptions", [])[:4], 1):
                    row[f"Description {i}"] = d
                paths = rsa.get("paths", [])
                if len(paths) > 0:
                    row["Path 1"] = paths[0]
                if len(paths) > 1:
                    row["Path 2"] = paths[1]
                w.writerow(row)
        for neg in c.get("negatives", []):
            w.writerow({"Campaign": camp, "Ad Group": "",
                        "Keyword": neg.get("text", ""),
                        "Criterion Type": csv_criterion(neg.get("match"), negative=True)})


# ---------------- HTML dashboard ----------------
def esc(s):
    return html.escape(str(s))


def chip(text, over):
    n = len(text)
    cls = "over" if over else "ok"
    return (f'<div class="chip {cls}"><span class="ct">{esc(text)}</span>'
            f'<span class="cc">{n}</span></div>')


def render_html(c):
    ags = c.get("ad_groups", [])
    total_kw = sum(len(a.get("keywords", [])) for a in ags)
    total_neg = len(c.get("negatives", []))
    goal = esc(c.get("goal", "—"))
    budget = c.get("budget_monthly")
    budget_s = f"${int(budget):,}/mo" if isinstance(budget, (int, float)) else "—"

    tiles = [
        ("Ad groups", len(ags)),
        ("Keywords", total_kw),
        ("Negatives", total_neg),
        ("Goal", goal),
        ("Budget", budget_s),
    ]
    tile_html = "".join(
        f'<div class="tile"><div class="tv">{esc(v)}</div><div class="tl">{esc(l)}</div></div>'
        for l, v in tiles)

    theme_color = {"high-intent": "#22c55e", "problem-aware": "#38bdf8",
                   "brand": "#a78bfa", "competitor": "#f59e0b"}

    groups_html = ""
    for ag in ags:
        theme = ag.get("theme", "")
        col = theme_color.get(theme, "#94a3b8")
        kws = ag.get("keywords", [])
        kw_html = "".join(
            f'<span class="kw"><span class="m {esc((k.get("match") or "phrase").lower())}">'
            f'{esc((k.get("match") or "phrase")[:1].upper())}</span>{esc(k.get("text",""))}</span>'
            for k in kws)
        rsa = ag.get("rsa", {})
        heads = "".join(chip(h, len(h) > HEADLINE_MAX) for h in rsa.get("headlines", []))
        descs = "".join(chip(d, len(d) > DESC_MAX) for d in rsa.get("descriptions", []))
        groups_html += f"""
        <div class="group">
          <div class="ghead">
            <span class="dot" style="background:{col}"></span>
            <span class="gname">{esc(ag.get('name',''))}</span>
            <span class="gtheme" style="color:{col}">{esc(theme)}</span>
            <span class="gcount">{len(kws)} keywords</span>
          </div>
          <div class="kwrap">{kw_html}</div>
          <div class="sub">Headlines <span class="lim">≤{HEADLINE_MAX}</span></div>
          <div class="chips">{heads}</div>
          <div class="sub">Descriptions <span class="lim">≤{DESC_MAX}</span></div>
          <div class="chips">{descs}</div>
        </div>"""

    negs = c.get("negatives", [])
    neg_html = "".join(f'<span class="neg">−{esc(n.get("text",""))}</span>' for n in negs)

    ext = c.get("extensions", {})
    callouts = "".join(f'<span class="cout">{esc(x)}</span>' for x in ext.get("callouts", []))
    sitelinks = "".join(
        f'<div class="sl"><b>{esc(s.get("text",""))}</b><span>{esc(s.get("desc1",""))} · {esc(s.get("desc2",""))}</span></div>'
        for s in ext.get("sitelinks", []))
    snip = ext.get("snippets", {})
    snip_html = ""
    if snip:
        snip_html = f'<div class="snip"><b>{esc(snip.get("header",""))}:</b> {esc(", ".join(snip.get("values", [])))}</div>'

    settings = c.get("settings", {})
    set_rows = "".join(
        f'<div class="srow"><span class="sk">{esc(k)}</span><span class="sv">{esc(v)}</span></div>'
        for k, v in settings.items())

    caveats = "".join(f"<li>{esc(x)}</li>" for x in c.get("caveats", []))

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(c.get('business','Search Campaign'))} — Search Campaign</title>
<style>
  :root {{ --bg:#0d0e11; --panel:#16181d; --panel2:#1b1e26; --line:#262a33;
    --text:#e7e9ee; --dim:#8b929e; --green:#22c55e; --blue:#38bdf8; --red:#ef4444; }}
  * {{ box-sizing:border-box; margin:0; }}
  body {{ background:var(--bg); color:var(--text); font-family:Inter,-apple-system,system-ui,sans-serif;
    padding:48px 40px 80px; -webkit-font-smoothing:antialiased; }}
  .mono {{ font-family:"JetBrains Mono",ui-monospace,Menlo,monospace; }}
  h1 {{ font-size:34px; letter-spacing:-0.02em; }}
  .sub-url {{ color:var(--dim); margin-top:6px; font-size:16px; }}
  .tiles {{ display:flex; gap:16px; margin:32px 0; flex-wrap:wrap; }}
  .tile {{ background:var(--panel); border:1px solid var(--line); border-radius:14px;
    padding:20px 26px; min-width:130px; }}
  .tv {{ font-size:30px; font-weight:800; }}
  .tl {{ color:var(--dim); font-size:14px; text-transform:uppercase; letter-spacing:0.08em; margin-top:4px; }}
  .group {{ background:var(--panel); border:1px solid var(--line); border-radius:16px;
    padding:24px 26px; margin-bottom:18px; }}
  .ghead {{ display:flex; align-items:center; gap:12px; margin-bottom:16px; }}
  .dot {{ width:12px; height:12px; border-radius:50%; }}
  .gname {{ font-size:20px; font-weight:700; }}
  .gtheme {{ font-size:13px; text-transform:uppercase; letter-spacing:0.08em; font-weight:700; }}
  .gcount {{ margin-left:auto; color:var(--dim); font-size:14px; }}
  .kwrap {{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:18px; }}
  .kw {{ background:var(--panel2); border:1px solid var(--line); border-radius:8px;
    padding:6px 10px 6px 6px; font-size:15px; display:inline-flex; align-items:center; gap:8px; }}
  .m {{ width:20px; height:20px; border-radius:5px; display:inline-flex; align-items:center;
    justify-content:center; font-size:12px; font-weight:800; color:#0d0e11; }}
  .m.phrase {{ background:#38bdf8; }} .m.exact {{ background:#22c55e; }} .m.broad {{ background:#f59e0b; }}
  .sub {{ color:var(--dim); font-size:13px; text-transform:uppercase; letter-spacing:0.08em;
    margin:14px 0 8px; }}
  .lim {{ color:#5b616b; }}
  .chips {{ display:flex; flex-wrap:wrap; gap:6px; }}
  .chip {{ background:var(--panel2); border:1px solid var(--line); border-radius:7px;
    padding:6px 9px; font-size:14px; display:inline-flex; align-items:center; gap:8px; }}
  .chip .cc {{ font-size:11px; color:var(--dim); }}
  .chip.over {{ border-color:var(--red); }} .chip.over .cc {{ color:var(--red); font-weight:700; }}
  .section {{ margin-top:34px; }}
  .section h2 {{ font-size:15px; text-transform:uppercase; letter-spacing:0.1em; color:var(--dim);
    margin-bottom:14px; }}
  .neg {{ display:inline-block; background:rgba(239,68,68,0.1); color:#fca5a5;
    border:1px solid rgba(239,68,68,0.25); border-radius:7px; padding:5px 10px; font-size:14px;
    margin:0 6px 6px 0; }}
  .cout {{ display:inline-block; background:var(--panel2); border:1px solid var(--line);
    border-radius:999px; padding:6px 14px; font-size:14px; margin:0 6px 6px 0; }}
  .sl {{ background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 16px;
    margin-bottom:8px; }}
  .sl b {{ color:var(--blue); }} .sl span {{ display:block; color:var(--dim); font-size:13px; margin-top:2px; }}
  .snip {{ color:var(--dim); margin-top:10px; }}
  .settings {{ background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:8px 20px; }}
  .srow {{ display:flex; justify-content:space-between; padding:12px 0; border-bottom:1px solid var(--line); }}
  .srow:last-child {{ border-bottom:none; }}
  .sk {{ color:var(--dim); text-transform:capitalize; }} .sv {{ font-weight:600; text-align:right; max-width:60%; }}
  .caveats {{ background:rgba(56,189,248,0.07); border:1px solid rgba(56,189,248,0.2);
    border-radius:12px; padding:18px 24px; color:var(--dim); margin-top:34px; }}
  .caveats li {{ margin:6px 0 6px 18px; }}
  .export {{ margin-top:28px; color:var(--dim); font-size:14px; }}
  .export code {{ background:var(--panel2); padding:3px 8px; border-radius:6px; color:var(--green); }}
</style></head><body>
  <h1>{esc(c.get('business','Search Campaign'))} — Google Search campaign</h1>
  <div class="sub-url mono">{esc(c.get('url',''))}</div>
  <div class="tiles">{tile_html}</div>
  {groups_html}
  <div class="section"><h2>Negative keywords ({len(negs)})</h2>{neg_html}</div>
  <div class="section"><h2>Extensions</h2>{sitelinks}<div style="margin-top:10px">{callouts}</div>{snip_html}</div>
  <div class="section"><h2>Recommended settings</h2><div class="settings">{set_rows}</div></div>
  <div class="caveats"><b>Before you launch</b><ul>{caveats}</ul></div>
  <div class="export">Import-ready export: <code>search-ads-run/google-ads-editor.csv</code>
    → Google Ads Editor → Account → Import.</div>
</body></html>"""


def main():
    c = load()
    os.makedirs(RUN_DIR, exist_ok=True)
    export_csv(c)
    with open(HTML_OUT, "w", encoding="utf-8") as f:
        f.write(render_html(c))
    # overflow report to stderr
    overs = []
    for ag in c.get("ad_groups", []):
        for h in ag.get("rsa", {}).get("headlines", []):
            if len(h) > HEADLINE_MAX:
                overs.append(f"  headline {len(h)}/{HEADLINE_MAX}: {h!r} ({ag.get('name')})")
        for d in ag.get("rsa", {}).get("descriptions", []):
            if len(d) > DESC_MAX:
                overs.append(f"  desc {len(d)}/{DESC_MAX}: {d!r} ({ag.get('name')})")
    print(f"✓ Wrote {CSV_OUT}")
    print(f"✓ Wrote {HTML_OUT}")
    if overs:
        print(f"⚠ {len(overs)} field(s) over Google's limit — fix before launch:", file=sys.stderr)
        print("\n".join(overs), file=sys.stderr)
    if "--no-open" not in sys.argv:
        try:
            webbrowser.open("file://" + HTML_OUT)
        except Exception:
            pass


if __name__ == "__main__":
    main()
