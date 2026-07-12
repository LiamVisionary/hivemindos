"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, ChevronLeft, ExternalLink, Hexagon, RefreshCw } from "lucide-react";

import { Skeleton, SkeletonText, Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";
import type { MiniAppCatalog } from "@/lib/services/mini-app-catalog";
import { openExternalUrl } from "@/lib/native/open-external-url";
import "@/features/dashboard/views/zero-human-companies/theme.css";
import styles from "./MiniAppsPanel.module.css";

type MiniAppsResponse = {
  ok?: boolean;
  catalog?: MiniAppCatalog;
  error?: string;
};

const STATUS_LABELS = {
  live: "Live",
  preview: "Preview",
  "coming-soon": "Coming soon",
} as const;

function MiniAppsSkeleton() {
  return (
    <div className={styles.grid} role="status" aria-label="Loading HivemindOS Mini Apps">
      <article className={styles.skeletonCard}>
        <Skeleton height={208} radius={14} />
        <div className={styles.skeletonBody}>
          <Skeleton width="28%" height={10} />
          <Skeleton width="44%" height={28} />
          <SkeletonText lines={3} />
          <Skeleton width={190} height={40} radius={10} />
        </div>
      </article>
    </div>
  );
}

export function MiniAppsPanel() {
  const [catalog, setCatalog] = useState<MiniAppCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeAppId, setActiveAppId] = useState<string | null>(null);
  const [frameLoading, setFrameLoading] = useState(false);

  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/mini-apps", { cache: "no-store", signal });
      const payload = await response.json().catch(() => null) as MiniAppsResponse | null;
      if (!response.ok || !payload?.ok || !payload.catalog) {
        throw new Error(payload?.error || `Catalog request failed (${response.status}).`);
      }
      setCatalog(payload.catalog);
    } catch (caught) {
      if (signal?.aborted) return;
      setError(caught instanceof Error ? caught.message : "Could not load HivemindOS Mini Apps.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadCatalog(controller.signal));
    return () => controller.abort();
  }, [loadCatalog]);

  const activeApp = catalog?.apps.find((app) => app.id === activeAppId) ?? null;

  if (activeApp) {
    return (
      <section className={`${styles.root} ${styles.embeddedRoot} zhc-root`} aria-label={`${activeApp.name} mini app`}>
        <header className={styles.frameToolbar}>
          <button
            type="button"
            className={styles.backButton}
            onClick={() => {
              setActiveAppId(null);
              setFrameLoading(false);
            }}
          >
            <ChevronLeft aria-hidden="true" /> Mini Apps
          </button>
          <div className={styles.frameIdentity}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={activeApp.iconUrl} alt="" />
            <span>{activeApp.name}</span>
          </div>
          <button
            type="button"
            className={styles.browserButton}
            title="Use the browser for extension wallets or checkout"
            onClick={() => void openExternalUrl(activeApp.url)}
          >
            <ExternalLink aria-hidden="true" /> Open in browser
          </button>
        </header>

        <div className={styles.frameShell} aria-busy={frameLoading}>
          {frameLoading ? (
            <div className={styles.frameLoading} role="status" aria-label={`Opening ${activeApp.name}`}>
              <Spinner size={18} />
              <span>Opening {activeApp.name}</span>
            </div>
          ) : null}
          <iframe
            key={activeApp.id}
            className={styles.appFrame}
            title={activeApp.name}
            src={activeApp.url}
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-top-navigation-by-user-activation"
            allow="clipboard-read; clipboard-write; payment; publickey-credentials-get"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => setFrameLoading(false)}
          />
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.root} zhc-root`} aria-labelledby="mini-apps-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Focused tools · full hive</p>
          <h1 id="mini-apps-title">HivemindOS Mini Apps</h1>
          <p className={styles.lede}>Purpose-built experiences powered by coordinated agent crews. Open one and get straight to the outcome.</p>
        </div>
        {catalog ? (
          <button className={styles.refreshButton} type="button" onClick={() => void loadCatalog()} disabled={loading}>
            {loading ? <Spinner size={14} /> : <RefreshCw aria-hidden="true" />}
            {loading ? "Refreshing" : "Refresh"}
          </button>
        ) : null}
      </header>

      {error ? (
        <div className={styles.errorState} role="alert">
          <Hexagon aria-hidden="true" />
          <strong>The mini-app catalog is out of reach.</strong>
          <p>{error}</p>
          <button type="button" onClick={() => void loadCatalog()}>
            <RefreshCw aria-hidden="true" /> Try again
          </button>
        </div>
      ) : null}

      {!catalog && loading ? <MiniAppsSkeleton /> : null}

      {catalog && !catalog.apps.length && !loading ? (
        <div className={styles.emptyState}>No mini apps are published yet.</div>
      ) : null}

      {catalog?.apps.length ? (
        <div className={styles.grid}>
          {catalog.apps.map((app) => {
            const available = app.status !== "coming-soon";
            return (
              <article className={styles.card} key={app.id}>
                <div className={styles.visual} aria-hidden="true">
                  <span className={styles.orbit} />
                  <span className={styles.orbitSmall} />
                  {/* The icon is resolved from the same website manifest as the product copy. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={app.iconUrl} alt="" />
                  <div className={styles.crew}>
                    {Array.from({ length: 7 }).map((_, index) => <Hexagon key={index} />)}
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.meta}>
                    <span className={styles.status}><i /> {STATUS_LABELS[app.status]}</span>
                    <span>{app.priceLabel}</span>
                  </div>
                  <p className={styles.cardEyebrow}>{app.eyebrow}</p>
                  <h2>{app.name}</h2>
                  <p className={styles.description}>{app.description}</p>
                  <ul className={styles.tags} aria-label={`${app.name} supports`}>
                    {app.tags.map((tag) => <li key={tag}><Check aria-hidden="true" /> {tag}</li>)}
                  </ul>
                  <button
                    type="button"
                    className={styles.openButton}
                    disabled={!available}
                    onClick={() => {
                      if (!available) return;
                      setFrameLoading(true);
                      setActiveAppId(app.id);
                    }}
                  >
                    {app.cta} <ArrowUpRight aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
