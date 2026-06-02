"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { getNativeAppVersion } from "@/lib/native/desktop-status";
import type { AppVersion } from "@/features/dashboard/dashboard-types";
import styles from "./about.module.css";

type UpdateCheckState = "idle" | "checking" | "available" | "current" | "error";
type UpdateRunState = "idle" | "running" | "success" | "error";

type UpdateResult = {
  ok?: boolean;
  error?: string;
  method?: string;
  stdout?: string;
  stderr?: string;
  fallbackCommand?: string;
};

function short(value?: string | null) {
  return value ? value.slice(0, 7) : "";
}

function isUpdateAvailable(version: AppVersion | null) {
  if (!version?.commit || !version.latestCommit) return false;
  return version.commit !== version.latestCommit;
}

async function fetchAppVersion(signal?: AbortSignal): Promise<AppVersion | null> {
  const nativeVersion = await getNativeAppVersion(signal);
  const response = await fetch("/api/app/version", { cache: "no-store", signal }).catch(() => null);
  const webVersion = await response?.json().catch(() => null) as AppVersion | null;
  return webVersion?.commit ? webVersion : nativeVersion;
}

export default function AboutPage() {
  const [version, setVersion] = useState<AppVersion | null>(null);
  const [checkState, setCheckState] = useState<UpdateCheckState>("idle");
  const [runState, setRunState] = useState<UpdateRunState>("idle");
  const [message, setMessage] = useState("Checking for updates...");
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);

  const updateAvailable = isUpdateAvailable(version);
  const testUpdateAvailable = !updateAvailable && checkState === "current";
  const canCheck = checkState !== "checking" && runState !== "running";
  const canUpdate = (updateAvailable || testUpdateAvailable) && runState !== "running" && checkState !== "checking";
  const statusLabel = checkState === "checking"
    ? "Checking..."
    : checkState === "error"
      ? "Update Check Failed"
      : updateAvailable
        ? "Update Available"
        : "Test Update Available";
  const versionLine = useMemo(() => {
    const displayVersion = version?.version ?? "0.1.0";
    const commit = short(version?.commit);
    return commit ? `Version ${displayVersion} (${commit})` : `Version ${displayVersion}`;
  }, [version?.commit, version?.version]);

  const checkForUpdates = useCallback(async (signal?: AbortSignal) => {
    setCheckState("checking");
    setRunState("idle");
    setUpdateResult(null);
    setMessage("Checking for updates...");
    try {
      const nextVersion = await fetchAppVersion(signal);
      if (signal?.aborted) return;
      setVersion(nextVersion);
      if (isUpdateAvailable(nextVersion)) {
        setCheckState("available");
        setMessage(`Update available: ${short(nextVersion?.latestCommit)} is ready.`);
      } else {
        setCheckState("current");
        setMessage("HivemindOS is up to date. A test update is available for this build.");
      }
    } catch (error) {
      if (signal?.aborted) return;
      setCheckState("error");
      setMessage(error instanceof Error ? error.message : "Could not check for updates.");
    }
  }, []);

  async function runUpdate() {
    if (!version?.appDir) {
      setRunState("error");
      setMessage("Could not find the local HivemindOS checkout for update.");
      return;
    }
    setRunState("running");
    setUpdateResult(null);
    setMessage(updateAvailable ? "Starting update..." : "Running test update through the update flow...");
    const response = await fetch("/api/fleet/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appDir: version.appDir,
        expectedCommit: updateAvailable ? version.latestCommit : version.commit,
        simulate: !updateAvailable,
        source: "native-about",
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as UpdateResult | null;
    setUpdateResult(data);
    if (response?.ok && data?.ok !== false) {
      setRunState("success");
      setMessage(updateAvailable ? "Update flow completed." : "Test update completed through the real update endpoint.");
      if (updateAvailable) void checkForUpdates();
      return;
    }
    setRunState("error");
    setMessage(data?.error ?? "Update failed.");
  }

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      void checkForUpdates(controller.signal);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [checkForUpdates]);

  useEffect(() => {
    const handler = () => {
      void checkForUpdates();
    };
    window.addEventListener("hivemindos:check-updates", handler);
    return () => window.removeEventListener("hivemindos:check-updates", handler);
  }, [checkForUpdates]);

  return (
    <main className={styles.aboutWindow}>
      <Image className={styles.icon} src="/app-icon-1024.png" alt="" width={104} height={104} priority />
      <h1>HivemindOS</h1>
      <p className={styles.version}>{versionLine}</p>
      <section className={styles.updatePanel} aria-live="polite">
        <div>
          <strong>{statusLabel}</strong>
          <p>{message}</p>
        </div>
        <div className={styles.actions}>
          {canCheck ? (
            <button className={styles.linkButton} type="button" onClick={() => void checkForUpdates()}>
              Check again
            </button>
          ) : null}
          <button className={styles.updateButton} type="button" disabled={!canUpdate} onClick={() => void runUpdate()}>
            {runState === "running" ? "Updating..." : "Update"}
          </button>
        </div>
      </section>
      {updateResult?.method || updateResult?.fallbackCommand ? (
        <p className={styles.updateDetail}>
          {updateResult.method ? `Flow: ${updateResult.method}` : ""}
          {updateResult.fallbackCommand ? " Fallback command prepared." : ""}
        </p>
      ) : null}
    </main>
  );
}
