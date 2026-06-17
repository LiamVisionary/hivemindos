"use client";

/* Shared light/dark resolver for the fleet-hive `.fr-root` design system.

   The app theme lives as `dashboardTheme` state in DashboardApp, mirrored onto
   <html data-theme="hive-light|dark"> — the same signal globals.css keys off.
   Hive surfaces (FleetHiveView, the app-wide PersistentHiveChat, the layout
   toggle) render in different parts of the tree — some portaled to <body>,
   some behind dynamically-imported panels — so rather than thread a `theme`
   prop through every path, each reads that shared attribute reactively and maps
   it to its `data-fr-theme` (see `.fr-root[data-fr-theme]` in fleet-hive.css). */

import * as React from "react";

export function readFrTheme(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "hive-light"
    ? "light"
    : "dark";
}

export function useFrTheme(): "light" | "dark" {
  const [theme, setTheme] = React.useState<"light" | "dark">(readFrTheme);
  React.useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(readFrTheme());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}
