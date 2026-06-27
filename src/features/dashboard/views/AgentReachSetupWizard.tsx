"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Download, ExternalLink, FileJson, FileText, RefreshCcw, Search, ShieldCheck, Trash2, XOctagon } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

type InstallableServiceAction =
  | "install"
  | "start"
  | "stop"
  | "install-pipx"
  | "install-agent-reach-x"
  | "check-agent-reach-x-auth"
  | "agent-reach-doctor"
  | "test-agent-reach-x-profile"
  | "reset-agent-reach-x";

type AgentReachChannelStatus = {
  id: string;
  label: string;
  category: "Search" | "Social" | "Video" | "Developer" | "Web" | "Career" | "Market";
  status: "ok" | "warn" | "off" | "unknown";
  authModel: "Public" | "Browser session" | "CLI auth" | "API key" | "Optional";
  activeBackend?: string | null;
  backends: string[];
  summary: string;
  setup: string[];
  testPrompt: string;
  riskNotes: string[];
  networkDestinations: string[];
  automatedActions?: InstallableServiceAction[];
};

type AgentReachSecurityReceipt = {
  packageName: string;
  packageVersion?: string;
  installSource: string;
  packageHash: string;
  dependencyPolicy: string;
  credentialPolicy: string;
  runtimePolicy: string;
};

type AgentReachSetupState = {
  channels: AgentReachChannelStatus[];
  doctorCheckedAt?: string;
  dataFlow: string[];
  securityReceipt: AgentReachSecurityReceipt;
};

type AgentReachXTestPost = {
  id: string;
  text: string;
  url: string;
  createdAtISO?: string;
  metrics?: Record<string, number>;
  replies?: AgentReachXTestPost[];
};

type AgentReachXProfileTestResult = {
  kind: "agent-reach-x-profile";
  profile: string;
  sourceUrl: string;
  generatedAt: string;
  backend: "twitter-cli";
  posts: AgentReachXTestPost[];
  fetchedReplyThreads: number;
};

type InstallableServiceStatus = {
  id: "n8n" | "browser-use" | "agentic-inbox" | "mcp-email-server" | "openhands" | "aider" | "agent-reach" | "palmier-pro";
  name: string;
  installed: boolean;
  running: boolean;
  version?: string;
  detail: string;
  preflight?: Array<{ key: string; ok: boolean; detail: string }>;
  agentReach?: AgentReachSetupState;
};

type InstallableServiceActionResponse = {
  ok?: boolean;
  error?: string;
  service?: InstallableServiceStatus;
  result?: unknown;
};

type AgentReachSetupWizardProps = {
  service?: InstallableServiceStatus;
  busyAction: string;
  onAction: (action: InstallableServiceAction, input?: { profileUrl?: string; maxPosts?: number; maxReplies?: number }) => Promise<InstallableServiceActionResponse | null>;
  onClose: () => void;
};

const DEFAULT_PROFILE_URL = "https://x.com/0xLiamVisionary";

function preflightOk(service: InstallableServiceStatus | undefined, key: string) {
  return Boolean(service?.preflight?.find((item) => item.key === key)?.ok);
}

function statusTone(status: AgentReachChannelStatus["status"]) {
  if (status === "ok") return "border-[rgba(94,234,212,0.34)] bg-[rgba(20,184,166,0.10)] text-[var(--accent-strong)]";
  if (status === "warn") return "border-[rgba(251,191,36,0.36)] bg-[rgba(251,191,36,0.10)] text-[#fde68a]";
  if (status === "off") return "border-[rgba(248,113,113,0.32)] bg-[rgba(248,113,113,0.10)] text-[#fca5a5]";
  return "border-[rgba(148,163,184,0.20)] bg-[rgba(148,163,184,0.08)] text-[var(--muted)]";
}

function metricLine(metrics: Record<string, number> | undefined) {
  if (!metrics) return "";
  return [
    typeof metrics.likes === "number" ? `${metrics.likes} likes` : "",
    typeof metrics.retweets === "number" ? `${metrics.retweets} reposts` : "",
    typeof metrics.replies === "number" ? `${metrics.replies} replies` : "",
    typeof metrics.views === "number" ? `${metrics.views} views` : "",
  ].filter(Boolean).join(" · ");
}

function markdownForResult(result: AgentReachXProfileTestResult) {
  const lines = [
    `# Agent Reach X Test: @${result.profile}`,
    "",
    `Generated: ${result.generatedAt}`,
    `Backend: ${result.backend}`,
    `Source: ${result.sourceUrl}`,
    "",
  ];
  result.posts.forEach((post, index) => {
    lines.push(`## ${index + 1}. ${post.url}`);
    if (post.createdAtISO) lines.push(`- Created: ${post.createdAtISO}`);
    const metrics = metricLine(post.metrics);
    if (metrics) lines.push(`- Metrics: ${metrics}`);
    lines.push("");
    lines.push(post.text);
    lines.push("");
    if (post.replies?.length) {
      lines.push("Replies:");
      post.replies.forEach((reply) => {
        lines.push(`- ${reply.url}: ${reply.text.replace(/\s+/g, " ").trim()}`);
      });
      lines.push("");
    }
  });
  return lines.join("\n");
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function isAgentReachXTestResult(value: unknown): value is AgentReachXProfileTestResult {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === "agent-reach-x-profile" &&
    Array.isArray((value as { posts?: unknown }).posts),
  );
}

export function AgentReachSetupWizard({ service, busyAction, onAction, onClose }: AgentReachSetupWizardProps) {
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const [authMethod, setAuthMethod] = useState<"browser" | "env">("browser");
  const [profileUrl, setProfileUrl] = useState(DEFAULT_PROFILE_URL);
  const [testResult, setTestResult] = useState<AgentReachXProfileTestResult | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [error, setError] = useState("");
  const channels = useMemo(() => service?.agentReach?.channels ?? [], [service?.agentReach?.channels]);
  const xBackendReady = preflightOk(service, "x-search-backend");
  const xAuthReady = preflightOk(service, "x-auth") || Boolean(channels.find((channel) => channel.id === "twitter" && channel.status === "ok"));
  const busy = busyAction.startsWith("agent-reach:");
  const busyStep = busyAction.split(":")[1] ?? "";

  const groupedChannels = useMemo(() => {
    const groups = new Map<string, AgentReachChannelStatus[]>();
    for (const channel of channels) {
      const group = groups.get(channel.category) ?? [];
      group.push(channel);
      groups.set(channel.category, group);
    }
    return Array.from(groups.entries());
  }, [channels]);

  const run = async (action: InstallableServiceAction, input?: { profileUrl?: string; maxPosts?: number; maxReplies?: number }) => {
    setError("");
    const response = await onAction(action, input);
    if (response?.error) setError(response.error);
    return response;
  };

  const runXTest = async () => {
    const response = await run("test-agent-reach-x-profile", { profileUrl, maxPosts: 10, maxReplies: 25 });
    if (isAgentReachXTestResult(response?.result)) setTestResult(response.result);
  };

  const resetX = async () => {
    setTestResult(null);
    await run("reset-agent-reach-x");
  };

  if (!portalTarget) return null;

  return createPortal((
    <div
      role="presentation"
      onClick={() => { if (!busy) onClose(); }}
      className="fixed inset-0 z-[95] grid place-items-center bg-[rgba(2,6,23,0.80)] p-4 backdrop-blur-md"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-reach-setup-title"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92vh] w-full max-w-[1120px] overflow-y-auto rounded-md border border-[rgba(94,234,212,0.22)] bg-[rgba(10,14,21,0.98)] p-5 text-[var(--foreground)] shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-[var(--accent-strong)]">Agent Reach setup</p>
            <h3 id="agent-reach-setup-title" className="m-0 text-2xl font-black leading-tight">Autonomous research channels</h3>
            <p className="m-0 mt-2 max-w-[760px] text-sm leading-6 text-[var(--muted)]">{service?.detail ?? "Install Agent Reach to enable local research backends for agents."}</p>
          </div>
          <Button type="button" size="icon-sm" variant="secondary" aria-label="Close Agent Reach setup" disabled={busy} onClick={onClose}>
            <XOctagon aria-hidden="true" />
          </Button>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-[rgba(248,113,113,0.32)] bg-[rgba(248,113,113,0.10)] p-3 text-sm text-[#fecaca]">{error}</div>
        ) : null}

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[
            { label: "Core CLI", done: Boolean(service?.installed), detail: service?.version ? `v${service.version}` : "Pinned fork" },
            { label: "X backend", done: xBackendReady, detail: "twitter-cli 0.8.5" },
            { label: "X auth", done: xAuthReady, detail: "Browser session or env keys" },
            { label: "Channel scan", done: Boolean(service?.agentReach?.doctorCheckedAt), detail: service?.agentReach?.doctorCheckedAt ? "Doctor refreshed" : "On demand only" },
          ].map((step, index) => (
            <div key={step.label} className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.30)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] font-black uppercase text-[var(--muted)]">Step {index + 1}</span>
                <span className={["rounded-md border px-2 py-0.5 text-[11px] font-black", step.done ? statusTone("ok") : statusTone("unknown")].join(" ")}>
                  {step.done ? "Ready" : "Needed"}
                </span>
              </div>
              <strong className="mt-2 block text-sm">{step.label}</strong>
              <span className="text-xs text-[var(--muted)]">{step.detail}</span>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_1.05fr]">
          <section className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.24)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Guided setup</p>
                <h4 className="m-0 text-base font-bold">Install, auth, and test</h4>
              </div>
              <Button type="button" size="sm" variant="secondary" disabled={busy || !service?.installed} isLoading={busyStep === "agent-reach-doctor"} onClick={() => void run("agent-reach-doctor")}>
                <RefreshCcw aria-hidden="true" />
                Refresh channels
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busy || Boolean(service?.installed)} isLoading={busyStep === "install"} onClick={() => void run("install")}>
                <Download aria-hidden="true" />
                Install Agent Reach
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={busy || !service?.installed || xBackendReady} isLoading={busyStep === "install-agent-reach-x"} onClick={() => void run("install-agent-reach-x")}>
                <Download aria-hidden="true" />
                Enable X backend
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={busy || !xBackendReady} isLoading={busyStep === "check-agent-reach-x-auth"} onClick={() => void run("check-agent-reach-x-auth")}>
                <ShieldCheck aria-hidden="true" />
                Check X auth
              </Button>
            </div>

            <div className="mt-4 rounded-md border border-[rgba(251,191,36,0.24)] bg-[rgba(251,191,36,0.07)] p-3">
              <div className="font-mono text-[11px] font-black uppercase text-[#fde68a]">X auth method</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={authMethod === "browser" ? "default" : "secondary"} onClick={() => setAuthMethod("browser")}>Browser session</Button>
                <Button type="button" size="sm" variant={authMethod === "env" ? "default" : "secondary"} onClick={() => setAuthMethod("env")}>Env keys</Button>
              </div>
              {authMethod === "browser" ? (
                <p className="m-0 mt-3 text-xs leading-5 text-[var(--muted)]">
                  macOS may ask whether `security` can use confidential information from Chrome Safe Storage. `Allow` is enough for a one-time check; `Always Allow` makes future browser-cookie checks quieter.
                </p>
              ) : (
                <p className="m-0 mt-3 text-xs leading-5 text-[var(--muted)]">
                  Set `TWITTER_AUTH_TOKEN` and `TWITTER_CT0` in the shared env, then run the auth check. The setup flow checks presence by key name and never prints secret values.
                </p>
              )}
            </div>

            <div className="mt-4 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.07)] p-3">
              <label htmlFor="agent-reach-x-profile" className="font-mono text-[11px] font-black uppercase text-[var(--accent-strong)]">Test account URL</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="agent-reach-x-profile"
                  value={profileUrl}
                  onChange={(event) => setProfileUrl(event.target.value)}
                  className="min-h-10 flex-1 rounded-md border border-[rgba(148,163,184,0.22)] bg-[rgba(2,6,23,0.72)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.56)]"
                  placeholder="https://x.com/username"
                />
                <Button type="button" size="sm" disabled={busy || !xBackendReady} isLoading={busyStep === "test-agent-reach-x-profile"} onClick={() => void runXTest()}>
                  <Search aria-hidden="true" />
                  Fetch latest posts
                </Button>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-[rgba(248,113,113,0.22)] bg-[rgba(248,113,113,0.07)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-[11px] font-black uppercase text-[#fca5a5]">Reset / revoke</div>
                  <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">Automated reset removes the managed X backend. Browser cookies and Keychain decisions stay under Chrome and macOS.</p>
                </div>
                <Button type="button" size="sm" variant="secondary" disabled={busy || !xBackendReady} isLoading={busyStep === "reset-agent-reach-x"} onClick={() => void resetX()}>
                  <Trash2 aria-hidden="true" />
                  Reset X setup
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.24)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Channels</p>
                <h4 className="m-0 text-base font-bold">What Agent Reach can use</h4>
              </div>
              {service?.agentReach?.doctorCheckedAt ? <span className="text-xs text-[var(--muted)]">Checked {new Date(service.agentReach.doctorCheckedAt).toLocaleString()}</span> : null}
            </div>
            <div className="mt-3 grid gap-3">
              {groupedChannels.map(([category, categoryChannels]) => (
                <div key={category}>
                  <div className="mb-2 font-mono text-[11px] font-black uppercase text-[var(--muted)]">{category}</div>
                  <div className="grid gap-2">
                    {categoryChannels.map((channel) => (
                      <details key={channel.id} className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.42)] p-3">
                        <summary className="cursor-pointer list-none">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <strong className="text-sm">{channel.label}</strong>
                            <span className={["rounded-md border px-2 py-0.5 text-[11px] font-black uppercase", statusTone(channel.status)].join(" ")}>{channel.status}</span>
                          </div>
                          <div className="mt-1 text-xs leading-5 text-[var(--muted)]">{channel.summary}</div>
                        </summary>
                        <div className="mt-3 grid gap-2 text-xs leading-5 text-[var(--muted)]">
                          <span>Auth: {channel.authModel}</span>
                          <span>Active backend: {channel.activeBackend || "none yet"}</span>
                          <span>Backends: {channel.backends.join(", ")}</span>
                          <span>Test: {channel.testPrompt}</span>
                          <span>Network: {channel.networkDestinations.join(", ")}</span>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <section className="rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="h-4 w-4 text-[var(--accent-strong)]" />
              <h4 className="m-0 text-base font-bold">Security receipt</h4>
            </div>
            {service?.agentReach?.securityReceipt ? (
              <div className="mt-3 grid gap-2 text-xs leading-5 text-[var(--muted)]">
                <span>Package: {service.agentReach.securityReceipt.packageName}{service.agentReach.securityReceipt.packageVersion ? ` v${service.agentReach.securityReceipt.packageVersion}` : ""}</span>
                <span>Hash: {service.agentReach.securityReceipt.packageHash}</span>
                <span>Source: {service.agentReach.securityReceipt.installSource}</span>
                <span>{service.agentReach.securityReceipt.dependencyPolicy}</span>
                <span>{service.agentReach.securityReceipt.credentialPolicy}</span>
                <span>{service.agentReach.securityReceipt.runtimePolicy}</span>
              </div>
            ) : null}
            <div className="mt-3 grid gap-1 text-xs leading-5 text-[var(--muted)]">
              {service?.agentReach?.dataFlow.map((item) => <span key={item}>{item}</span>)}
            </div>
          </section>

          <section className="rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.24)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Agent ready</p>
                <h4 className="m-0 text-base font-bold">{xAuthReady ? "Agent Reach can use X" : "Finish auth to unlock X"}</h4>
              </div>
              {xAuthReady ? <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-[var(--accent-strong)]" /> : null}
            </div>
            <p className="m-0 mt-2 text-xs leading-5 text-[var(--muted)]">
              When a channel is ready, agents can call Agent Reach by natural language: fetch latest posts for an X account URL, read an RSS feed, inspect a V2EX topic, summarize a YouTube transcript, or search GitHub.
            </p>
            {testResult ? (
              <div className="mt-3 rounded-md border border-[rgba(94,234,212,0.22)] bg-[rgba(20,184,166,0.08)] p-3 text-xs leading-5 text-[var(--muted)]">
                Last X test fetched {testResult.posts.length} posts for @{testResult.profile} and read {testResult.fetchedReplyThreads} reply threads.
              </div>
            ) : null}
          </section>
        </div>

        {testResult ? (
          <section className="mt-5 rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.24)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Results viewer</p>
                <h4 className="m-0 text-base font-bold">Latest posts for @{testResult.profile}</h4>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => downloadText(`agent-reach-x-${testResult.profile}.json`, JSON.stringify(testResult, null, 2), "application/json")}>
                  <FileJson aria-hidden="true" />
                  Export JSON
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => downloadText(`agent-reach-x-${testResult.profile}.md`, markdownForResult(testResult), "text/markdown")}>
                  <FileText aria-hidden="true" />
                  Export Markdown
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setRawOpen((current) => !current)}>
                  <FileJson aria-hidden="true" />
                  Raw JSON
                </Button>
              </div>
            </div>
            <div className="mt-3 grid gap-3">
              {testResult.posts.map((post, index) => (
                <article key={post.id} className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.44)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm">Post {index + 1}</strong>
                    <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[var(--accent-strong)]">
                      <ExternalLink aria-hidden="true" className="h-3 w-3" />
                      {post.id}
                    </a>
                  </div>
                  <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6">{post.text}</p>
                  <div className="mt-2 text-xs text-[var(--muted)]">{[post.createdAtISO, metricLine(post.metrics)].filter(Boolean).join(" · ")}</div>
                  {post.replies?.length ? (
                    <div className="mt-3 grid gap-2 border-t border-[rgba(148,163,184,0.14)] pt-3">
                      {post.replies.map((reply) => (
                        <div key={reply.id} className="rounded-md bg-[rgba(2,6,23,0.42)] p-2">
                          <a href={reply.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-[var(--accent-strong)]">{reply.id}</a>
                          <p className="m-0 mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">{reply.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            {rawOpen ? (
              <pre className="mt-3 max-h-[340px] overflow-auto rounded-md border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.72)] p-3 text-xs leading-5 text-[var(--muted)]">{JSON.stringify(testResult, null, 2)}</pre>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  ), portalTarget);
}
