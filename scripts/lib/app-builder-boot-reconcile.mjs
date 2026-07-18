// Collector boot-time reconcile for chat-thread App Builder preview runtimes.
//
// Preview servers are spawned as children of the fleet collector
// (startLocalAppProject), so a collector restart/self-reload takes every
// preview runtime down with it — observed twice on a fleet box as projects
// flipping to "The app preview process exited and can be restarted." seconds
// after collector boot. At boot the collector sweeps the registered local
// app-builder projects and restarts the ones whose manifest says they were
// running (a stale "running" manifest with a dead pid, or a reconcile-stamped
// exited stop). A user-requested stop is never restarted, and the start goes
// through the shared adapter's CONFIRM_APP_RUNTIME contract — this only
// restores an already-confirmed running state.
//
// Registry entries for other machines are skipped naturally: their directory
// or manifest doesn't exist here, and restartInterruptedLocalAppProject
// rejects them.

import { restartInterruptedLocalAppProject } from "./app-builder.mjs";

const EXPECTED_SKIP_PATTERN = /does not exist|not a HivemindOS app-builder project|belongs to another directory/;

export async function reconcileAppBuilderRuntimesAtBoot({
  readProjects,
  expandHome,
  log = console.log,
  warn = console.warn,
}) {
  const projects = ((await readProjects()) || [])
    .filter((project) => project?.appBuilder?.backend === "local" && project?.localPath)
    .slice(0, 50);
  const restarted = [];
  for (const project of projects) {
    const label = project.name || project.id || String(project.localPath);
    try {
      const result = await restartInterruptedLocalAppProject(expandHome(String(project.localPath)));
      if (result.restarted) {
        restarted.push(result.project);
        log(`[app-builder] restarted interrupted preview runtime for ${label} on ${result.project.previewUrl}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Registry entries for other machines land here (missing directory /
      // manifest) — quiet. Real restart failures get a line; the manifest
      // keeps the failure in lastError for the dashboard to surface.
      if (!EXPECTED_SKIP_PATTERN.test(message)) {
        warn(`[app-builder] boot restart failed for ${label}: ${message}`);
      }
    }
  }
  return restarted;
}
