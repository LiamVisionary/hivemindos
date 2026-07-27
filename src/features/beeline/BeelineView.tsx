"use client";

import * as React from "react";
import {
  AppWindow,
  CalendarDays,
  ChevronRight,
  ExternalLink,
  HeartHandshake,
  LoaderCircle,
  MessageSquare,
  Plane,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { Button } from "@/design-system/ui/button";
import { deleteNativeBeelineProfileCredentials } from "@/lib/native/beeline-credentials";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";
import {
  BEELINE_CAPABILITIES,
  BEELINE_RELATIONSHIPS,
  type BeelineBrokerConnection,
  type BeelineBrowserBinding,
  type BeelineCapability,
  type BeelineLocalCredential,
  type BeelinePasswordManager,
  type BeelineProfile,
  type BeelineRelationship,
} from "@/lib/types/beeline";
import { BeelineConnectionsPanel } from "./BeelineConnectionsPanel";
import { BeelineLocalCredentialsPanel } from "./BeelineLocalCredentialsPanel";
import styles from "./beeline.module.css";

type ChromeProfile = { directory: string; name: string };
type ApiError = { ok?: false; error?: string };
type CapabilityState = "off" | "gated" | "ready" | "live";
type ActivityTone = "live" | "ready" | "muted";
type ActivityEntry = {
  id: string;
  at: string;
  who: string;
  action: string;
  tone: ActivityTone;
};

const CAPABILITY_LABELS: Record<BeelineCapability, string> = {
  browser: "Browser",
  calendar: "Calendar",
  healthcare: "Healthcare",
  messaging: "Messaging",
  shopping: "Shopping",
  travel: "Travel",
};

const CAPABILITY_ICONS: Record<BeelineCapability, React.ReactNode> = {
  browser: <AppWindow />,
  calendar: <CalendarDays />,
  healthcare: <Stethoscope />,
  messaging: <MessageSquare />,
  shopping: <ShoppingBag />,
  travel: <Plane />,
};

const RELATIONSHIP_LABELS: Record<BeelineRelationship, string> = {
  parent: "Parent",
  child: "Child",
  partner: "Partner",
  sibling: "Sibling",
  grandparent: "Grandparent",
  relative: "Relative",
  friend: "Friend",
  other: "Other",
};

const PASSWORD_MANAGER_LABELS: Record<BeelinePasswordManager, string> = {
  none: "None yet",
  chrome: "Saved in this Chrome profile",
  keepassxc: "KeePassXC",
  bitwarden: "Bitwarden",
  other: "Another password manager",
};

const EMPTY_CONNECTIONS: BeelineBrokerConnection[] = [];
const EMPTY_CREDENTIALS: BeelineLocalCredential[] = [];

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({})) as T | ApiError;
  if (!response.ok || ("ok" in (payload as object) && (payload as { ok?: boolean }).ok === false)) {
    throw new Error((payload as ApiError).error || `Beeline request failed (${response.status}).`);
  }
  return payload as T;
}

function aliasesFromDraft(value: string) {
  return [...new Set(value.split(",").map((alias) => alias.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean))];
}

function profileInitials(profile: BeelineProfile) {
  return profile.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function SetupStep({
  number,
  eyebrow,
  title,
  subtitle,
  open,
  onToggle,
  complete,
  completeLabel,
  todoLabel,
  children,
}: {
  number: number;
  eyebrow: string;
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  complete: boolean;
  completeLabel: string;
  todoLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.setupStep}>
      <button type="button" className={styles.stepTrigger} onClick={onToggle} aria-expanded={open}>
        <span className={styles.stepNumber}>{number}</span>
        <span className={styles.stepCopy}>
          <span>{eyebrow}</span>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <span className={complete ? styles.completeBadge : styles.todoBadge}>
          {complete ? <ShieldCheck aria-hidden="true" /> : null}
          {complete ? completeLabel : todoLabel}
        </span>
        <ChevronRight className={open ? styles.chevronOpen : styles.chevron} aria-hidden="true" />
      </button>
      <div className={styles.stepBody} hidden={!open}>{children}</div>
    </section>
  );
}

function buildActivity(
  profile: BeelineProfile,
  connections: BeelineBrokerConnection[],
  credentials: BeelineLocalCredential[],
  sessionActivity: ActivityEntry[],
) {
  const activity: ActivityEntry[] = [
    {
      id: `profile-${profile.id}`,
      at: profile.createdAt,
      who: "You",
      action: `created ${profile.displayName}'s family card`,
      tone: "muted",
    },
  ];
  if (profile.consent.confirmedAt) {
    activity.push({
      id: `consent-confirmed-${profile.id}`,
      at: profile.consent.confirmedAt,
      who: "You",
      action: `confirmed permission for ${profile.displayName}`,
      tone: "live",
    });
  }
  if (profile.consent.revokedAt && profile.consent.status === "revoked") {
    activity.push({
      id: `consent-revoked-${profile.id}`,
      at: profile.consent.revokedAt,
      who: "You",
      action: `turned off permission for ${profile.displayName}`,
      tone: "ready",
    });
  }
  if (profile.browserBinding) {
    activity.push({
      id: `browser-${profile.id}-${profile.browserBinding.profileDirectory}`,
      at: profile.updatedAt,
      who: "You",
      action: `set ${profile.browserBinding.profileName} as ${profile.displayName}'s browser`,
      tone: "ready",
    });
  }
  for (const connection of connections) {
    activity.push({
      id: `connection-${connection.id}`,
      at: connection.createdAt,
      who: "You",
      action: `connected ${connection.label} for ${profile.displayName}`,
      tone: "live",
    });
  }
  for (const credential of credentials) {
    activity.push({
      id: `credential-${credential.id}`,
      at: credential.createdAt,
      who: "You",
      action: `saved ${credential.label} on this device`,
      tone: credential.agentUseMode === "restricted" ? "ready" : "live",
    });
  }
  return [...sessionActivity, ...activity]
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index)
    .slice(0, 6);
}

export function BeelineView({ agentName = "your agent" }: { agentName?: string }) {
  const agent = agentName.trim() || "your agent";
  const [profiles, setProfiles] = React.useState<BeelineProfile[]>([]);
  const [chromeProfiles, setChromeProfiles] = React.useState<ChromeProfile[]>([]);
  const [selectedId, setSelectedId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [showCreate, setShowCreate] = React.useState(false);
  const [openStep, setOpenStep] = React.useState<number | null>(null);
  const [displayName, setDisplayName] = React.useState("");
  const [relationship, setRelationship] = React.useState<BeelineRelationship>("parent");
  const [aliases, setAliases] = React.useState("");
  const [capabilities, setCapabilities] = React.useState<BeelineCapability[]>(["browser", "calendar"]);
  const [browserDirectory, setBrowserDirectory] = React.useState("");
  const [passwordManager, setPasswordManager] = React.useState<BeelinePasswordManager>("none");
  const [automationMode, setAutomationMode] = React.useState<BeelineBrowserBinding["automationMode"]>("manual-first");
  const [connectionsByProfile, setConnectionsByProfile] = React.useState<Record<string, BeelineBrokerConnection[]>>({});
  const [credentialsByProfile, setCredentialsByProfile] = React.useState<Record<string, BeelineLocalCredential[]>>({});
  const [activityByProfile, setActivityByProfile] = React.useState<Record<string, ActivityEntry[]>>({});

  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;
  const selectedConnections = React.useMemo(
    () => selected ? connectionsByProfile[selected.id] ?? EMPTY_CONNECTIONS : EMPTY_CONNECTIONS,
    [connectionsByProfile, selected],
  );
  const selectedCredentials = React.useMemo(
    () => selected ? credentialsByProfile[selected.id] ?? EMPTY_CREDENTIALS : EMPTY_CREDENTIALS,
    [credentialsByProfile, selected],
  );

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiJson<{ ok: true; profiles: BeelineProfile[] }>("/api/beeline/profiles"),
      apiJson<{ ok: true; profiles: ChromeProfile[] }>("/api/beeline/chrome-profiles"),
    ]).then(([profilePayload, chromePayload]) => {
      if (cancelled) return;
      const params = new URL(window.location.href).searchParams;
      const firstProfile = profilePayload.profiles.find((profile) => profile.id === params.get("beelineProfile"))
        || profilePayload.profiles[0];
      setProfiles(profilePayload.profiles);
      setChromeProfiles(chromePayload.profiles);
      setSelectedId(firstProfile?.id ?? "");
      setBrowserDirectory(firstProfile?.browserBinding?.profileDirectory ?? chromePayload.profiles[0]?.directory ?? "");
      setPasswordManager(firstProfile?.browserBinding?.passwordManager ?? "none");
      setAutomationMode(firstProfile?.browserBinding?.automationMode ?? "manual-first");
      if (params.get("beeline_status") === "connected") setMessage("The family Google account was connected to Beeline.");
      if (params.get("beeline_status") === "error") setError(params.get("error") || "Google authorization did not complete.");
      setLoading(false);
    }).catch((caught: unknown) => {
      if (cancelled) return;
      setError(caught instanceof Error ? caught.message : "Could not load Beeline.");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const selectProfile = React.useCallback((profile: BeelineProfile) => {
    setSelectedId(profile.id);
    setBrowserDirectory(profile.browserBinding?.profileDirectory ?? chromeProfiles[0]?.directory ?? "");
    setPasswordManager(profile.browserBinding?.passwordManager ?? "none");
    setAutomationMode(profile.browserBinding?.automationMode ?? "manual-first");
    setOpenStep(null);
    setError("");
    setMessage("");
  }, [chromeProfiles]);

  const replaceProfile = React.useCallback((profile: BeelineProfile) => {
    setProfiles((current) => current.map((candidate) => candidate.id === profile.id ? profile : candidate));
  }, []);

  const addActivity = React.useCallback((profileId: string, action: string, tone: ActivityTone = "ready") => {
    const entry: ActivityEntry = {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
      who: "You",
      action,
      tone,
    };
    setActivityByProfile((current) => ({
      ...current,
      [profileId]: [entry, ...(current[profileId] ?? [])].slice(0, 6),
    }));
  }, []);

  const handleConnectionsChange = React.useCallback((profileId: string, connections: BeelineBrokerConnection[]) => {
    setConnectionsByProfile((current) => ({ ...current, [profileId]: connections }));
  }, []);

  const handleCredentialsChange = React.useCallback((profileId: string, credentials: BeelineLocalCredential[]) => {
    setCredentialsByProfile((current) => ({ ...current, [profileId]: credentials }));
  }, []);

  const patchProfile = React.useCallback(async (profileId: string, input: Record<string, unknown>, action: string) => {
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const payload = await apiJson<{ ok: true; profile: BeelineProfile }>(`/api/beeline/profiles/${encodeURIComponent(profileId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      replaceProfile(payload.profile);
      return payload.profile;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this family member.");
      return null;
    } finally {
      setBusy("");
    }
  }, [replaceProfile]);

  const createProfile = React.useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("create");
    setError("");
    setMessage("");
    try {
      const payload = await apiJson<{ ok: true; profile: BeelineProfile }>("/api/beeline/profiles", {
        method: "POST",
        body: JSON.stringify({ displayName, relationship, aliases: aliasesFromDraft(aliases), capabilities }),
      });
      setProfiles((current) => [...current, payload.profile]);
      setSelectedId(payload.profile.id);
      setBrowserDirectory(chromeProfiles[0]?.directory ?? "");
      setPasswordManager("none");
      setAutomationMode("manual-first");
      setDisplayName("");
      setAliases("");
      setCapabilities(["browser", "calendar"]);
      setShowCreate(false);
      setOpenStep(1);
      setMessage(`${payload.profile.displayName} was added. Give permission before an agent can act for them.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the family card.");
    } finally {
      setBusy("");
    }
  }, [aliases, capabilities, chromeProfiles, displayName, relationship]);

  const toggleConsent = React.useCallback(async () => {
    if (!selected) return;
    const nextStatus = selected.consent.status === "confirmed" ? "revoked" : "confirmed";
    const updated = await patchProfile(selected.id, { consentStatus: nextStatus }, "consent");
    if (!updated) return;
    const enabled = nextStatus === "confirmed";
    setMessage(enabled ? `Permission is confirmed for ${selected.displayName}.` : `Permission is turned off for ${selected.displayName}.`);
    addActivity(selected.id, enabled ? `confirmed permission for ${selected.displayName}` : `turned off permission for ${selected.displayName}`, enabled ? "live" : "ready");
  }, [addActivity, patchProfile, selected]);

  const saveBrowserBinding = React.useCallback(async () => {
    if (!selected || !browserDirectory) return;
    const chromeProfile = chromeProfiles.find((profile) => profile.directory === browserDirectory);
    if (!chromeProfile) {
      setError("Choose a Chrome profile that is available on this device.");
      return;
    }
    const updated = await patchProfile(selected.id, {
      capabilities: [...new Set([...selected.capabilities, "browser"])],
      browserBinding: {
        browserId: "chrome",
        profileDirectory: chromeProfile.directory,
        profileName: chromeProfile.name,
        passwordManager,
        automationMode,
      },
    }, "browser-save");
    if (!updated) return;
    setMessage(`${chromeProfile.name} is now ${selected.displayName}'s browser.`);
    addActivity(selected.id, `set ${chromeProfile.name} as ${selected.displayName}'s browser`);
  }, [addActivity, automationMode, browserDirectory, chromeProfiles, passwordManager, patchProfile, selected]);

  const openBrowser = React.useCallback(async () => {
    if (!selected) return;
    const approved = await confirmUserAction(
      `Open ${selected.displayName}'s authenticated Chrome profile? This can expose private account state. It does not approve bookings, messages, purchases, or healthcare actions.`,
    );
    if (!approved) return;
    setBusy("browser-open");
    setError("");
    setMessage("");
    try {
      await apiJson("/api/beeline/actions", {
        method: "POST",
        body: JSON.stringify({ profileId: selected.id, confirmation: "CONFIRM_BEELINE_BROWSER" }),
      });
      setMessage(`${selected.displayName}'s Chrome profile was opened.`);
      addActivity(selected.id, `opened ${selected.displayName}'s browser`, "live");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the Chrome profile.");
    } finally {
      setBusy("");
    }
  }, [addActivity, selected]);

  const deleteProfile = React.useCallback(async () => {
    if (!selected || !(await confirmUserAction(`Remove ${selected.displayName} from Beeline? This deletes their local credentials, revokes hosted connections, and removes the card and browser binding.`))) return;
    setBusy("delete");
    setError("");
    try {
      if (isTauriDesktopRuntime()) await deleteNativeBeelineProfileCredentials(selected.id);
      await apiJson(`/api/beeline/profiles/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      const remaining = profiles.filter((profile) => profile.id !== selected.id);
      setProfiles(remaining);
      setSelectedId(remaining[0]?.id ?? "");
      setMessage(`${selected.displayName} was removed from Beeline.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the family member.");
    } finally {
      setBusy("");
    }
  }, [profiles, selected]);

  const capabilityTiles = React.useMemo(() => {
    if (!selected) return [];
    return BEELINE_CAPABILITIES.map((capability) => {
      const allowed = selected.capabilities.includes(capability);
      const connected = selectedConnections.some((connection) => connection.capability === capability);
      let state: CapabilityState = "gated";
      let note = "Not set up yet";
      if (!allowed) {
        state = "off";
        note = "Off";
      } else if (selected.consent.status !== "confirmed") {
        state = "gated";
        note = "Waiting for your OK";
      } else if (connected) {
        state = "live";
        note = "Connected";
      } else if (capability === "browser" && selected.browserBinding) {
        state = "ready";
        note = "Set up";
      }
      return { capability, state, note };
    });
  }, [selected, selectedConnections]);

  const readyCount = capabilityTiles.filter((tile) => tile.state === "live" || tile.state === "ready").length;
  const pendingTiles = capabilityTiles.filter((tile) => selected?.capabilities.includes(tile.capability) && tile.state === "gated");
  const accountCount = selectedConnections.length + selectedCredentials.length;
  const setupComplete = selected ? [selected.consent.status === "confirmed", Boolean(selected.browserBinding), accountCount > 0].filter(Boolean).length : 0;
  const activity = selected ? buildActivity(selected, selectedConnections, selectedCredentials, activityByProfile[selected.id] ?? []) : [];
  const summaryLine = selected?.consent.status === "confirmed"
    ? `${agent} can help ${selected.displayName} with ${readyCount} of ${selected.capabilities.length} ${selected.capabilities.length === 1 ? "thing" : "things"} you've allowed.`
    : selected ? `Give your permission before ${agent} can help ${selected.displayName}.` : "";

  return (
    <div className={styles.page} data-testid="beeline-route">
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}><HeartHandshake /> Beeline</span>
          <h1>The people you look after</h1>
          <p>Set up the people you help. Each one gets their own accounts and browser, kept separate from yours. You choose what {agent} can do for them, and consequential actions still ask first.</p>
        </div>
        <Button className={styles.primaryButton} onClick={() => setShowCreate((current) => !current)} aria-expanded={showCreate}>
          <Plus /> Add family member
        </Button>
      </header>

      {showCreate ? (
        <form className={styles.createForm} onSubmit={createProfile}>
          <div className={styles.sectionHeading}>
            <div><span>New family card</span><h2>Who are you helping?</h2></div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
          <div className={styles.formGrid}>
            <label><span>Name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Maria" required /></label>
            <label><span>Relationship</span><select value={relationship} onChange={(event) => setRelationship(event.target.value as BeelineRelationship)}>{BEELINE_RELATIONSHIPS.map((item) => <option key={item} value={item}>{RELATIONSHIP_LABELS[item]}</option>)}</select></label>
            <label className={styles.wide}><span>Aliases {agent} can recognize</span><input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="mom, mama" /><small>Separate aliases with commas.</small></label>
          </div>
          <fieldset className={styles.capabilities}>
            <legend>Allowed capability areas</legend>
            {BEELINE_CAPABILITIES.map((capability) => (
              <label key={capability} className={capabilities.includes(capability) ? styles.capabilityChoiceActive : styles.capabilityChoice}>
                <input type="checkbox" checked={capabilities.includes(capability)} onChange={(event) => setCapabilities((current) => event.target.checked ? [...current, capability] : current.filter((item) => item !== capability))} />
                <span>{CAPABILITY_LABELS[capability]}</span>
              </label>
            ))}
          </fieldset>
          <Button className={styles.primaryButton} type="submit" isLoading={busy === "create"}>Create family card</Button>
        </form>
      ) : null}

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {message ? <div className={styles.success} role="status">{message}</div> : null}

      {loading ? (
        <div className={styles.loading} role="status">
          <div><LoaderCircle aria-hidden="true" /><span>Loading Beeline</span></div>
          <div className={styles.loadingTiles} aria-hidden="true">{BEELINE_CAPABILITIES.map((capability) => <span key={capability} />)}</div>
        </div>
      ) : profiles.length === 0 ? (
        <section className={styles.empty}>
          <span className={styles.emptyIcon}><HeartHandshake /></span>
          <h2>No family cards yet</h2>
          <p>Add someone, choose what you are allowed to help with, then connect only their own browser and accounts.</p>
          <Button className={styles.primaryButton} onClick={() => setShowCreate(true)}><Plus /> Add your first person</Button>
        </section>
      ) : (
        <div className={styles.workspace}>
          <aside className={styles.profileRail} aria-label="Family members">
            {profiles.map((profile) => {
              const active = profile.id === selectedId;
              const confirmed = profile.consent.status === "confirmed";
              return (
                <button key={profile.id} type="button" className={styles.profileCard} onClick={() => selectProfile(profile)} aria-current={active ? "true" : undefined}>
                  <span className={`${styles.hexAvatar} ${active ? styles.hexAvatarActive : ""}`}>
                    <span>{profileInitials(profile)}</span>
                    <i className={confirmed ? styles.confirmedDot : styles.pendingDot} aria-hidden="true" />
                  </span>
                  <span className={styles.profileCardCopy}>
                    <strong>{profile.displayName}</strong>
                    <span>{RELATIONSHIP_LABELS[profile.relationship]}</span>
                  </span>
                </button>
              );
            })}
            <button type="button" className={styles.profileCard} onClick={() => setShowCreate(true)}>
              <span className={`${styles.hexAvatar} ${styles.addHex}`}><Plus /></span>
              <span className={styles.addLabel}>Add</span>
            </button>
          </aside>

          {selected ? (
            <main className={styles.detail}>
              <section className={styles.personHeader}>
                <div>
                  <div className={styles.personTitleRow}>
                    <h2>{selected.displayName}</h2>
                    <span className={selected.consent.status === "confirmed" ? styles.consentConfirmed : styles.consentPending}>
                      <i />{selected.consent.status === "confirmed" ? "All set" : "Needs your OK"}
                    </span>
                  </div>
                  <p>{RELATIONSHIP_LABELS[selected.relationship]}{selected.aliases.length ? ` · also known as ${selected.aliases.join(", ")}` : ""}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={deleteProfile} isLoading={busy === "delete"} aria-label={`Remove ${selected.displayName}`}><Trash2 /></Button>
              </section>

              <section className={styles.capabilitySummary}>
                <span className={styles.summaryEyebrow}>What {agent} can do right now</span>
                <p>{summaryLine}</p>
                {pendingTiles.length ? <small>Still to set up: <span>{pendingTiles.map((tile) => CAPABILITY_LABELS[tile.capability]).join(", ")}</span></small> : null}
                <div className={styles.capabilityGrid}>
                  {capabilityTiles.map((tile) => (
                    <div key={tile.capability} className={styles.capabilityTile} data-state={tile.state}>
                      <div><span>{CAPABILITY_ICONS[tile.capability]}</span><i /></div>
                      <strong>{CAPABILITY_LABELS[tile.capability]}</strong>
                      <small>{tile.note}</small>
                    </div>
                  ))}
                </div>
              </section>

              <div className={styles.setupHeading}>
                <span>Setup</span>
                <span>{setupComplete} of 3 complete</span>
              </div>

              <div className={styles.setupList}>
                <SetupStep
                  number={1}
                  eyebrow="Permission"
                  title="What you're allowed to do"
                  subtitle={selected.consent.status === "confirmed" ? `You've okayed ${selected.capabilities.length} ${selected.capabilities.length === 1 ? "thing" : "things"}` : "Not set yet"}
                  open={openStep === 1}
                  onToggle={() => setOpenStep((current) => current === 1 ? null : 1)}
                  complete={selected.consent.status === "confirmed"}
                  completeLabel="Confirmed"
                  todoLabel="Needs you"
                >
                  <p>Turn this on only if you really have {selected.displayName}&apos;s permission to help with these things. {agent} still checks before consequential actions.</p>
                  <div className={styles.chipRow}>{selected.capabilities.map((capability) => <span key={capability}>{CAPABILITY_LABELS[capability]}</span>)}</div>
                  {selected.consent.status === "confirmed" ? (
                    <Button variant="outline" onClick={() => void toggleConsent()} isLoading={busy === "consent"}>Turn off permission</Button>
                  ) : (
                    <Button className={styles.primaryButton} onClick={() => void toggleConsent()} isLoading={busy === "consent"}><ShieldCheck /> Give permission</Button>
                  )}
                </SetupStep>

                <SetupStep
                  number={2}
                  eyebrow="Their browser"
                  title="Their own browser profile"
                  subtitle={selected.browserBinding ? `Using ${selected.displayName}'s own browser` : "No browser yet"}
                  open={openStep === 2}
                  onToggle={() => setOpenStep((current) => current === 2 ? null : 2)}
                  complete={Boolean(selected.browserBinding)}
                  completeLabel="Done"
                  todoLabel="To do"
                >
                  <p>A separate browser keeps {selected.displayName}&apos;s logins apart from yours. You can open it yourself and watch, or let {agent} use it after you allow trusted access.</p>
                  <div className={styles.formGrid}>
                    <label><span>Which browser</span><select value={browserDirectory} onChange={(event) => setBrowserDirectory(event.target.value)} disabled={!chromeProfiles.length}><option value="">{chromeProfiles.length ? "Choose profile" : "No Chrome profiles found"}</option>{chromeProfiles.map((profile) => <option key={profile.directory} value={profile.directory}>{profile.name} · {profile.directory}</option>)}</select></label>
                    <label><span>Saved logins</span><select value={passwordManager} onChange={(event) => setPasswordManager(event.target.value as BeelinePasswordManager)}>{Object.entries(PASSWORD_MANAGER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className={styles.wide}><span>Who uses it</span><select value={automationMode} onChange={(event) => setAutomationMode(event.target.value as BeelineBrowserBinding["automationMode"])}><option value="manual-first">You open it and watch</option><option value="trusted-agent">Let {agent} use it after confirmation</option></select></label>
                  </div>
                  <div className={styles.buttonRow}>
                    <Button variant="secondary" onClick={() => void saveBrowserBinding()} isLoading={busy === "browser-save"} disabled={!browserDirectory}>Save</Button>
                    <Button variant="outline" onClick={() => void openBrowser()} isLoading={busy === "browser-open"} disabled={!selected.browserBinding || selected.consent.status !== "confirmed"}><ExternalLink /> Open their browser</Button>
                  </div>
                </SetupStep>

                <SetupStep
                  number={3}
                  eyebrow="Their accounts"
                  title="Their accounts"
                  subtitle={accountCount ? `${accountCount} ${accountCount === 1 ? "account" : "accounts"} connected` : "No accounts yet"}
                  open={openStep === 3}
                  onToggle={() => setOpenStep((current) => current === 3 ? null : 3)}
                  complete={accountCount > 0}
                  completeLabel="Connected"
                  todoLabel="Optional"
                >
                  <p>Connect an online account or save a website login on this computer. {agent} can use only {selected.displayName}&apos;s scoped handles and never receives the secret behind them.</p>
                  <BeelineConnectionsPanel
                    key={selected.id}
                    profile={selected}
                    onMessage={setMessage}
                    onError={setError}
                    onConnectionsChange={handleConnectionsChange}
                    onActivity={addActivity}
                  />
                  <div className={styles.accountDivider} />
                  <BeelineLocalCredentialsPanel
                    key={`local-${selected.id}`}
                    profile={selected}
                    agentName={agent}
                    onMessage={setMessage}
                    onError={setError}
                    onCredentialsChange={handleCredentialsChange}
                    onActivity={addActivity}
                  />
                </SetupStep>
              </div>

              {activity.length ? (
                <section className={styles.activityPanel}>
                  <div className={styles.activityHeading}><HeartHandshake /><h3>Recent activity for {selected.displayName}</h3></div>
                  <div className={styles.activityList}>
                    {activity.map((entry) => (
                      <div key={entry.id} className={styles.activityRow} data-tone={entry.tone}>
                        <span><i /><b /></span>
                        <p><strong>{entry.who}</strong> {entry.action}<small>{relativeTime(entry.at)}</small></p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <p className={styles.privacyFooter}>
                <ShieldCheck /> Kept private to the configured broker or this computer. Consequential actions still ask first.
              </p>
            </main>
          ) : null}
        </div>
      )}
    </div>
  );
}
