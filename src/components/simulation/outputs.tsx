"use client";

/* outputs.tsx — native, brand-faithful output surfaces:
     • XThreadView   — a white Twitter/X thread (verified badge, action row)
     • RedditView    — a dark subreddit comment cascade (vote arrows, role tags)
     • ResearchView  — an Obsidian-style consensus brief
     • OpsView       — a failure-storm terminal log
   X/Reddit keep their native brand colors (hard-coded) so they read as the real
   thing; Research/Ops use the sim-root tokens. All content comes from
   useSimData() — real MiroShark run payloads — with empty states when a run
   returned nothing for that surface. */

import React from "react";
import { type RedditReply, type Run } from "./sim-data";
import { useSimData } from "./sim-context";

function OutputEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ width: "min(620px, 100%)", margin: "0 auto", padding: "20px 22px", borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--panel)", color: "var(--fg)" }}>
      <h2 style={{ margin: "0 0 8px", fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 18 }}>{title}</h2>
      <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 13, lineHeight: 1.55 }}>{body}</p>
    </div>
  );
}

// ── X (Twitter) thread ──────────────────────────────────────────────────────
const XIcon = {
  reply: <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01z" /></svg>,
  retweet: <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" /></svg>,
  like: <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z" /></svg>,
  share: <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" /></svg>,
  more: <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>,
  verify: <svg viewBox="0 0 22 22" width="16" height="16" fill="#1d9bf0" aria-hidden><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.273 1.084-.704 1.439-1.245.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" /></svg>,
};
const xAvatar: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 46, height: 46, borderRadius: 999, background: "#1d9bf0", color: "#fff", fontSize: 13, fontWeight: 700, flex: "0 0 auto" };
const xActions: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8, color: "#536471", padding: "10px 0" };

export function XThreadView({ run }: { run: Run }) {
  const data = useSimData().threadFor(run);
  if (!data || !data.tweets.length) return <OutputEmpty title="No X posts returned" body={run.summary} />;
  const { display, handle, tweets } = data;
  const initials = (display || "MiroShark").trim().slice(0, 2).toUpperCase() || "HM";
  return (
    <div style={{ width: "min(620px, 100%)", margin: "0 auto", border: "1px solid rgb(207,217,222)", borderRadius: 12, background: "#fff", color: "#0f1419", fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif", overflow: "hidden" }}>
      <article style={{ padding: "16px 16px 0", borderBottom: "1px solid rgb(239,243,244)" }}>
        <header style={{ display: "grid", gridTemplateColumns: "46px minmax(0,1fr) auto", gap: 12, alignItems: "center" }}>
          <div style={xAvatar}>{initials}</div>
          <div><strong style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, fontWeight: 700, color: "#0f1419" }}>{display} {XIcon.verify}</strong><span style={{ display: "block", color: "#536471", fontSize: 15 }}>@{handle}</span></div>
          <span style={{ color: "#536471", alignSelf: "start" }}>{XIcon.more}</span>
        </header>
        <p style={{ color: "#0f1419", fontSize: 23, lineHeight: 1.32, margin: "16px 0", whiteSpace: "pre-wrap" }}>{tweets[0].text}</p>
        {tweets[0].time && <div style={{ color: "#536471", fontSize: 14, paddingBottom: 12 }}>{tweets[0].time}</div>}
        <div style={xActions}>
          {([["reply", tweets[0].stats.reply], ["retweet", tweets[0].stats.retweet], ["like", tweets[0].stats.like], ["share", tweets[0].stats.view]] as [keyof typeof XIcon, number | undefined][]).map(([k, n]) => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "#536471", fontSize: 13 }}>{XIcon[k]}<span>{(n || 0).toLocaleString()}</span></span>
          ))}
        </div>
      </article>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {tweets.slice(1).map((t, i) => (
          <li key={i} style={{ position: "relative", display: "grid", gridTemplateColumns: "46px minmax(0,1fr)", gap: 12, padding: "12px 16px", borderBottom: "1px solid rgb(239,243,244)" }}>
            <div style={xAvatar}>{initials}</div>
            {i < tweets.length - 2 && <span style={{ position: "absolute", left: 38, top: 58, bottom: 0, width: 2, background: "rgb(207,217,222)" }} />}
            <article style={{ minWidth: 0 }}>
              <header style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 5 }}>
                <strong style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#0f1419", fontSize: 15, fontWeight: 700 }}>{display} {XIcon.verify}</strong>
                <span style={{ color: "#536471", fontSize: 15 }}>@{handle}</span><span style={{ color: "#536471", fontSize: 15 }}>· {i + 1}m</span>
              </header>
              <div style={{ color: "#536471", fontSize: 14, margin: "2px 0 4px" }}>Replying to <span style={{ color: "#1d9bf0" }}>@{handle}</span></div>
              <p style={{ color: "#0f1419", fontSize: 16, lineHeight: 1.35, margin: 0, whiteSpace: "pre-wrap" }}>{t.text}</p>
              <div style={{ ...xActions, maxWidth: 420, marginTop: 8 }}>
                {([["reply", t.stats.reply], ["retweet", t.stats.retweet], ["like", t.stats.like], ["share", t.stats.view]] as [keyof typeof XIcon, number | undefined][]).map(([k, n]) => (
                  <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "#536471", fontSize: 13 }}>{XIcon[k]}{n ? <span>{n.toLocaleString()}</span> : null}</span>
                ))}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Reddit cascade ───────────────────────────────────────────────────────────
// Vote arrows are display-only chrome on simulated posts — there is nothing to
// vote on, so they are non-interactive (no button, default cursor).
const redditVote: React.CSSProperties = { width: 22, height: 22, padding: 0, color: "#818384", fontSize: 14, textAlign: "center" };
function RedditComment({ c }: { c: RedditReply }) {
  const roleColor = c.role ? ({ MM: "#fde68a", TKR: "#fecdd3", INFO: "#99f6e4", OPS: "#cbd5e1" } as Record<string, string>)[c.role] : "#818384";
  return (
    <div>
      <header style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
        <strong style={{ color: "#d7dadc", fontSize: 13 }}>{c.author}</strong>
        {c.role && <span style={{ padding: "1px 6px", borderRadius: 4, background: `color-mix(in srgb, ${roleColor} 20%, transparent)`, color: roleColor, fontFamily: "var(--f-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>{c.role}</span>}
        <span style={{ color: "#818384", fontSize: 11 }}>{c.score} pts · {c.time} ago</span>
      </header>
      <p style={{ margin: 0, fontSize: 13.5, color: "#d7dadc", lineHeight: 1.5 }}>{c.body}</p>
    </div>
  );
}
export function RedditView({ run }: { run: Run }) {
  const post = useSimData().redditFor(run);
  if (!post) return <OutputEmpty title="No Reddit cascade returned" body={run.summary} />;
  return (
    <div style={{ width: "min(720px, 100%)", margin: "0 auto", background: "#1a1a1b", color: "#d7dadc", border: "1px solid #343536", borderRadius: 8, fontFamily: "-apple-system, system-ui, sans-serif", overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: "1px solid #343536", background: "#272729" }}>
        <div style={{ width: 32, height: 32, borderRadius: 999, background: "#ff4500", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>r/</div>
        <div><div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>r/{post.subreddit}</div><div style={{ fontSize: 11, color: "#818384" }}>Posted by {post.author} · {post.time} ago</div></div>
        <span style={{ marginLeft: "auto", padding: "5px 12px", borderRadius: 999, background: run.state === "done" ? "#343536" : "#ff4500", color: "#fff", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>{run.state === "done" ? "settled" : "narrative live"}</span>
      </header>
      <article style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 12, padding: "16px 14px", borderBottom: "1px solid #343536" }}>
        <div style={{ display: "grid", placeItems: "center", gap: 3, color: "#818384", fontFamily: "var(--f-mono)", fontSize: 11 }}>
          <span style={redditVote}>▲</span><span style={{ color: "#ff8717", fontWeight: 800 }}>{post.score >= 1000 ? `${(post.score / 1000).toFixed(1)}k` : post.score}</span><span style={redditVote}>▼</span>
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 18, lineHeight: 1.35, fontWeight: 600, color: "#fff" }}>{post.title}</h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#d7dadc" }}>{post.body}</p>
          <div style={{ display: "flex", gap: 14, marginTop: 12, color: "#818384", fontSize: 12, fontWeight: 700 }}><span>💬 {post.comments} comments</span><span>↗ share</span><span>⌁ save</span></div>
        </div>
      </article>
      <ul style={{ listStyle: "none", margin: 0, padding: "8px 14px 14px" }}>
        {post.threads.map((c, i) => (
          <li key={i} style={{ padding: "10px 0 10px 12px", borderLeft: "2px solid #343536", marginLeft: 4 }}>
            <RedditComment c={c} />
            {c.replies && c.replies.length > 0 && (
              <ul style={{ listStyle: "none", margin: "8px 0 0 12px", padding: 0 }}>
                {c.replies.map((r, j) => <li key={j} style={{ padding: "8px 0 8px 12px", borderLeft: "2px solid #343536", marginTop: 6 }}><RedditComment c={r} /></li>)}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Research brief (Obsidian) ────────────────────────────────────────────────
export function ResearchView({ run }: { run: Run }) {
  const content = useSimData().researchFor(run);
  if (!content) return <OutputEmpty title="No research brief returned" body={run.summary} />;
  return (
    <div style={{ width: "min(720px, 100%)", margin: "0 auto", padding: "20px 28px", background: "var(--panel)", color: "var(--fg-2)", border: "1px solid var(--line)", borderRadius: "var(--radius)", fontFamily: "Iowan Old Style, Georgia, serif" }}>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.12em", textTransform: "uppercase" }}>{content.eyebrow}</div>
      <h1 style={{ fontSize: 29, fontWeight: 700, margin: "8px 0 4px", color: "var(--fg)", letterSpacing: "-0.01em" }}>{content.title}</h1>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--live)", marginBottom: 14 }}>{content.meta}</div>
      <p style={{ fontSize: 14.5, lineHeight: 1.65, margin: "0 0 12px" }}>{content.body}</p>
      {content.records.length > 0 && (
        <>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: "20px 0 6px", color: "var(--fg)" }}>Findings</h2>
          <ul style={{ paddingLeft: 22, lineHeight: 1.7, margin: 0 }}>
            {content.records.map((r, i) => <li key={i}><strong style={{ color: "var(--fg)" }}>{r.title}:</strong> {r.body}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

// ── Ops failure storm ────────────────────────────────────────────────────────
export function OpsView({ run }: { run: Run }) {
  const events = useSimData().opsFor(run);
  if (!events.length) return <OutputEmpty title="No ops events returned" body={run.summary} />;
  const aborted = events.some((e) => e.level === "fatal") || run.state === "failed";
  const tone: Record<string, string> = { info: "var(--fg-3)", warn: "var(--honey)", error: "var(--danger)", fatal: "var(--danger)" };
  return (
    <div style={{ width: "min(760px, 100%)", margin: "0 auto", borderRadius: "var(--radius)", border: "1px solid var(--danger)", background: "linear-gradient(180deg, var(--danger-soft), var(--bg-soft))", overflow: "hidden" }}>
      <header style={{ padding: "12px 16px", borderBottom: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--danger)", letterSpacing: "0.12em", textTransform: "uppercase" }}>ops · storm console · {run.state}</div>
        <span style={{ padding: "3px 9px", borderRadius: 4, background: "var(--danger-soft)", border: "1px solid var(--danger)", color: "var(--danger)", fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{aborted ? "aborted" : run.state}</span>
      </header>
      <div style={{ padding: "12px 16px", fontFamily: "var(--f-mono)", fontSize: 12, lineHeight: 1.7, maxHeight: 640, overflow: "auto" }}>
        {events.map((e, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "56px 64px 1fr", gap: 8 }}>
            <span style={{ color: "var(--fg-4)" }}>{e.t}</span>
            <span style={{ color: tone[e.level], fontWeight: 700, textTransform: "uppercase" }}>{e.level}</span>
            <span style={{ color: e.level === "fatal" ? "var(--danger)" : "var(--fg-2)" }}>{e.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
