import DashboardUnlockRecovery from "@/app/DashboardUnlockRecovery";
import DashboardNativeFrame from "@/app/DashboardNativeFrame";
import type { DashboardVaultPanelMode } from "@/features/dashboard/DashboardApp";
import { isDashboardView } from "@/features/dashboard/dashboard-navigation";
import { listDynamicWorkHistory } from "@/lib/services/work-history/dynamic-changelog";
import {
  DASHBOARD_SESSION_COOKIE,
  dashboardAuthConfigured,
  dashboardAuthStatus,
  dashboardDeviceTokenConfigured,
  verifyDashboardSessionCookie,
} from "@/lib/utils/server-auth";
import { cookies } from "next/headers";

const DASHBOARD_VAULT_PANEL_MODES = new Set<DashboardVaultPanelMode>([
  "hive-vault",
  "shared-skills",
  "brain-services",
  "env",
  "config",
]);

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value ?? "";
  const hasSession = await verifyDashboardSessionCookie(sessionCookie);
  if (!hasSession) return <DashboardUnlock params={params} />;

  const rawView = Array.isArray(params?.view) ? params?.view[0] : params?.view;
  const initialView = rawView && isDashboardView(rawView)
    ? rawView
    : undefined;
  const rawAgent = Array.isArray(params?.agent) ? params?.agent[0] : params?.agent;
  const rawChatLeaf = Array.isArray(params?.chatLeaf) ? params?.chatLeaf[0] : params?.chatLeaf;
  const initialChatAgentId = initialView === "chat" && rawAgent ? rawAgent : undefined;
  const initialChatLeaf = initialView === "chat" && rawChatLeaf ? rawChatLeaf : undefined;
  const rawVaultPanel = Array.isArray(params?.vaultPanel) ? params?.vaultPanel[0] : params?.vaultPanel;
  const initialVaultPanelMode = rawVaultPanel && DASHBOARD_VAULT_PANEL_MODES.has(rawVaultPanel as DashboardVaultPanelMode)
    ? rawVaultPanel as DashboardVaultPanelMode
    : undefined;
  const initialWorkHistory = initialView === "history"
    ? await listDynamicWorkHistory({ limit: 10 }).catch(() => undefined)
    : undefined;

  return (
    <DashboardNativeFrame
      initialChatAgentId={initialChatAgentId}
      initialChatLeaf={initialChatLeaf}
      initialView={initialView}
      initialVaultPanelMode={initialVaultPanelMode}
      initialWorkHistory={initialWorkHistory}
    />
  );
}

function DashboardUnlock({ params }: { params?: Record<string, string | string[] | undefined> }) {
  const status = dashboardAuthStatus();
  const returnTo = returnPath(params);
  const authFailed = Array.isArray(params?.auth) ? params?.auth[0] === "failed" : params?.auth === "failed";

  return (
    <main style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      padding: 24,
      background:
        "radial-gradient(circle at 22% 18%, rgba(176, 127, 28, 0.14), transparent 25rem), radial-gradient(circle at 78% 78%, rgba(95, 143, 90, 0.14), transparent 28rem), linear-gradient(180deg, var(--bg-0, #f1ede3), var(--bg-1, #f6f2e9))",
      color: "var(--foreground, #221d14)",
      fontFamily: "Geist, system-ui, sans-serif",
    }}>
      <section style={{
        width: "min(100%, 420px)",
        border: "1px solid var(--line, rgba(54, 46, 30, 0.16))",
        borderRadius: 10,
        background: "var(--surface, rgba(251, 248, 241, 0.9))",
        padding: 22,
        boxShadow: "0 22px 56px rgba(82, 61, 22, 0.14)",
      }}>
        <p style={{ margin: "0 0 8px", color: "var(--accent-strong, #936811)", fontSize: 13, fontWeight: 800, textTransform: "uppercase" }}>
          HivemindOS
        </p>
        <h1 style={{ margin: "0 0 12px", fontSize: 30, lineHeight: 1.1 }}>Dashboard locked</h1>
        <p style={{ margin: "0 0 22px", color: "var(--text-soft, #5e574b)", lineHeight: 1.6 }}>
          Enter this device's dashboard token to open a signed local session.
        </p>
        {!status.ok ? (
          <p style={{ margin: 0, padding: 14, border: "1px solid rgba(192, 82, 77, 0.38)", background: "rgba(192, 82, 77, 0.1)", color: "#8e3328", borderRadius: 8 }}>
            {status.reason}
          </p>
        ) : (
          <form action="/api/auth/session" method="post" style={{ display: "grid", gap: 12 }}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <label style={{ display: "grid", gap: 8, color: "var(--foreground, #221d14)", fontSize: 13, fontWeight: 800 }}>
              Device token
              <input
                autoFocus
                name="token"
                type="password"
                autoComplete="current-password"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "1px solid var(--button-input, rgba(54, 46, 30, 0.18))",
                  borderRadius: 8,
                  background: "var(--field, rgba(255, 252, 246, 0.92))",
                  color: "var(--foreground, #221d14)",
                  padding: "12px 14px",
                  fontSize: 16,
                }}
              />
            </label>
            {authFailed ? <p style={{ margin: 0, color: "#8e3328", fontWeight: 700 }}>That dashboard token was not accepted.</p> : null}
            <button
              type="submit"
              style={{
                border: 0,
                borderRadius: 8,
                background: "var(--button-primary, #936811)",
                color: "var(--button-primary-foreground, #fff7df)",
                padding: "12px 14px",
                fontSize: 15,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Unlock dashboard
            </button>
          </form>
        )}
        <DashboardUnlockRecovery
          authSecretPresent={dashboardAuthConfigured()}
          deviceTokenPresent={dashboardDeviceTokenConfigured()}
          nativeMode={process.env.HIVEMINDOS_NATIVE === "1"}
        />
      </section>
    </main>
  );
}

function returnPath(params?: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (key === "auth" || key === "returnTo") continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry) query.append(key, entry);
      });
    } else if (value) {
      query.set(key, value);
    }
  }
  const search = query.toString();
  return search ? `/?${search}` : "/";
}
