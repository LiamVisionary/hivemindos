"use client";

/**
 * Page Agent lab — a self-contained proof surface for alibaba/page-agent.
 *
 * Renders a small demo UI (form, dropdown, checkbox, counter) and mounts the
 * reusable {@link PageAgentPanel}, so the in-page agent can read the DOM, plan,
 * and click for real via the OpenRouter-backed proxy at /api/page-agent. The
 * panel owns the agent + chat surface; this page only supplies things to drive.
 *
 * DELIBERATELY isolated from the real dashboard: nothing money-moving is
 * reachable here.
 */

import { useState } from "react";

import { PageAgentPanel } from "./PageAgentPanel";
import styles from "./page-agent-lab.module.css";

export default function PageAgentLab() {
  const [submitted, setSubmitted] = useState<null | {
    name: string;
    email: string;
    role: string;
    subscribe: boolean;
  }>(null);
  const [count, setCount] = useState(0);

  const onFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitted({
      name: String(data.get("name") || ""),
      email: String(data.get("email") || ""),
      role: String(data.get("role") || ""),
      subscribe: data.get("subscribe") === "on",
    });
  };

  return (
    <div className={styles.lab}>
      <header className={styles.head}>
        <h1 className={styles.title}>Page Agent — Lab</h1>
        <p className={styles.sub}>
          An in-page GUI agent driving this page&apos;s own UI with natural
          language. Instruct it from the pill below. Nothing here touches
          wallets, trading, or the fleet — this is an isolated proof surface.
        </p>
      </header>

      <section className={styles.grid}>
        <form
          className={styles.card}
          onSubmit={onFormSubmit}
          aria-label="Demo contact form"
        >
          <h2 className={styles.cardTitle}>Contact form</h2>

          <label className={styles.field}>
            <span>Name</span>
            <input name="name" type="text" placeholder="Full name" autoComplete="off" />
          </label>

          <label className={styles.field}>
            <span>Email</span>
            <input name="email" type="email" placeholder="name@example.com" autoComplete="off" />
          </label>

          <label className={styles.field}>
            <span>Role</span>
            <select name="role" defaultValue="">
              <option value="" disabled>
                Choose a role…
              </option>
              <option value="Engineer">Engineer</option>
              <option value="Designer">Designer</option>
              <option value="Product">Product</option>
              <option value="Operations">Operations</option>
            </select>
          </label>

          <label className={styles.checkbox}>
            <input name="subscribe" type="checkbox" />
            <span>Subscribe to the newsletter</span>
          </label>

          <button type="submit" className={styles.primary}>
            Submit
          </button>
        </form>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Counter</h2>
          <div className={styles.counterRow}>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => setCount((c) => c - 1)}
              aria-label="Decrement counter"
            >
              −
            </button>
            <output className={styles.count} data-testid="counter">
              {count}
            </output>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => setCount((c) => c + 1)}
              aria-label="Increment counter"
            >
              +
            </button>
          </div>

          <h2 className={styles.cardTitle} style={{ marginTop: 24 }}>
            Submitted
          </h2>
          {submitted ? (
            <dl className={styles.result} data-testid="submitted">
              <div>
                <dt>Name</dt>
                <dd>{submitted.name || "—"}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{submitted.email || "—"}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{submitted.role || "—"}</dd>
              </div>
              <div>
                <dt>Subscribed</dt>
                <dd>{submitted.subscribe ? "yes" : "no"}</dd>
              </div>
            </dl>
          ) : (
            <p className={styles.empty}>Nothing submitted yet.</p>
          )}
        </div>
      </section>

      <PageAgentPanel placement="center" />
    </div>
  );
}
