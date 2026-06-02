"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import Image from "next/image";
import { BrainCircuit, Bot, ImageIcon, RefreshCcw, Search, Send, Sparkles, Trash2, Workflow } from "lucide-react";

import { LottieBee } from "@/components/fleet/lottie-bee";
import { Button } from "@/components/ui/button";
import { AgentResponseLoader, ComposerField } from "@/features/chat/chat-composer";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import { runtimeIconPath } from "@/lib/config/runtime-icons";
import styles from "@/features/dashboard/views/DemoPanel.module.css";

type DemoPhase = "ready" | "ack-thinking" | "gathering" | "fusing" | "complete";
type DemoMessage = {
  id: string;
  role: "assistant" | "user";
  body: string;
};
type DemoCardCopy = {
  title: string;
  description: string;
};
type DemoStoredState = {
  phase: DemoPhase;
  messages: DemoMessage[];
  lastPrompt: string;
  placedIds: string[];
  cardCopy: DemoCardCopy;
};
type CapabilityCandidate = {
  id: string;
  title: string;
  kind: string;
  source: string;
  machineName: string;
  machineLocal: boolean;
  color: string;
  icon: typeof Search;
  iconAssets: CapabilityIconAsset[];
};
type CapabilityIconAsset = {
  src: string;
  alt: string;
};
type ConnectedAppIconCandidate = {
  description?: string;
  iconUrl?: string;
  kind?: string;
  local?: boolean;
  machineName?: string;
  name?: string;
  serviceKind?: string;
  sourceName?: string;
};
type ConnectedCapabilityOverride = {
  iconAssets: CapabilityIconAsset[];
  machineName?: string;
  machineLocal?: boolean;
};

const LOCAL_MACHINE_NAME = "This Mac";
const CAPABILITY_CANDIDATES: readonly [CapabilityCandidate, ...CapabilityCandidate[]] = [
  {
    id: "base-research",
    title: "Base research",
    kind: "Skill",
    source: "Base sources",
    machineName: LOCAL_MACHINE_NAME,
    machineLocal: true,
    color: "#20c7b4",
    icon: Search,
    iconAssets: [{ src: "/fusion/logos/base-mark.svg", alt: "Base logo" }],
  },
  {
    id: "x-research",
    title: "X research",
    kind: "Tool",
    source: "X search",
    machineName: LOCAL_MACHINE_NAME,
    machineLocal: true,
    color: "#60a5fa",
    icon: Search,
    iconAssets: [{ src: "/fusion/logos/x.svg", alt: "X logo" }],
  },
  {
    id: "obsidian-brain",
    title: "Obsidian brain",
    kind: "Brain",
    source: "Shared vault",
    machineName: LOCAL_MACHINE_NAME,
    machineLocal: true,
    color: "#8b5cf6",
    icon: BrainCircuit,
    iconAssets: [{ src: "/fusion/logos/obsidian.svg", alt: "Obsidian logo" }],
  },
  {
    id: "writing-agent",
    title: "Writer subclass",
    kind: "Agent",
    source: "Agent settings",
    machineName: LOCAL_MACHINE_NAME,
    machineLocal: true,
    color: "#7c5cff",
    icon: Bot,
    iconAssets: [{ src: beeRoleIconPath("worker", "writer"), alt: "HivemindOS writer bee subclass icon" }],
  },
  {
    id: "liam-style-guide",
    title: "Liam style guide",
    kind: "Skill",
    source: "Shared brain",
    machineName: LOCAL_MACHINE_NAME,
    machineLocal: true,
    color: "#f5b82e",
    icon: Sparkles,
    iconAssets: [{ src: "/fusion/icons/style-guide.png", alt: "Style guide icon" }],
  },
  {
    id: "comfyui-app",
    title: "ComfyUI",
    kind: "App",
    source: "Tailnet app",
    machineName: LOCAL_MACHINE_NAME,
    machineLocal: true,
    color: "#34d399",
    icon: ImageIcon,
    iconAssets: [{ src: "/fusion/logos/comfyui.svg", alt: "ComfyUI logo" }],
  },
  {
    id: "z-image-app",
    title: "Z-Image",
    kind: "App",
    source: "Image model",
    machineName: LOCAL_MACHINE_NAME,
    machineLocal: true,
    color: "#a3e635",
    icon: ImageIcon,
    iconAssets: [{ src: "/fusion/icons/z-image.png", alt: "Z-Image icon" }],
  },
  {
    id: "delivery-channel",
    title: "Telegram delivery",
    kind: "Tool",
    source: "Runtime handle",
    machineName: LOCAL_MACHINE_NAME,
    machineLocal: true,
    color: "#38bdf8",
    icon: Send,
    iconAssets: [{ src: "/fusion/logos/telegram.svg", alt: "Telegram logo" }],
  },
  {
    id: "workflow-runtime",
    title: "AEON ready loop",
    kind: "Workflow",
    source: "Runtime",
    machineName: LOCAL_MACHINE_NAME,
    machineLocal: true,
    color: "#fb7185",
    icon: Workflow,
    iconAssets: [{ src: runtimeIconPath("aeon"), alt: "AEON runtime icon" }],
  },
];

const INITIAL_MESSAGES: DemoMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    body: "What skill can I create for you today?",
  },
];
const DEMO_STORAGE_KEY = "hivemindos:hive-skill-fusion-state:v6";
const CAPABILITY_DROP_MS = 1500;

function promptNeedsAeonRuntime(prompt: string) {
  return /\b(?:aeon|autonomous|cron|daily|daemon|every|hourly|loop|monitor|recurring|repeat|schedule|scheduled|watch)\b/iu.test(prompt);
}

function selectCapabilityCandidateIds(prompt: string) {
  const selectedIds = CAPABILITY_CANDIDATES
    .map((candidate) => candidate.id)
    .filter((id) => id !== "workflow-runtime");
  return promptNeedsAeonRuntime(prompt) ? [...selectedIds, "workflow-runtime"] : selectedIds;
}

function appSearchText(app: ConnectedAppIconCandidate) {
  return `${app.name ?? ""} ${app.description ?? ""} ${app.kind ?? ""} ${app.serviceKind ?? ""} ${app.sourceName ?? ""}`.toLowerCase();
}

function appMatchesComfyUi(app: ConnectedAppIconCandidate) {
  return /\b(comfyui|comfy)\b/u.test(appSearchText(app));
}

function appMatchesZImage(app: ConnectedAppIconCandidate) {
  return /\b(z-image|zimage)\b/u.test(appSearchText(app));
}

function displayMachineName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : LOCAL_MACHINE_NAME;
}

function compactMachineLabel(machineName: string, machineLocal: boolean) {
  const normalized = displayMachineName(machineName);
  if (machineLocal || /^this mac$/iu.test(normalized)) return LOCAL_MACHINE_NAME;
  if (/\bmac\s*book\s*pro\b|\bmacbook\s*pro\b/iu.test(normalized)) return "Remote MBP";
  if (/\bmac\s*book\s*air\b|\bmacbook\s*air\b/iu.test(normalized)) return "Remote MBA";
  if (/\bmac\b/iu.test(normalized)) return "Remote Mac";
  if (/\b(?:pc|windows)\b/iu.test(normalized)) return "Remote PC";
  if (normalized.length <= 14) return normalized;
  return "Remote";
}

function isStableIconUrl(value: unknown) {
  if (typeof value !== "string") return false;
  const iconUrl = value.trim();
  return iconUrl.startsWith("/")
    || iconUrl.startsWith("data:image/")
    || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//iu.test(iconUrl);
}

function connectedCapabilityOverride(apps: ConnectedAppIconCandidate[], predicate: (app: ConnectedAppIconCandidate) => boolean): ConnectedCapabilityOverride | null {
  const app = apps.find(predicate);
  if (!app) return null;
  const iconUrl = typeof app.iconUrl === "string" ? app.iconUrl.trim() : "";
  return {
    iconAssets: isStableIconUrl(iconUrl)
      ? [{
        src: iconUrl,
        alt: `${app.name || "Connected app"} icon`,
      }]
      : [],
    machineName: displayMachineName(app.machineName),
    machineLocal: app.local === true,
  };
}

function createCardCopy(prompt: string): DemoCardCopy {
  const normalized = prompt.trim();
  if (/base/i.test(normalized) && /(telegram|x post|image)/i.test(normalized)) {
    return {
      title: "Base News Broadcast Skill",
      description: "A reusable Hive skill that searches trusted Base news sources, writes a Liam-style X post, selects the best image generator, and sends the finished text and image through Telegram.",
    };
  }

  const titleSeed = normalized
    .replace(/^make\s+(?:me\s+)?(?:a|an)\s+(?:skill|workflow)\s+that\s+/i, "")
    .replace(/^make\s+(?:me\s+)?(?:a|an)\s+/i, "")
    .replace(/[,.!?]+$/u, "")
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");
  const titleBase = titleSeed
    ? `${titleSeed.charAt(0).toUpperCase()}${titleSeed.slice(1)}`
    : "Custom Hive Skill";
  const title = /(?:skill|workflow)$/i.test(titleBase) ? titleBase : `${titleBase} Skill`;
  return {
    title,
    description: "A reusable Hive skill that searches the shared brain, ranks eligible agents, apps, tools, and delivery channels, then fuses the selected parts into a repeatable agent workflow.",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDemoPhase(value: unknown): value is DemoPhase {
  return value === "ready" || value === "ack-thinking" || value === "gathering" || value === "fusing" || value === "complete";
}

function isDemoMessage(value: unknown): value is DemoMessage {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && (value.role === "assistant" || value.role === "user")
    && typeof value.body === "string";
}

function isDemoCardCopy(value: unknown): value is DemoCardCopy {
  if (!isRecord(value)) return false;
  return typeof value.title === "string" && typeof value.description === "string";
}

function readStoredDemoState(): DemoStoredState | null {
  if (typeof window === "undefined") return null;
  try {
    const rawState = window.sessionStorage.getItem(DEMO_STORAGE_KEY);
    if (!rawState) return null;
    const parsed: unknown = JSON.parse(rawState);
    if (!isRecord(parsed) || !isDemoPhase(parsed.phase)) return null;
    return {
      phase: parsed.phase,
      messages: Array.isArray(parsed.messages) && parsed.messages.every(isDemoMessage)
        ? parsed.messages
        : INITIAL_MESSAGES,
      lastPrompt: typeof parsed.lastPrompt === "string" ? parsed.lastPrompt : "",
      placedIds: Array.isArray(parsed.placedIds)
        ? parsed.placedIds.filter((id): id is string => typeof id === "string")
        : [],
      cardCopy: isDemoCardCopy(parsed.cardCopy) ? parsed.cardCopy : createCardCopy(""),
    };
  } catch {
    return null;
  }
}

function writeStoredDemoState(state: DemoStoredState) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
}

function orbitVector(index: number, total: number) {
  const angle = (-90 + (360 / Math.max(total, 1)) * index) * (Math.PI / 180);
  const radius = 140;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function orbitPosition(index: number, total: number, candidateColor: string) {
  const vector = orbitVector(index, total);
  return {
    "--orbit-x": `${vector.x}px`,
    "--orbit-y": `${vector.y}px`,
    "--candidate-color": candidateColor,
  } as CSSProperties;
}

function flightPosition(index: number, total: number, candidateColor: string) {
  const vector = orbitVector(index, total);
  const startSpread = Math.min(180, Math.max(total - 1, 1) * 28);
  const progress = index / Math.max(total - 1, 1);
  const startX = -260 + progress * startSpread;
  const startY = 224 + (index % 2) * 10;
  const midX = startX + (vector.x - startX) * 0.58;
  const midY = startY + (vector.y - startY) * 0.58 - 70;
  return {
    "--candidate-color": candidateColor,
    "--flight-start-x": `${startX}px`,
    "--flight-start-y": `${startY}px`,
    "--flight-mid-x": `${midX}px`,
    "--flight-mid-y": `${midY}px`,
    "--flight-end-x": `${vector.x}px`,
    "--flight-end-y": `${vector.y}px`,
  } as CSSProperties;
}

function CapabilityIcon({
  assets,
  candidate,
  size,
}: {
  assets: CapabilityIconAsset[];
  candidate: CapabilityCandidate;
  size: "row" | "token" | "orbit" | "card";
}) {
  const Icon = candidate.icon;
  const visibleAsset = assets.find((asset) => asset.src);
  return (
    <span className={`${styles.capabilityIcon} ${styles[`${size}CapabilityIcon`]}`} style={{ "--candidate-color": candidate.color } as CSSProperties}>
      <span className={styles.capabilityIconInner}>
        {visibleAsset ? (
          <span className={styles.capabilityIconSolo}>
            <span className={styles.capabilityIconImageFrame}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={visibleAsset.src} alt={visibleAsset.alt} className={styles.capabilityIconImage} />
            </span>
          </span>
        ) : (
          <Icon aria-hidden="true" className={styles.capabilityIconFallback} />
        )}
      </span>
      <span className={styles.capabilityIconGloss} aria-hidden="true" />
    </span>
  );
}

function MachineBadge({ candidate }: { candidate: CapabilityCandidate }) {
  const label = compactMachineLabel(candidate.machineName, candidate.machineLocal);
  const title = `Runs on ${candidate.machineName}`;
  const isRemote = !candidate.machineLocal && !/^this mac$/iu.test(candidate.machineName);
  return (
    <span
      aria-label={`${candidate.title} ${title}`}
      className={`${styles.machineBadge} ${isRemote ? styles.remoteMachineBadge : ""}`}
      title={title}
    >
      {label}
    </span>
  );
}

export function DemoPanel() {
  const [initialStoredState] = useState<DemoStoredState | null>(() => readStoredDemoState());
  const [phase, setPhase] = useState<DemoPhase>(initialStoredState?.phase ?? "ready");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<DemoMessage[]>(initialStoredState?.messages ?? INITIAL_MESSAGES);
  const [lastPrompt, setLastPrompt] = useState(initialStoredState?.lastPrompt ?? "");
  const [placedIds, setPlacedIds] = useState<string[]>(initialStoredState?.placedIds ?? []);
  const [cardCopy, setCardCopy] = useState<DemoCardCopy>(() => initialStoredState?.cardCopy ?? createCardCopy(""));
  const [connectedCapabilityOverrides, setConnectedCapabilityOverrides] = useState<Record<string, ConnectedCapabilityOverride>>({});
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const attachmentMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const resolvedCandidates = useMemo(
    () => CAPABILITY_CANDIDATES.map((candidate) => ({
      ...candidate,
      iconAssets: connectedCapabilityOverrides[candidate.id]?.iconAssets.length ? connectedCapabilityOverrides[candidate.id].iconAssets : candidate.iconAssets,
      machineName: connectedCapabilityOverrides[candidate.id]?.machineName || candidate.machineName,
      machineLocal: connectedCapabilityOverrides[candidate.id]?.machineLocal ?? candidate.machineLocal,
    })),
    [connectedCapabilityOverrides],
  );
  const selectedCapabilityIds = useMemo(() => selectCapabilityCandidateIds(lastPrompt), [lastPrompt]);
  const selectedCandidates = useMemo(
    () => resolvedCandidates.filter((candidate) => selectedCapabilityIds.includes(candidate.id)),
    [resolvedCandidates, selectedCapabilityIds],
  );
  const activeIndex = phase === "gathering"
    ? Math.min(placedIds.length, selectedCandidates.length - 1)
    : 0;
  const activeCandidate = selectedCandidates[activeIndex] ?? resolvedCandidates[0];
  const isWorking = phase === "ack-thinking" || phase === "gathering" || phase === "fusing";
  const showChat = phase !== "fusing" && phase !== "complete";
  const showCapabilityResults = phase === "gathering";
  const showGeneratedCard = phase === "fusing" || phase === "complete";
  const stagedCandidates = useMemo(
    () => selectedCandidates.filter((candidate) => placedIds.includes(candidate.id)),
    [placedIds, selectedCandidates],
  );
  const activeCandidateIsPlaced = placedIds.includes(activeCandidate.id);

  useEffect(() => {
    let cancelled = false;
    async function loadConnectedAppIcons() {
      const response = await fetch("/api/fleet/apps?fast=1", { cache: "no-store" }).catch(() => null);
      const payload: unknown = await response?.json().catch(() => null);
      if (cancelled || !isRecord(payload) || !Array.isArray(payload.apps)) return;
      const apps = payload.apps.filter(isRecord);
      const comfyOverride = connectedCapabilityOverride(apps, appMatchesComfyUi);
      const zImageOverride = connectedCapabilityOverride(apps, appMatchesZImage);
      setConnectedCapabilityOverrides((current) => ({
        ...current,
        ...(comfyOverride ? { "comfyui-app": comfyOverride } : {}),
        ...(zImageOverride ? { "z-image-app": zImageOverride } : {}),
      }));
    }
    void loadConnectedAppIcons();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writeStoredDemoState({
      phase,
      messages,
      lastPrompt,
      placedIds,
      cardCopy,
    });
  }, [cardCopy, lastPrompt, messages, phase, placedIds]);

  useEffect(() => {
    if (phase !== "ack-thinking") return undefined;
    const timer = window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: `ack-${Date.now()}`,
          role: "assistant",
          body: "Understood. On it.",
        },
      ]);
      setPhase("gathering");
      setPlacedIds([]);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "gathering" || activeCandidateIsPlaced) return undefined;
    const timer = window.setTimeout(() => {
      setPlacedIds((current) => current.includes(activeCandidate.id) ? current : [...current, activeCandidate.id]);
    }, CAPABILITY_DROP_MS);
    return () => window.clearTimeout(timer);
  }, [activeCandidate.id, activeCandidateIsPlaced, phase]);

  useEffect(() => {
    if (phase !== "gathering") return undefined;
    if (placedIds.length < selectedCandidates.length) return undefined;
    const fuseTimer = window.setTimeout(() => setPhase("fusing"), 700);
    return () => window.clearTimeout(fuseTimer);
  }, [phase, placedIds.length, selectedCandidates]);

  useEffect(() => {
    if (phase !== "fusing") return undefined;
    const timer = window.setTimeout(() => setPhase("complete"), 2400);
    return () => window.clearTimeout(timer);
  }, [phase]);

  function startRun(prompt: string) {
    const cleanPrompt = prompt.trim() || "make a skill that turns research, writing, image generation, and delivery into one reusable workflow";
    setLastPrompt(cleanPrompt);
    setCardCopy(createCardCopy(cleanPrompt));
    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        body: cleanPrompt,
      },
    ]);
    setDraft("");
    setPlacedIds([]);
    setPhase("ack-thinking");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isWorking) return;
    startRun(draft);
  }

  function handleRegenerate() {
    startRun(lastPrompt);
  }

  function handleDelete() {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(DEMO_STORAGE_KEY);
    }
    setMessages(INITIAL_MESSAGES);
    setLastPrompt("");
    setPlacedIds([]);
    setCardCopy(createCardCopy(""));
    setPhase("ready");
  }

  function ignoreFileChange(event: ChangeEvent<HTMLInputElement>) {
    event.currentTarget.value = "";
  }

  return (
    <section className={styles.demoView} aria-labelledby="hive-fusion-title">
      <div className={styles.demoHeader}>
        <div>
          <h2 id="hive-fusion-title">Hive Skill Fusion</h2>
          <p>Create reusable skills from the agents, apps, tools, and workflows already available to the hive.</p>
        </div>
      </div>

      <div className={styles.demoGrid}>
        <div className={styles.fusionBoard}>
          <div className={`${styles.fusionStage} ${showCapabilityResults ? styles.searchingStage : ""} ${phase === "fusing" ? styles.fusingStage : ""} ${phase === "complete" ? styles.completeStage : ""}`}>
            {showChat ? (
              <aside className={styles.chatModal} aria-label="Compact skill creation chat">
                <div className={styles.chatHeader}>
                  <span className={styles.chatAvatar} aria-hidden="true">
                    <LottieBee size={34} />
                  </span>
                  <span>
                    <strong>Adaptive Agent</strong>
                    <small>{isWorking ? "Building" : "Ready"}</small>
                  </span>
                </div>

                <div className={styles.messageList} aria-live="polite">
                  {messages.map((message) => (
                    <div className={`${styles.messageRow} ${message.role === "user" ? styles.userMessageRow : ""}`} key={message.id}>
                      <div className={`${styles.messageBubble} ${message.role === "user" ? styles.userBubble : styles.assistantBubble}`}>
                        <span>{message.body}</span>
                      </div>
                    </div>
                  ))}
                  {isWorking ? (
                    <div className={styles.messageRow}>
                      <div className={`${styles.messageBubble} ${styles.loaderBubble}`}>
                        <AgentResponseLoader />
                      </div>
                    </div>
                  ) : null}
                </div>

                <form className={styles.composerForm} onSubmit={handleSubmit}>
                  <ComposerField
                    value={draft}
                    onChange={setDraft}
                    placeholder="Make a skill that..."
                    disabled={isWorking}
                    busy={isWorking}
                    compact
                    attachments={[]}
                    attachmentMenuOpen={attachmentMenuOpen}
                    setAttachmentMenuOpen={setAttachmentMenuOpen}
                    attachmentMenuRef={attachmentMenuRef}
                    fileInputRef={fileInputRef}
                    imageInputRef={imageInputRef}
                    onFileChange={ignoreFileChange}
                    onImageChange={ignoreFileChange}
                    onRemoveAttachment={() => undefined}
                    voiceBands={[0.2, 0.45, 0.7, 0.38, 0.6]}
                    canSend={draft.trim().length > 0}
                    submitOnEnter
                  />
                </form>
              </aside>
            ) : null}

            {showCapabilityResults ? (
              <div className={styles.searchColumn}>
                <div className={styles.searchHeader}>
                  <BrainCircuit aria-hidden="true" />
                  <span>
                    <strong>Capability Search</strong>
                    <small>Ranking live results</small>
                  </span>
                </div>
                <div className={styles.candidateList}>
                  {selectedCandidates.map((candidate) => {
                    const selected = placedIds.includes(candidate.id);
                    const active = activeCandidate.id === candidate.id && phase === "gathering";
                    return (
                      <div
                        className={`${styles.candidateRow} ${active ? styles.activeCandidate : ""} ${selected ? styles.selectedCandidate : ""}`}
                        key={candidate.id}
                        style={{ "--candidate-color": candidate.color } as CSSProperties}
                      >
                        <CapabilityIcon assets={candidate.iconAssets} candidate={candidate} size="row" />
                        <span>
                          <strong>{candidate.title}</strong>
                          <small>{candidate.kind} · {candidate.source}</small>
                          <MachineBadge candidate={candidate} />
                        </span>
                        <em>{selected ? "chosen" : active ? "best fit" : "eligible"}</em>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {showGeneratedCard ? (
              <div className={`${styles.generatedCard} ${phase === "complete" ? styles.generatedCardVisible : ""}`}>
                <div className={styles.generatedCopy}>
                  <span className={styles.generatedEyebrow}>Hive skill</span>
                  <h3>{cardCopy.title}</h3>
                  <p>{cardCopy.description}</p>
                  <div className={styles.skillsUsed} aria-label="Capabilities used">
                    <strong>Capabilities used</strong>
                    <div className={styles.skillsUsedGrid}>
                      {selectedCandidates.map((candidate) => (
                        <span className={styles.skillUsedPill} key={candidate.id}>
                          <CapabilityIcon assets={candidate.iconAssets} candidate={candidate} size="card" />
                          <span>
                            <b>{candidate.title}</b>
                            <small>{candidate.kind}</small>
                            <MachineBadge candidate={candidate} />
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className={styles.cardActions}>
                  <Button className={styles.cardActionButton} size="sm" type="button" variant="ghost" onClick={handleRegenerate}>
                    <RefreshCcw aria-hidden="true" />
                    Regenerate
                  </Button>
                  <Button className={styles.cardActionButton} size="sm" type="button" variant="ghost" onClick={handleDelete}>
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </div>
            ) : null}

            <div className={styles.orbitField}>
              <div className={styles.orbitRing} aria-hidden="true" />
              <div className={styles.flightLayer} aria-hidden="true">
                {phase === "gathering" ? (
                  <>
                    <span
                      className={styles.pluckedToken}
                      key={activeCandidate.id}
                      style={flightPosition(activeIndex, selectedCandidates.length, activeCandidate.color)}
                    >
                      <CapabilityIcon assets={activeCandidate.iconAssets} candidate={activeCandidate} size="token" />
                      {activeCandidate.title}
                    </span>
                    <span className={styles.flightBee} key={`bee-${activeCandidate.id}`} style={flightPosition(activeIndex, selectedCandidates.length, activeCandidate.color)}>
                      <LottieBee className={styles.flightBeeSprite} size={58} />
                    </span>
                  </>
                ) : null}
              </div>
              {stagedCandidates.map((candidate) => {
                const candidateIndex = selectedCandidates.findIndex((selectedCandidate) => selectedCandidate.id === candidate.id);
                return (
                  <span
                    className={styles.orbitChip}
                    key={candidate.id}
                    style={orbitPosition(candidateIndex, selectedCandidates.length, candidate.color)}
                  >
                    <CapabilityIcon assets={candidate.iconAssets} candidate={candidate} size="orbit" />
                    <small>{candidate.kind}</small>
                  </span>
                );
              })}
              <div className={styles.coreImageWrap}>
                <Image src="/demos/hive-fusion-core.png" alt="Hive fusion core with two worker bees" width={380} height={380} priority className={styles.coreImage} />
                <span className={styles.coreGlow} aria-hidden="true" />
                <span className={styles.fusionFlash} aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
