import type { AppVersion } from "@/features/dashboard/dashboard-types";

function hasCommit(version: AppVersion | null | undefined): version is AppVersion & { commit: string } {
  return Boolean(version?.commit?.trim());
}

export function isPackagedReleaseAppVersion(
  version: AppVersion | null | undefined,
): version is AppVersion & { commit: string } {
  return hasCommit(version)
    && version.packaged === true
    && version.sourceBuild !== true
    && version.releaseChannel !== "source";
}

/**
 * Packaged releases must report the version embedded in the signed artifact.
 * Source and dev builds instead prefer the Git/release-aware server payload,
 * because their compile-time Cargo version can be an older release floor.
 */
export function selectDashboardAppVersion(
  nativeVersion: AppVersion | null | undefined,
  sourceVersion: AppVersion | null | undefined,
): AppVersion | null {
  if (isPackagedReleaseAppVersion(nativeVersion)) return nativeVersion;
  if (hasCommit(sourceVersion)) return sourceVersion;
  return hasCommit(nativeVersion) ? nativeVersion : null;
}
