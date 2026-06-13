// Reports anonymized client health issues (e.g. a desktop install stuck on a
// loading screen because it can't reach its local dashboard service) to the
// hivemindos-issues Cloudflare Worker, so broken boots are visible centrally
// without asking a lay user to open devtools.
//
// Always-on and anonymized: it sends only app/runtime health fields — never user
// content, file paths, secrets, or Tailnet IPs. See workers/issues for the sink.

const ISSUES_ENDPOINT = (process.env.NEXT_PUBLIC_HIVEMINDOS_ISSUES_URL?.trim()
  || "https://hivemindos-issues.hivemindos.workers.dev").replace(/\/$/, "");

const INSTALL_ID_KEY = "hivemindos.installId.v1";

export type IssueReport = {
  kind: string;
  detail?: string;
  failureKind?: string;
  status?: number | null;
  attempt?: number;
  severity?: "info" | "warning" | "error" | "critical";
  appVersion?: string;
  commit?: string;
  context?: Record<string, unknown>;
};

// One report per kind per session — enough to surface the problem without a
// stuck install hammering the endpoint (the worker also caps per install/day).
const reportedKinds = new Set<string>();

function randomHex(bytes: number): string {
  const data = new Uint8Array(bytes);
  (globalThis.crypto ?? ({} as Crypto)).getRandomValues?.(data);
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// A stable, anonymous per-install id. Random — never derived from identity.
function installId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.localStorage.getItem(INSTALL_ID_KEY);
    if (existing) return existing;
    const fresh = randomHex(16);
    window.localStorage.setItem(INSTALL_ID_KEY, fresh);
    return fresh;
  } catch {
    return "anonymous";
  }
}

function coarsePlatform(): string {
  if (typeof navigator === "undefined") return "";
  // Coarse UA hint only (OS family), capped — no fingerprinting intent.
  return (navigator.userAgent ?? "").slice(0, 180);
}

export function reportIssue(report: IssueReport): void {
  if (typeof window === "undefined") return;
  if (reportedKinds.has(report.kind)) return;
  reportedKinds.add(report.kind);

  const payload = {
    kind: report.kind,
    severity: report.severity ?? "error",
    installId: installId(),
    appVersion: report.appVersion ?? "",
    commit: report.commit ?? "",
    platform: coarsePlatform(),
    detail: report.detail ?? "",
    failureKind: report.failureKind ?? "",
    status: report.status ?? null,
    attempt: report.attempt ?? null,
    context: report.context ?? null,
  };

  // Fire-and-forget. Health reporting must never block or break the app.
  try {
    void fetch(`${ISSUES_ENDPOINT}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

// Lets a recovery (e.g. the app finally hydrating) re-arm reporting for a kind.
export function clearReportedIssue(kind: string): void {
  reportedKinds.delete(kind);
}
