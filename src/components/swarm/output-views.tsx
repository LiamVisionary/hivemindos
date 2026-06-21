// src/components/swarm/output-views.tsx
"use client";

import * as React from "react";
import type { SwarmEventItem, SwarmMarket, SwarmRun } from "./swarm-data";

/* ─── X thread (repo-faithful Twitter surface) ──────────────────────── */
const _XIcon = {
  reply:   <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z"/></svg>,
  retweet: <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"/></svg>,
  like:    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z"/></svg>,
  share:   <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z"/></svg>,
  more:    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>,
  verify:  <svg viewBox="0 0 22 22" width="16" height="16" fill="#1d9bf0" aria-hidden><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.273 1.084-.704 1.439-1.245.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>,
};
const xAvatar: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 48, height: 48, borderRadius: 999, background: "#1d9bf0", color: "#fff",
  fontSize: 13, fontWeight: 700,
};
const xActionRow: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 8, color: "#536471", padding: "12px 0",
};

function OutputEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div style={{
      width: "min(620px, 100%)", margin: "0 auto", padding: 24, borderRadius: 10,
      border: "1px solid rgba(148,163,184,0.16)", background: "var(--panel-bg)",
      color: "var(--foreground)",
    }}>
      <h2 className="font-bold" style={{ margin: "0 0 8px", fontFamily: "var(--f-display)", fontSize: 22 }}>
        {title}
      </h2>
      <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.55 }}>{body}</p>
    </div>
  );
}

export function XThreadView({ run }: { run: SwarmRun }) {
  const thread = run.threadPosts ?? [];
  const primary = thread[0];
  const display = primary?.author ?? "MiroShark";
  const handle = (primary?.handle ?? "@swarm").replace(/^@/, "");
  if (!primary) return <OutputEmpty title="No X posts returned" body={run.summary} />;
  return (
    <div style={{
      width: "min(650px, 100%)", margin: "0 auto",
      border: "1px solid rgb(207, 217, 222)", background: "#fff", color: "#0f1419",
      borderRadius: 18,
      fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
    }}>
      <article style={{ padding: "16px 16px 0", borderBottom: "1px solid rgb(239, 243, 244)" }}>
        <header className="grid items-center" style={{ gridTemplateColumns: "48px minmax(0,1fr) auto", gap: 12 }}>
          <div style={xAvatar}>HM</div>
          <div>
            <strong className="flex items-center" style={{ gap: 4, fontSize: 15, fontWeight: 700, color: "#0f1419" }}>
              {display} {_XIcon.verify}
            </strong>
            <span style={{ display: "block", color: "#536471", fontSize: 15 }}>@{handle}</span>
          </div>
          <span style={{ color: "#536471", alignSelf: "start" }}>{_XIcon.more}</span>
        </header>
        <p style={{ color: "#0f1419", fontSize: 24, lineHeight: 1.32, margin: "16px 0", whiteSpace: "pre-wrap" }}>
          {primary.text}
        </p>
        <div style={{ color: "#536471", fontSize: 15, paddingBottom: 14 }}>{primary.time}</div>
        <div style={xActionRow}>
          {[
            { icon: _XIcon.reply,   n: primary.replies },
            { icon: _XIcon.retweet, n: primary.reposts },
            { icon: _XIcon.like,    n: primary.likes },
            { icon: _XIcon.share,   n: primary.views },
          ].map((a, i) => (
            <span key={i} className="inline-flex items-center" style={{ gap: 7, color: "#536471", fontSize: 13 }}>
              {a.icon}<span>{a.n.toLocaleString()}</span>
            </span>
          ))}
        </div>
      </article>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {thread.slice(1).map((t, i) => (
          <li key={i} className="grid relative"
            style={{
              gridTemplateColumns: "48px minmax(0,1fr)", gap: 12,
              padding: "12px 16px", borderBottom: "1px solid rgb(239, 243, 244)",
            }}>
            <div style={xAvatar}>HM</div>
            {i < thread.length - 2 && (
              <span style={{ position: "absolute", left: 39, top: 60, bottom: 0, width: 2, background: "rgb(207, 217, 222)" }} />
            )}
            <article style={{ minWidth: 0 }}>
              <header className="flex flex-wrap items-baseline" style={{ gap: 5 }}>
                <strong className="inline-flex items-center" style={{ gap: 4, color: "#0f1419", fontSize: 15, fontWeight: 700 }}>
                  {t.author} {_XIcon.verify}
                </strong>
                <span style={{ color: "#536471", fontSize: 15 }}>{t.handle}</span>
                <span style={{ color: "#536471", fontSize: 15 }}>· {t.time}</span>
              </header>
              <div style={{ color: "#536471", fontSize: 15, margin: "2px 0 4px" }}>
                Replying to <a href="#" style={{ color: "#1d9bf0", textDecoration: "none" }}>@{handle}</a>
              </div>
              <p style={{ color: "#0f1419", fontSize: 16, lineHeight: 1.35, margin: 0, whiteSpace: "pre-wrap" }}>
                {t.text}
              </p>
              <div style={{ ...xActionRow, maxWidth: 430, marginTop: 10 }}>
                {[
                  { icon: _XIcon.reply,   n: t.replies },
                  { icon: _XIcon.retweet, n: t.reposts },
                  { icon: _XIcon.like,    n: t.likes },
                  { icon: _XIcon.share,   n: t.views },
                ].map((a, j) => (
                  <span key={j} className="inline-flex items-center"
                    style={{ gap: 7, color: "#536471", fontSize: 13, minWidth: 0 }}>
                    {a.icon}{a.n ? <span>{a.n.toLocaleString()}</span> : null}
                  </span>
                ))}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Reddit narrative cascade ───────────────────────────────────────── */
function RedditComment({ c }: {
  c: { author: string; role?: string; score: number; time: string; body: string };
}) {
  const roleColor =
    c.role === "MM" ? "#fde68a" : c.role === "TKR" ? "#fecdd3" : c.role === "INFO" ? "#99f6e4" : "#818384";
  return (
    <div>
      <header className="flex items-baseline" style={{ gap: 6, marginBottom: 4 }}>
        <strong style={{ color: "#d7dadc", fontSize: 13 }}>{c.author}</strong>
        {c.role && (
          <span className="uppercase font-bold" style={{
            padding: "1px 6px", borderRadius: 4,
            background: `color-mix(in srgb, ${roleColor} 20%, transparent)`,
            color: roleColor, fontFamily: "var(--f-mono)", fontSize: 9, letterSpacing: 0.06,
          }}>{c.role}</span>
        )}
        <span style={{ color: "#818384", fontSize: 11 }}>{c.score} pts · {c.time} ago</span>
      </header>
      <p style={{ margin: 0, fontSize: 13.5, color: "#d7dadc", lineHeight: 1.5 }}>{c.body}</p>
    </div>
  );
}
export function RedditView({ run }: { run: SwarmRun }) {
  const items: SwarmEventItem[] = run.timelineItems?.length ? run.timelineItems : run.threadPosts?.map((post) => ({
    id: post.id,
    title: post.author,
    body: post.text,
    meta: post.time,
  })) ?? [];
  if (!items.length) return <OutputEmpty title="No Reddit cascade returned" body={run.summary} />;
  return (
    <div style={{
      width: "min(720px, 100%)", margin: "0 auto",
      background: "#1a1a1b", color: "#d7dadc",
      border: "1px solid #343536", borderRadius: 6,
      fontFamily: "-apple-system, system-ui, sans-serif",
    }}>
      <header className="flex items-center" style={{
        gap: 12, padding: "10px 14px", borderBottom: "1px solid #343536", background: "#272729",
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 999, background: "#ff4500", color: "#fff",
          display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800,
        }}>r/</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>r/miroshark</div>
          <div style={{ fontSize: 11, color: "#818384" }}>{run.title}</div>
        </div>
        <span className="uppercase font-bold" style={{
          marginLeft: "auto", padding: "5px 12px", borderRadius: 999, background: "#ff4500", color: "#fff",
          fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: 0.05,
        }}>narrative live</span>
      </header>
      <article className="grid" style={{
        gridTemplateColumns: "44px 1fr", gap: 12,
        padding: "16px 14px", borderBottom: "1px solid #343536",
      }}>
        <div className="grid place-items-center" style={{ gap: 3, color: "#818384", fontFamily: "var(--f-mono)", fontSize: 11 }}>
          <button style={{ width: 22, height: 22, border: 0, background: "transparent", color: "#818384", cursor: "pointer" }}>▲</button>
          <span style={{ color: "#ff8717", fontWeight: 800 }}>{run.posts}</span>
          <button style={{ width: 22, height: 22, border: 0, background: "transparent", color: "#818384", cursor: "pointer" }}>▼</button>
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 18, lineHeight: 1.35, fontWeight: 600, color: "#fff" }}>
            {run.title}
          </h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#d7dadc" }}>{run.scenario || run.summary}</p>
          <div className="flex font-bold" style={{ gap: 14, marginTop: 12, color: "#818384", fontSize: 12 }}>
            <span>{run.posts} posts</span><span>{run.trades} events</span><span>{run.started}</span>
          </div>
        </div>
      </article>
      <ul style={{ listStyle: "none", margin: 0, padding: "8px 14px 14px" }}>
        {items.map((item, i) => (
          <li key={i} style={{ padding: "10px 0 10px 12px", borderLeft: "2px solid #343536", marginLeft: 4 }}>
            <RedditComment c={{
              author: item.title,
              role: item.tone === "bull" ? "INFO" : item.tone === "bear" ? "OPS" : undefined,
              score: Math.max(1, run.posts - i),
              time: item.meta ?? run.started,
              body: item.body,
            }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Polymarket result board ───────────────────────────────────────── */
function percent(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return "--";
  return `${Math.round(value * 100)}%`;
}

function oddsTone(value: number | undefined) {
  if (value === undefined) return "var(--muted)";
  if (value >= 0.55) return "var(--hex-active-border)";
  if (value <= 0.45) return "#fecdd3";
  return "var(--hex-honey-border)";
}

function parsePayload(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function asPayloadRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function payloadValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

function payloadNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function PolymarketPayloadCard({ item }: { item: SwarmEventItem }) {
  const parsed = asPayloadRecord(item.raw) ?? parsePayload(item.body);
  const nestedData = parsed?.data && typeof parsed.data === "object" ? parsed.data as Record<string, unknown> : null;
  const market = nestedData?.market && typeof nestedData.market === "object" ? nestedData.market as Record<string, unknown> : parsed;
  const price = payloadValue(market ?? {}, ["price_yes", "yes_price", "price", "probability", "odds"]);
  const question = payloadValue(market ?? {}, ["question", "title", "name"]);
  const outcomes = [payloadValue(market ?? {}, ["outcome_a"]), payloadValue(market ?? {}, ["outcome_b"])]
    .filter(Boolean)
    .join(" / ");
  const created = payloadValue(market ?? {}, ["created_at", "timestamp", "time"]);
  const pricePoints = Array.isArray(nestedData?.prices) ? nestedData.prices.length : "";
  const summaryRows = [
    ["Question", question],
    ["YES price", price],
    ["Outcomes", outcomes],
    ["Created", created],
    ["Price points", pricePoints ? String(pricePoints) : ""],
  ].filter(([, value]) => value);

  return (
    <article style={{
      padding: "10px 12px", borderRadius: 8,
      border: "1px solid rgba(148,163,184,0.14)", background: "var(--panel-bg-soft)",
      display: "grid", gap: 8, minWidth: 0,
    }}>
      <div className="flex flex-wrap justify-between" style={{ gap: 8 }}>
        <strong style={{ fontFamily: "var(--f-display)", fontSize: 13, minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>{item.title}</strong>
        {item.meta ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)" }}>{item.meta}</span> : null}
      </div>
      {summaryRows.length ? (
        <dl className="grid" style={{ gap: 8, margin: 0, minWidth: 0 }}>
          {summaryRows.map(([label, value]) => (
            <div key={label} className="grid" style={{ gap: 2, minWidth: 0 }}>
              <dt className="uppercase" style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--muted)", letterSpacing: 0.08 }}>
                {label}
              </dt>
              <dd style={{ margin: 0, fontSize: 12.5, lineHeight: 1.35, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.45, overflowWrap: "anywhere" }}>
          {item.body}
        </p>
      )}
      {parsed ? (
        <details style={{ marginTop: 2, minWidth: 0 }}>
          <summary className="uppercase cursor-pointer" style={{
            fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--hex-active-border)", letterSpacing: 0.08,
          }}>
            raw payload
          </summary>
          <pre style={{
            margin: "8px 0 0", maxWidth: "100%", maxHeight: 180, overflow: "auto", whiteSpace: "pre-wrap",
            overflowWrap: "anywhere", fontFamily: "var(--f-mono)", fontSize: 10.5,
            lineHeight: 1.45, color: "var(--muted)",
          }}>{JSON.stringify(parsed, null, 2)}</pre>
        </details>
      ) : null}
    </article>
  );
}

function integrationRows(item: SwarmEventItem) {
  const raw = asPayloadRecord(item.raw) ?? parsePayload(item.body);
  const data = raw?.data;
  const records = Array.isArray(data)
    ? data.slice(0, 3)
    : Array.isArray(raw)
      ? raw.slice(0, 3)
      : [];
  const objectData = asPayloadRecord(data);
  const source = objectData ?? raw;
  const rows: Array<[string, string]> = [];
  if (source) {
    for (const key of ["success", "error", "message", "status", "category", "description", "name", "title"]) {
      const value = source[key];
      if (value !== undefined && value !== null && typeof value !== "object") rows.push([key, String(value)]);
    }
  }
  for (const [index, record] of records.entries()) {
    const row = asPayloadRecord(record);
    if (!row) continue;
    const title = payloadValue(row, ["name", "title", "id", "category"]) || `item ${index + 1}`;
    const detail = payloadValue(row, ["description", "summary", "message", "status", "injection"]) || JSON.stringify(row).slice(0, 120);
    rows.push([`#${index + 1} ${title}`, detail]);
  }
  return { raw, rows: rows.slice(0, 5) };
}

function IntegrationPayloadCard({ item }: { item: SwarmEventItem }) {
  const { raw, rows } = integrationRows(item);
  const tone = item.level === "warn" ? "var(--hex-honey-border)" : item.level === "error" ? "var(--danger)" : "var(--muted)";
  return (
    <article style={{
      minWidth: 0, padding: "10px 12px", borderRadius: 8,
      border: `1px solid ${item.level === "warn" ? "rgba(255,212,90,0.22)" : "rgba(148,163,184,0.16)"}`,
      background: "var(--panel-bg-soft)", display: "grid", gap: 8,
    }}>
      <div className="uppercase" style={{
        fontFamily: "var(--f-mono)", fontSize: 10,
        color: tone, letterSpacing: 0.08, overflowWrap: "anywhere", wordBreak: "break-word",
      }}>
        {item.meta ?? item.title}
      </div>
      <strong style={{ display: "block", fontSize: 13, color: "var(--foreground)", overflowWrap: "anywhere", wordBreak: "break-word" }}>{item.title}</strong>
      {rows.length ? (
        <dl className="grid" style={{ gap: 6, margin: 0, minWidth: 0 }}>
          {rows.map(([label, value]) => (
            <div key={`${label}-${value.slice(0, 18)}`} className="grid" style={{ gap: 3 }}>
              <dt className="uppercase" style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--muted)", letterSpacing: 0.08 }}>
                {label.replaceAll("_", " ")}
              </dt>
              <dd style={{ margin: 0, color: "var(--foreground)", fontSize: 12.5, lineHeight: 1.45, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 12, lineHeight: 1.45, overflowWrap: "anywhere" }}>
          {item.body}
        </p>
      )}
      {raw ? (
        <details style={{ marginTop: 2, minWidth: 0 }}>
          <summary className="uppercase cursor-pointer" style={{
            fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--hex-active-border)", letterSpacing: 0.08,
          }}>
            raw payload
          </summary>
          <pre style={{
            margin: "8px 0 0", maxWidth: "100%", maxHeight: 180, overflow: "auto", whiteSpace: "pre-wrap",
            overflowWrap: "anywhere", fontFamily: "var(--f-mono)", fontSize: 10.5,
            lineHeight: 1.45, color: "var(--muted)",
          }}>{JSON.stringify(raw, null, 2)}</pre>
        </details>
      ) : null}
    </article>
  );
}

export function PolymarketView({ run, market }: { run: SwarmRun; market: SwarmMarket }) {
  const items = [
    ...(run.marketItems ?? []),
    ...(run.marketPriceItems ?? []),
  ].slice(0, 10);
  const marketRecords = items.flatMap((item) => {
    const parsed = asPayloadRecord(item.raw) ?? parsePayload(item.body);
    const data = asPayloadRecord(parsed?.data);
    const nestedMarket = asPayloadRecord(data?.market);
    return [nestedMarket, parsed].filter(Boolean) as Record<string, unknown>[];
  });
  const snapshotOdds = marketRecords
    .map((record) => payloadNumber(record, ["price_yes", "yes_price", "price", "probability", "odds"]))
    .find((value) => value !== undefined);
  const latest = market.ticks.at(-1) ?? snapshotOdds;
  const open = market.ticks[0] ?? snapshotOdds;
  const delta = market.ticks.length >= 2 && latest !== undefined && open !== undefined ? latest - open : undefined;
  const hasOdds = latest !== undefined;
  const oddsSource = market.ticks.length ? "price history" : snapshotOdds !== undefined ? "market snapshot" : "";
  const marketQuestion = market.symbol !== "MiroShark markets" && market.symbol !== "No market data"
    ? market.symbol
    : run.title;
  const scenario = run.scenario && run.scenario !== marketQuestion ? run.scenario : run.summary;
  const headlines = market.headlines.length ? market.headlines : (run.timelineItems ?? []).slice(0, 6).map((item, index) => ({
    t: item.meta ?? `T+${index + 1}`,
    body: `${item.title}: ${item.body}`,
    tone: item.tone ?? "neutral" as const,
  }));

  return (
    <div style={{
      width: "min(900px, 100%)", margin: "0 auto", color: "var(--foreground)",
      display: "grid", gap: 14, minWidth: 0,
    }}>
      <section style={{
        borderRadius: 10, border: "1px solid rgba(94,234,212,0.22)",
        background: "linear-gradient(180deg, rgba(94,234,212,0.08), var(--panel-bg))",
        padding: 16, minWidth: 0,
      }}>
        <div className="grid" style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
          gap: 14, alignItems: "stretch",
        }}>
          <div style={{
            minWidth: 0, padding: 14, borderRadius: 8,
            border: "1px solid rgba(148,163,184,0.14)", background: "rgba(2,6,23,0.26)",
            display: "flex", flexDirection: "column", maxHeight: 360, overflow: "hidden",
          }}>
            <div className="uppercase" style={{
              fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: 0.12,
              color: "var(--hex-active-border)",
            }}>
              Polymarket simulation · {run.state}
            </div>
            <div style={{ minHeight: 0, overflow: "auto", paddingRight: 6 }}>
              <div className="uppercase" style={{
                marginTop: 14, fontFamily: "var(--f-mono)", fontSize: 10,
                color: "var(--muted)", letterSpacing: 0.1,
              }}>
                market question
              </div>
              <h2 style={{
                margin: "5px 0 12px", fontFamily: "var(--f-display)", fontSize: 21,
                lineHeight: 1.24, letterSpacing: 0, fontWeight: 750,
                overflowWrap: "anywhere", wordBreak: "break-word",
              }}>
                {marketQuestion}
              </h2>
              <div className="uppercase" style={{
                fontFamily: "var(--f-mono)", fontSize: 10,
                color: "var(--muted)", letterSpacing: 0.1,
              }}>
                scenario brief
              </div>
              <p style={{
                margin: "5px 0 0", color: "var(--muted)", fontSize: 13, lineHeight: 1.55,
                overflowWrap: "anywhere", wordBreak: "break-word",
              }}>
                {scenario}
              </p>
            </div>
          </div>
          <div className="grid" style={{
            gap: 8, padding: 14, borderRadius: 8,
            border: "1px solid rgba(148,163,184,0.16)", background: "var(--code-bg)",
            alignContent: "center", minWidth: 0,
          }}>
            <span className="uppercase" style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", letterSpacing: 0.1 }}>
              latest yes odds
            </span>
            <strong style={{
              fontFamily: "var(--f-display)", fontSize: hasOdds ? 42 : 28, lineHeight: 1,
              color: oddsTone(latest),
            }}>
              {hasOdds ? percent(latest) : "No odds"}
            </strong>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: delta === undefined ? "var(--muted)" : oddsTone(latest) }}>
              {delta !== undefined
                ? `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)} pts from open`
                : oddsSource
                  ? `from ${oddsSource}`
                  : "MiroShark returned no odds data"}
            </span>
          </div>
        </div>
      </section>

      <section className="grid" style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
        gap: 14, alignItems: "start",
      }}>
        <div style={{
          borderRadius: 10, border: "1px solid rgba(148,163,184,0.16)",
          background: "var(--panel-bg)", padding: 14, minWidth: 0,
        }}>
          <div className="uppercase" style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", letterSpacing: 0.1 }}>
            market payload
          </div>
          <div className="grid" style={{ gap: 8, marginTop: 10, maxHeight: 390, overflow: "auto", paddingRight: 2, minWidth: 0 }}>
            {items.length ? items.map((item) => (
              <PolymarketPayloadCard key={item.id} item={item} />
            )) : (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                This run returned a market shell but no detailed market rows.
              </p>
            )}
          </div>
        </div>

        <div style={{
          borderRadius: 10, border: "1px solid rgba(148,163,184,0.16)",
          background: "var(--panel-bg)", padding: 14, minWidth: 0,
        }}>
          <div className="uppercase" style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", letterSpacing: 0.1 }}>
            evidence timeline
          </div>
          <div className="grid" style={{ gap: 8, marginTop: 10 }}>
            {headlines.length ? headlines.map((headline, index) => (
              <article key={`${headline.t}-${index}`} className="grid" style={{
                gridTemplateColumns: "46px minmax(0,1fr)", gap: 10,
                padding: "8px 10px", borderRadius: 8,
                border: "1px solid rgba(148,163,184,0.14)", background: "var(--panel-bg-soft)",
              }}>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", overflowWrap: "anywhere" }}>{headline.t}</span>
                <span style={{ fontSize: 12.5, lineHeight: 1.45, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  {headline.body}
                </span>
              </article>
            )) : (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                No separate evidence events were returned for this Polymarket run.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ─── Research brief view ────────────────────────────────────────────── */
export function ResearchView({ run }: { run: SwarmRun }) {
  const items = [
    ...(run.timelineItems ?? []),
    ...(run.observabilityItems ?? []),
  ].slice(0, 12);
  return (
    <div style={{
      width: "min(720px, 100%)", margin: "0 auto", padding: "20px 28px",
      background: "var(--panel-bg)", color: "var(--foreground)",
      border: "1px solid rgba(148,163,184,0.16)", borderRadius: 10,
      fontFamily: "Iowan Old Style, Georgia, serif",
    }}>
      <div className="uppercase" style={{
        fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", letterSpacing: 0.12,
      }}>{run.platform ?? "simulation"} · synthesized from MiroShark run data</div>
      <h1 className="font-bold" style={{
        fontSize: 30, margin: "8px 0 4px", color: "var(--foreground)", letterSpacing: -0.5,
      }}>{run.title}</h1>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--hex-active-border)", marginBottom: 14 }}>
        {run.agents} agents · {run.news} records · {run.started}
      </div>
      <p style={{ fontSize: 14.5, lineHeight: 1.65, margin: "0 0 12px" }}>
        {run.scenario || run.summary}
      </p>
      <h2 className="font-bold" style={{ fontSize: 18, margin: "20px 0 6px" }}>Run records</h2>
      <ul style={{ paddingLeft: 22, lineHeight: 1.7 }}>
        {items.length ? items.map((item) => (
          <li key={item.id}><strong>{item.title}:</strong> {item.body}</li>
        )) : <li>No timeline or observability records returned for this run yet.</li>}
      </ul>
    </div>
  );
}

/* ─── Ops storm console ──────────────────────────────────────────────── */
export function OpsView({ run }: { run: SwarmRun }) {
  const events = (run.observabilityItems?.length ? run.observabilityItems : run.timelineItems ?? []).map((item, index) => ({
    t: item.meta ?? String(index + 1).padStart(2, "0"),
    level: item.level ?? (run.state === "failed" ? "error" : "info"),
    msg: `${item.title}: ${item.body}`,
  }));
  if (!events.length) return <OutputEmpty title="No ops events returned" body={run.summary} />;
  return (
    <div style={{
      width: "min(720px, 100%)", margin: "0 auto",
      borderRadius: 10, border: "1px solid rgba(251,113,133,0.34)",
      background: "linear-gradient(180deg, rgba(251,113,133,0.06), var(--code-bg))",
      overflow: "hidden", maxHeight: 720,
    }}>
      <header className="flex justify-between items-center"
        style={{ padding: "12px 16px", borderBottom: "1px solid rgba(251,113,133,0.34)" }}>
        <div className="uppercase" style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "#fecdd3", letterSpacing: 0.12 }}>
          ops · storm console · {run.state}
        </div>
        <span className="uppercase font-bold" style={{
          padding: "3px 9px", borderRadius: 4,
          background: "rgba(251,113,133,0.16)", border: "1px solid rgba(251,113,133,0.42)",
          color: "#fecdd3", fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: 0.08,
        }}>{run.state}</span>
      </header>
      <div className="overflow-auto" style={{
        padding: "12px 16px", maxHeight: 640, fontFamily: "var(--f-mono)", fontSize: 12, lineHeight: 1.7,
      }}>
        {events.map((e, i) => {
          const c = (
            e.level === "info"  ? "var(--muted)" :
            e.level === "warn"  ? "var(--hex-honey-border)" :
            e.level === "error" ? "#fecdd3" :
                                  "var(--danger)"
          );
          return (
            <div key={i} className="grid" style={{ gridTemplateColumns: "56px 64px 1fr", gap: 8 }}>
              <span style={{ color: "var(--muted)" }}>{e.t}</span>
              <span className="uppercase font-bold" style={{ color: c }}>{e.level}</span>
              <span style={{ color: e.level === "fatal" ? "var(--danger)" : "var(--foreground)" }}>{e.msg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MiroSharkIntegrationView({
  run,
  onPublish,
  publishPending = false,
  publishStatus,
}: {
  run: SwarmRun;
  onPublish?: () => void;
  publishPending?: boolean;
  publishStatus?: string;
}) {
  const items = [
    ...(run.integrationItems ?? []),
    ...(run.marketPriceItems ?? []),
  ].slice(0, 18);
  const links = run.exportLinks ?? [];
  const draftNotice = items.find((item) => item.id === "miroshark-integration-draft");
  const outputItems = items.filter((item) => item.id !== "miroshark-integration-draft");
  const isDraftOnly = Boolean(draftNotice) && outputItems.length === 0;
  return (
    <div style={{
      width: "100%", margin: "0 auto", padding: 18,
      borderRadius: 10, border: "1px solid rgba(148,163,184,0.16)",
      background: "var(--panel-bg)", color: "var(--foreground)",
      display: "grid", gap: 14,
    }}>
      <header>
        <div className="uppercase" style={{
          fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: 0.12, color: "var(--hex-active-border)",
        }}>
          {isDraftOnly ? "Simulation status" : "MiroShark outputs"}
        </div>
        <h2 className="font-bold" style={{
          margin: "4px 0 0", fontFamily: "var(--f-display)", fontSize: 22, letterSpacing: -0.3,
        }}>
          {isDraftOnly ? "Not published yet" : "Reports, exports, interviews, markets"}
        </h2>
      </header>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 10 }}>
        {draftNotice ? (
          <article style={{
            gridColumn: "1 / -1", padding: "12px 14px", borderRadius: 8,
            border: "1px solid rgba(255,212,90,0.22)", background: "var(--panel-bg-soft)",
            display: "grid", gap: 10,
          }}>
            <div>
              <div className="uppercase" style={{
                fontFamily: "var(--f-mono)", fontSize: 10,
                color: "var(--hex-honey-border)", letterSpacing: 0.08,
              }}>
                {draftNotice.meta}
              </div>
              <strong style={{ display: "block", marginTop: 4, fontSize: 13, color: "var(--foreground)" }}>
                {draftNotice.title}
              </strong>
              <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 12, lineHeight: 1.45 }}>
                {draftNotice.body}
              </p>
            </div>
            {onPublish ? (
              <button
                type="button"
                onClick={onPublish}
                disabled={publishPending}
                className="uppercase font-bold cursor-pointer"
                style={{
                  justifySelf: "start", padding: "7px 12px", borderRadius: 999,
                  border: "1px solid rgba(255,212,90,0.3)",
                  background: "rgba(255,212,90,0.14)", color: "var(--hex-honey-border)",
                  fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: 0.08,
                  opacity: publishPending ? 0.7 : 1,
                }}
              >
                {publishPending ? "Publishing..." : "Publish simulation"}
              </button>
            ) : null}
            {publishStatus ? (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.45 }}>
                {publishStatus}
              </p>
            ) : null}
          </article>
        ) : null}
        {outputItems.length ? outputItems.map((item) => (
          <IntegrationPayloadCard key={item.id} item={item} />
        )) : !draftNotice ? (
          <article style={{
            gridColumn: "1 / -1", padding: "10px 12px", borderRadius: 8,
            border: "1px solid rgba(148,163,184,0.16)", background: "var(--panel-bg-soft)",
          }}>
            <strong>No extended integration payloads yet</strong>
            <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 12 }}>
              This run has not returned report, graph, interview, export, webhook, or market-price payloads yet.
            </p>
          </article>
        ) : null}
      </div>
      {links.length ? (
        <div className="flex flex-wrap" style={{ gap: 7 }}>
          {links.map((link) => (
            <a key={link.key} href={link.href} target="_blank" rel="noreferrer"
              className="uppercase font-bold"
              style={{
                padding: "6px 9px", borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.22)",
                color: "var(--hex-honey-border)", fontFamily: "var(--f-mono)",
                fontSize: 10, letterSpacing: 0.06, textDecoration: "none",
              }}>
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
