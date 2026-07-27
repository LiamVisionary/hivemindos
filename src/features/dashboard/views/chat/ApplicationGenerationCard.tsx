"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Box, ExternalLink, FolderOpen, Image as ImageIcon, Music, Sparkles, Video, Volume2, X } from "lucide-react";
import { normalizeApplicationGenerationUrl, type ChatApplicationGenerationArtifact, type ChatApplicationGenerationCard as ChatApplicationGenerationCardData, type ChatApplicationGenerationKind } from "@/features/dashboard/chat-application-generation";
import { nativeOrFetch } from "@/lib/native/bridge";
import { cachedGenerationMetric, loadGenerationMetricsSnapshot, recordGenerationMetric } from "@/lib/services/generation-metrics-client";
import styles from "./ImageGenerationCard.module.css";

type DeliverableActionResult = { ok?: boolean; error?: string };

/**
 * The on-disk path of a generated artifact, or "" when it isn't a local file.
 *
 * `/api/chat/generated-media` streams the file and carries its absolute path in
 * the `path` query param, so the card can recover the real location to reveal.
 * Remote http(s) artifacts (a hosted app returning its own URL) have no local
 * path and stay openable as links.
 */
export function revealablePathFromArtifactUrl(url: string) {
  const base = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return "";
  }
  if (parsed.protocol === "file:") return decodeURIComponent(parsed.pathname);
  if (parsed.pathname === "/api/chat/generated-media") return parsed.searchParams.get("path")?.trim() ?? "";
  return "";
}

/**
 * Reveal the artifact in the OS file manager. Native invoke first: the released
 * desktop app is a static bundle with no `/api` server, so the HTTP route only
 * answers in dev/browser. The server re-validates the path — this is a
 * convenience, not the trust boundary.
 */
async function revealGeneratedArtifact(path: string): Promise<DeliverableActionResult> {
  return nativeOrFetch<DeliverableActionResult>({
    command: "open_deliverable",
    args: { action: "reveal", path },
    fallback: async () => {
      const response = await fetch("/api/kanban/deliverable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reveal", path }),
      });
      const data = await response.json().catch(() => null) as DeliverableActionResult | null;
      if (!response.ok || !data?.ok) return { ok: false, error: data?.error || "Could not show that file." };
      return data;
    },
  });
}

function RevealInFolderButton({ path, label }: { path: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reveal() {
    setBusy(true);
    setError("");
    const result = await revealGeneratedArtifact(path).catch((cause: unknown) => ({
      ok: false,
      error: cause instanceof Error ? cause.message : "Could not show that file.",
    }));
    setBusy(false);
    if (!result?.ok) setError(result?.error || "Could not show that file.");
  }

  return (
    <>
      <button className={styles.actionButton} disabled={busy} onClick={() => void reveal()} type="button">
        {busy ? <span className={styles.actionSpinner} aria-hidden="true" /> : <FolderOpen aria-hidden="true" />}
        {label}
      </button>
      {error ? <p className={styles.errorText} role="alert">{error}</p> : null}
    </>
  );
}

type ArtifactRendererInput = {
  card: ChatApplicationGenerationCardData;
  artifact?: ChatApplicationGenerationArtifact;
};

function statusLabel(status: ChatApplicationGenerationCardData["status"]) {
  if (status === "ready") return "ready";
  if (status === "error") return "error";
  return "generating";
}

function appLine(card: ChatApplicationGenerationCardData, fallback: string) {
  return [card.appName, card.machineName].filter(Boolean).join(" on ") || fallback;
}

function primaryArtifact(card: ChatApplicationGenerationCardData, kind: ChatApplicationGenerationArtifact["kind"]) {
  return card.artifacts?.find((artifact) => artifact.kind === kind && normalizeApplicationGenerationUrl(artifact.url))
    ?? card.artifacts?.find((artifact) => normalizeApplicationGenerationUrl(artifact.url));
}

function durationLabel(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function useDurationEstimate(card: ChatApplicationGenerationCardData) {
  const metricIdentity = useMemo(() => ({
    kind: card.kind,
    appId: card.appId,
    appName: card.appName,
    serviceKind: card.serviceKind,
    modelName: card.modelName,
    machineName: card.machineName,
    machineSpecs: card.machineSpecs,
  }), [card.appId, card.appName, card.kind, card.machineName, card.machineSpecs, card.modelName, card.serviceKind]);
  const [estimateMs, setEstimateMs] = useState(() => cachedGenerationMetric(metricIdentity)?.averageDurationMs ?? null);
  useEffect(() => {
    let cancelled = false;
    void loadGenerationMetricsSnapshot().then(() => {
      if (!cancelled) setEstimateMs(cachedGenerationMetric(metricIdentity)?.averageDurationMs ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [metricIdentity]);
  useEffect(() => {
    if (typeof card.createdAt !== "number" || typeof card.completedAt !== "number") return;
    const durationMs = card.completedAt - card.createdAt;
    if (!Number.isFinite(durationMs) || durationMs < 500) return;
    void recordGenerationMetric({
      ...metricIdentity,
      durationMs,
      runId: card.id,
      completedAt: card.completedAt,
    }).then(() => {
      setEstimateMs(cachedGenerationMetric(metricIdentity)?.averageDurationMs ?? durationMs);
    });
  }, [card.completedAt, card.createdAt, card.id, metricIdentity]);
  return estimateMs;
}

/**
 * The prototype's full-width progress bar under the generating skeleton
 * (Chat.dc.html 503). Renders nothing until we have a real duration estimate —
 * a bar with no estimate behind it would be a fabricated progress signal.
 */
function GenerationProgress({ card }: { card: ChatApplicationGenerationCardData }) {
  const [now, setNow] = useState(() => Date.now());
  const estimateMs = useDurationEstimate(card);
  useEffect(() => {
    if (card.status !== "running" || typeof card.createdAt !== "number") return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [card.createdAt, card.status]);
  if (card.status !== "running" || typeof card.createdAt !== "number" || !estimateMs) return null;
  const progress = Math.min(96, Math.max(2, Math.round(((now - card.createdAt) / estimateMs) * 100)));
  return (
    <span className={styles.progressTrack} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Estimated generation progress">
      <span className={styles.progressFill} style={{ width: `${progress}%` }} />
    </span>
  );
}

function GenerationTiming({ card }: { card: ChatApplicationGenerationCardData }) {
  const [now, setNow] = useState(() => Date.now());
  // Called for its side effect, not its value: this hook records the completion
  // metric that later feeds GenerationProgress's estimate. GenerationProgress
  // only mounts while the card is running, so it can never record a completion —
  // this always-rendered component is the one that does.
  useDurationEstimate(card);
  useEffect(() => {
    if (card.status !== "running" || typeof card.createdAt !== "number") return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [card.createdAt, card.status]);

  if (typeof card.createdAt !== "number") return null;
  if (card.status === "running") {
    return <span className={styles.timing}> / {durationLabel(now - card.createdAt)} elapsed</span>;
  }
  if (typeof card.completedAt !== "number") return null;
  const label = card.status === "error" ? "failed after" : "generated in";
  return <span> / {label} {durationLabel(card.completedAt - card.createdAt)}</span>;
}

function imageIdentity(url: string) {
  const trimmed = url.trim();
  let source = trimmed;
  try {
    const parsed = new URL(trimmed, "http://hivemind.local");
    source = parsed.searchParams.get("path") || `${parsed.origin}${parsed.pathname}`;
  } catch {
    source = trimmed;
  }
  let decoded = source;
  try {
    decoded = decodeURIComponent(source);
  } catch {
    decoded = source;
  }
  return decoded.split(/[?#]/)[0].split(/[\\/]/).pop()?.toLowerCase() || decoded.toLowerCase();
}

function generatedMediaSignatureState(url: string) {
  try {
    const parsed = new URL(url, "http://hivemind.local");
    if (parsed.pathname !== "/api/chat/generated-media") return "not-generated-media";
    return parsed.searchParams.get("sig") && parsed.searchParams.get("exp") ? "signed" : "unsigned";
  } catch {
    return "not-generated-media";
  }
}

function normalizeImageArtifacts(card: ChatApplicationGenerationCardData, fallback?: ChatApplicationGenerationArtifact) {
  const candidates = [
    ...(card.artifacts ?? []),
    ...(fallback ? [fallback] : []),
  ];
  const seen = new Set<string>();
  const deduped = candidates
    .map((item) => ({ ...item, url: normalizeApplicationGenerationUrl(item.url) }))
    .filter((item): item is ChatApplicationGenerationArtifact => item.kind === "image" && Boolean(item.url))
    .filter((item) => {
      const key = imageIdentity(item.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const dataImages = deduped.filter((item) => /^data:image\//i.test(item.url));
  const nonDataImages = deduped.filter((item) => !/^data:image\//i.test(item.url));
  if (dataImages.length && nonDataImages.length) {
    const renderableNonData = nonDataImages.filter((item) => generatedMediaSignatureState(item.url) !== "unsigned");
    return renderableNonData.length ? renderableNonData : dataImages;
  }
  return deduped;
}

function ImageArtifactFrame({ image, index, prompt, onError, onOpen }: { image: ChatApplicationGenerationArtifact; index: number; prompt: string; onError: () => void; onOpen: () => void }) {
  const alt = prompt ? `Generated image ${index + 1} for: ${prompt}` : `Generated image ${index + 1}`;
  return (
    <button type="button" className={styles.frameButton} onClick={onOpen} aria-label="Open generated image preview">
      {/* eslint-disable-next-line @next/next/no-img-element -- connected app image URLs are dynamic local/Tailnet endpoints. */}
      <img src={image.url} alt={alt} onError={onError} />
    </button>
  );
}

function ImageArtifactGallery({ card, fallback }: { card: ChatApplicationGenerationCardData; fallback?: ChatApplicationGenerationArtifact }) {
  const images = useMemo(() => normalizeImageArtifacts(card, fallback), [card, fallback]);
  const imageKeys = useMemo(() => images.map((image) => imageIdentity(image.url)).join("\n"), [images]);
  const [failedState, setFailedState] = useState<{ imageKeys: string; items: Set<string> }>(() => ({ imageKeys: "", items: new Set() }));
  const [previewImage, setPreviewImage] = useState<ChatApplicationGenerationArtifact | null>(null);
  const failed = failedState.imageKeys === imageKeys ? failedState.items : new Set<string>();
  const visibleImages = images.filter((image) => !failed.has(imageIdentity(image.url)));
  useEffect(() => {
    if (!previewImage) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewImage(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewImage]);
  if (!visibleImages.length) return null;
  const markFailed = (image: ChatApplicationGenerationArtifact) => {
    const key = imageIdentity(image.url);
    setFailedState((current) => {
      const items = current.imageKeys === imageKeys ? new Set(current.items) : new Set<string>();
      items.add(key);
      return { imageKeys, items };
    });
  };
  const previewAlt = previewImage ? (card.prompt ? `Generated image preview for: ${card.prompt}` : "Generated image preview") : "";
  if (visibleImages.length === 1) {
    return (
      <>
        <ImageArtifactFrame image={visibleImages[0]} index={0} prompt={card.prompt} onError={() => markFailed(visibleImages[0])} onOpen={() => setPreviewImage(visibleImages[0])} />
        {previewImage ? <ImagePreviewModal image={previewImage} alt={previewAlt} onClose={() => setPreviewImage(null)} /> : null}
      </>
    );
  }
  return (
    <>
      <div className={styles.imageGrid}>
        {visibleImages.map((image, index) => (
          <ImageArtifactFrame image={image} index={index} key={image.url} prompt={card.prompt} onError={() => markFailed(image)} onOpen={() => setPreviewImage(image)} />
        ))}
      </div>
      {previewImage ? <ImagePreviewModal image={previewImage} alt={previewAlt} onClose={() => setPreviewImage(null)} /> : null}
    </>
  );
}

function ImagePreviewModal({ image, alt, onClose, dialogLabel = "Generated image preview" }: { image: ChatApplicationGenerationArtifact; alt: string; onClose: () => void; dialogLabel?: string }) {
  return (
    <div className={styles.previewOverlay} role="dialog" aria-modal="true" aria-label={dialogLabel} onClick={onClose}>
      <button type="button" className={styles.previewClose} onClick={onClose} aria-label="Close preview">
        <X aria-hidden="true" />
      </button>
      <div className={styles.previewFrame} onClick={(event) => event.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- connected app image URLs are dynamic local/Tailnet endpoints. */}
        <img src={image.url} alt={alt} />
      </div>
    </div>
  );
}

function SourceImageThumbnail({ card }: { card: ChatApplicationGenerationCardData }) {
  const sourceImage = card.sourceArtifacts?.find((artifact) => (
    artifact.kind === "image" && normalizeApplicationGenerationUrl(artifact.url)
  ));
  const [previewOpen, setPreviewOpen] = useState(false);
  if (!sourceImage) return null;
  const alt = sourceImage.label ? `Source image: ${sourceImage.label}` : "Source image";
  return (
    <>
      <button
        type="button"
        className={styles.sourceThumbnail}
        onClick={() => setPreviewOpen(true)}
        aria-label="Open source image preview"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- source images use signed dynamic local/Tailnet URLs. */}
        <img className={styles.sourceThumbnailImage} src={sourceImage.url} alt={alt} />
      </button>
      {previewOpen ? (
        <ImagePreviewModal
          image={sourceImage}
          alt={alt}
          dialogLabel="Source image preview"
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}

export abstract class ApplicationGenerationCardAdapter {
  abstract readonly kind: ChatApplicationGenerationKind;
  abstract readonly title: string;
  abstract readonly connectedAppFallback: string;

  protected abstract renderIcon(card: ChatApplicationGenerationCardData): ReactNode;

  protected primaryArtifact(card: ChatApplicationGenerationCardData) {
    return primaryArtifact(card, "file");
  }

  protected actionLabel(artifact?: ChatApplicationGenerationArtifact) {
    void artifact;
    return "Open result";
  }

  /** Label for the reveal-in-file-manager action (local artifacts only). */
  protected revealLabel() {
    return "Show in folder";
  }

  protected renderArtifact(input: ArtifactRendererInput): ReactNode {
    void input;
    return null;
  }

  protected errorFallback() {
    return "The connected generation app did not return a result.";
  }

  render(card: ChatApplicationGenerationCardData) {
    const artifact = this.primaryArtifact(card);
    const artifactUrl = normalizeApplicationGenerationUrl(artifact?.url);
    return (
      <section className={styles.card} aria-label={card.title || this.title}>
        <header className={styles.header}>
          {/* While generating, the tile takes the honey outline + honey glyph
              (prototype Chat.dc.html 493-497). */}
          <span
            className={styles.icon}
            aria-hidden="true"
            style={card.status === "running" ? { borderColor: "var(--honey-line)", color: "var(--honey)" } : undefined}
          >
            {this.renderIcon(card)}
          </span>
          <span className={styles.title}>
            <strong>{card.title || this.title}</strong>
            <small>{appLine(card, this.connectedAppFallback)}<GenerationTiming card={card} /></small>
          </span>
          <span className={`${styles.status} ${styles[card.status]}`}>{statusLabel(card.status)}</span>
        </header>

        {/* `cx-genskel` supplies the grid texture + honey/live shimmer sweep and
            already honours prefers-reduced-motion. */}
        {card.status === "running" ? (
          <>
            <div className={`${styles.skeleton} cx-genskel`} role="status" aria-label={`${statusLabel(card.status)} ${card.kind}`} />
            <GenerationProgress card={card} />
          </>
        ) : null}
        {this.renderArtifact({ card, artifact })}

        {card.status === "error" ? <p className={styles.errorText}>{card.error || this.errorFallback()}</p> : null}

        <div className={styles.prompt}>
          <div className={styles.promptRow}>
            <div className={styles.promptCopy}>
              <strong>Prompt</strong>
              <span>{card.prompt}</span>
            </div>
            <SourceImageThumbnail card={card} />
          </div>
        </div>

        {artifactUrl ? (
          <div className={styles.actions}>
            {revealablePathFromArtifactUrl(artifactUrl)
              ? <RevealInFolderButton path={revealablePathFromArtifactUrl(artifactUrl)} label={this.revealLabel()} />
              : (
                <a href={artifactUrl} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  {this.actionLabel(artifact)}
                </a>
              )}
          </div>
        ) : null}
      </section>
    );
  }
}

class ImageGenerationCardAdapter extends ApplicationGenerationCardAdapter {
  readonly kind = "image" as const;
  readonly title = "Image generation";
  readonly connectedAppFallback = "Connected image app";

  protected renderIcon(card: ChatApplicationGenerationCardData) {
    return card.status === "running" ? <Sparkles /> : <ImageIcon />;
  }

  protected primaryArtifact(card: ChatApplicationGenerationCardData) {
    return primaryArtifact(card, "image");
  }

  protected actionLabel() {
    return "Open image";
  }

  protected errorFallback() {
    return "The connected image app did not return an image.";
  }

  protected renderArtifact({ card, artifact }: ArtifactRendererInput) {
    return <ImageArtifactGallery card={card} fallback={artifact} />;
  }
}

class AudioGenerationCardAdapter extends ApplicationGenerationCardAdapter {
  readonly kind: "music" | "tts";
  readonly title: string;
  readonly connectedAppFallback: string;

  constructor(kind: "music" | "tts", title: string, connectedAppFallback: string) {
    super();
    this.kind = kind;
    this.title = title;
    this.connectedAppFallback = connectedAppFallback;
  }

  protected renderIcon(card: ChatApplicationGenerationCardData) {
    if (card.status === "running") return <Sparkles />;
    return this.kind === "tts" ? <Volume2 /> : <Music />;
  }

  protected primaryArtifact(card: ChatApplicationGenerationCardData) {
    return primaryArtifact(card, "audio");
  }

  protected actionLabel() {
    return "Open audio";
  }

  protected renderArtifact({ artifact }: ArtifactRendererInput) {
    const artifactUrl = normalizeApplicationGenerationUrl(artifact?.url);
    if (!artifactUrl) return null;
    return (
      <div className={styles.mediaFrame}>
        <audio controls src={artifactUrl} />
      </div>
    );
  }
}

class VideoGenerationCardAdapter extends ApplicationGenerationCardAdapter {
  readonly kind = "video" as const;
  readonly title = "Video generation";
  readonly connectedAppFallback = "Connected video app";

  protected renderIcon(card: ChatApplicationGenerationCardData) {
    return card.status === "running" ? <Sparkles /> : <Video />;
  }

  protected primaryArtifact(card: ChatApplicationGenerationCardData) {
    return primaryArtifact(card, "video");
  }

  protected actionLabel() {
    return "Open video";
  }

  protected renderArtifact({ artifact }: ArtifactRendererInput) {
    const artifactUrl = normalizeApplicationGenerationUrl(artifact?.url);
    if (!artifactUrl) return null;
    return (
      <div className={styles.mediaFrame}>
        <video controls src={artifactUrl} />
      </div>
    );
  }
}

class ModelGenerationCardAdapter extends ApplicationGenerationCardAdapter {
  readonly kind = "model3d" as const;
  readonly title = "3D model generation";
  readonly connectedAppFallback = "Connected 3D app";

  protected renderIcon(card: ChatApplicationGenerationCardData) {
    return card.status === "running" ? <Sparkles /> : <Box />;
  }

  protected primaryArtifact(card: ChatApplicationGenerationCardData) {
    return primaryArtifact(card, "model3d");
  }

  protected actionLabel() {
    return "Open model";
  }
}

const APPLICATION_CARD_ADAPTERS: Record<ChatApplicationGenerationKind, ApplicationGenerationCardAdapter> = {
  image: new ImageGenerationCardAdapter(),
  music: new AudioGenerationCardAdapter("music", "Music generation", "Connected music app"),
  tts: new AudioGenerationCardAdapter("tts", "TTS generation", "Connected voice app"),
  model3d: new ModelGenerationCardAdapter(),
  video: new VideoGenerationCardAdapter(),
};

export function ApplicationGenerationCard({ card }: { card: ChatApplicationGenerationCardData }) {
  return APPLICATION_CARD_ADAPTERS[card.kind].render(card);
}
