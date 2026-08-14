const BUILT_IN_DASHBOARD_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function dashboardPermissionOrigin(rawUrl) {
  const parsed = new URL(String(rawUrl || "").trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Dashboard URL must use http:// or https://.");
  }
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

export function hasBuiltInDashboardPermission(rawUrl) {
  const parsed = new URL(String(rawUrl || "").trim());
  return parsed.protocol === "http:" && BUILT_IN_DASHBOARD_HOSTS.has(parsed.hostname);
}
