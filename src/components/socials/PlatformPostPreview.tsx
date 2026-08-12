"use client";

import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  CheckCircle2,
  ExternalLink,
  Eye,
  Globe2,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Send,
  Share2,
  ThumbsUp,
} from "lucide-react";

import type { SocialsAccountView } from "@/components/socials/socials-context";
import type { SocialEngagementTarget, SocialPlatform, SocialQueueItem } from "@/lib/services/socials/socials-types";

import styles from "./PlatformPostPreview.module.css";

type DraftKind = "post" | "reply" | "quote";

type PlatformPostPreviewProps = {
  account: SocialsAccountView | null;
  item: SocialQueueItem;
  kind: DraftKind;
  text: string;
  onTextChange: (text: string) => void;
};

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  x: "X",
  telegram: "Telegram",
  farcaster: "Farcaster",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  facebook: "Facebook",
};

function cleanHandle(value: string): string {
  return value.trim().replace(/^@/, "").split(":").at(-1) || "account";
}

function accountIdentity(account: SocialsAccountView | null, item: SocialQueueItem) {
  const handle = cleanHandle(account?.handle || item.accountId);
  return {
    handle,
    name: account?.displayName?.trim() || handle,
  };
}

function initials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return value.replace(/^@/, "").slice(0, 2).toUpperCase() || "HM";
}

function formatMetric(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatTargetDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)
    : "recently";
}

function BrandMark({ platform }: { platform: SocialPlatform }) {
  if (platform === "telegram") return <Send aria-hidden="true" width={17} />;
  return <span aria-hidden="true">{platform === "x" ? "X" : platform === "linkedin" ? "in" : platform === "reddit" ? "r/" : platform === "facebook" ? "f" : "F"}</span>;
}

function Avatar({ name, platform }: { name: string; platform: SocialPlatform }) {
  return <span className={styles.avatar} data-avatar-platform={platform} aria-hidden="true">{initials(name)}</span>;
}

function DraftEditor({ platform, text, onTextChange }: {
  platform: SocialPlatform;
  text: string;
  onTextChange: (text: string) => void;
}) {
  return (
    <label className={styles.editor}>
      <span className={styles.srOnly}>Edit {PLATFORM_LABEL[platform]} draft</span>
      <textarea
        data-social-focus-editor
        aria-label={`Edit ${PLATFORM_LABEL[platform]} draft`}
        className={styles.textarea}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        rows={Math.min(12, Math.max(3, text.split("\n").length + Math.ceil(text.length / 76)))}
      />
    </label>
  );
}

function Action({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <span className={styles.action}>{icon}<span>{label}</span></span>;
}

function TargetCard({ target, mode = "quote" }: { target: SocialEngagementTarget; mode?: "reply" | "quote" }) {
  const metrics = [
    `${formatMetric(target.metrics.replies)} replies`,
    `${formatMetric(target.metrics.reposts)} reposts`,
    `${formatMetric(target.metrics.likes)} likes`,
    ...(typeof target.metrics.views === "number" ? [`${formatMetric(target.metrics.views)} views`] : []),
  ];
  return (
    <div className={styles.target} data-mode={mode} data-testid="social-engagement-target">
      <div className={styles.targetHeader}>
        <span className={styles.targetIdentity}>
          <strong>{target.authorName || `@${target.authorHandle}`}</strong>
          {target.authorVerified ? <CheckCircle2 aria-label="Verified" width={14} /> : null}
          <span>@{target.authorHandle} · {formatTargetDate(target.createdAt)}</span>
        </span>
        <a href={target.url} target="_blank" rel="noreferrer">Open target <ExternalLink aria-hidden="true" width={12} /></a>
      </div>
      <p>{target.text}</p>
      <div className={styles.targetMetrics}>{metrics.join(" · ")}</div>
    </div>
  );
}

function XPreview({ account, item, kind, text, onTextChange }: PlatformPostPreviewProps) {
  const identity = accountIdentity(account, item);
  const target = item.generation?.target;
  return (
    <article className={styles.preview} data-platform="x" data-testid="social-platform-preview">
      {kind === "reply" && target ? <TargetCard target={target} mode="reply" /> : null}
      <div className={styles.xPost}>
        <Avatar name={identity.name} platform="x" />
        <div className={styles.xBody}>
          <header className={styles.identityRow}>
            <span><strong>{identity.name}</strong><span>@{identity.handle} · Draft</span></span>
            <MoreHorizontal aria-hidden="true" width={19} />
          </header>
          {kind === "reply" && target ? <div className={styles.replying}>Replying to <span>@{target.authorHandle}</span></div> : null}
          <DraftEditor platform="x" text={text} onTextChange={onTextChange} />
          {kind === "quote" && target ? <TargetCard target={target} /> : null}
          <div className={styles.actions}>
            <Action icon={<MessageCircle aria-hidden="true" width={17} />} label="Reply" />
            <Action icon={<Repeat2 aria-hidden="true" width={18} />} label="Repost" />
            <Action icon={<Heart aria-hidden="true" width={17} />} label="Like" />
            <Action icon={<Bookmark aria-hidden="true" width={17} />} label="Save" />
            <Action icon={<Share2 aria-hidden="true" width={17} />} label="Share" />
          </div>
        </div>
      </div>
    </article>
  );
}

function RedditPreview({ account, item, text, onTextChange }: PlatformPostPreviewProps) {
  const identity = accountIdentity(account, item);
  const subreddit = cleanHandle(item.subreddit || account?.binding?.defaultSubreddit || "community");
  return (
    <article className={styles.preview} data-platform="reddit" data-testid="social-platform-preview">
      <header className={styles.redditHeader}>
        <span className={styles.brand}><BrandMark platform="reddit" /></span>
        <span><strong>r/{subreddit}</strong><span>Posted by u/{identity.handle} · Draft</span></span>
        <span className={styles.redditJoin}>Join</span>
      </header>
      <div className={styles.redditPost}>
        <div className={styles.voteRail} aria-hidden="true"><ArrowUp width={18} /><strong>Vote</strong><ArrowDown width={18} /></div>
        <div className={styles.redditBody}>
          {item.title ? <h2>{item.title}</h2> : <h2 className={styles.placeholderTitle}>Untitled post</h2>}
          <DraftEditor platform="reddit" text={text} onTextChange={onTextChange} />
          <div className={styles.actions}>
            <Action icon={<MessageCircle aria-hidden="true" width={17} />} label="Comments" />
            <Action icon={<Share2 aria-hidden="true" width={17} />} label="Share" />
            <Action icon={<Bookmark aria-hidden="true" width={17} />} label="Save" />
          </div>
        </div>
      </div>
    </article>
  );
}

function LinkedInPreview({ account, item, text, onTextChange }: PlatformPostPreviewProps) {
  const identity = accountIdentity(account, item);
  return (
    <article className={styles.preview} data-platform="linkedin" data-testid="social-platform-preview">
      <div className={styles.standardPost}>
        <header className={styles.profileHeader}>
          <Avatar name={identity.name} platform="linkedin" />
          <span className={styles.profileIdentity}><strong>{identity.name}</strong><span>@{identity.handle}</span><span>Draft · <Globe2 aria-label="Public" width={12} /></span></span>
          <MoreHorizontal aria-hidden="true" width={20} />
        </header>
        <DraftEditor platform="linkedin" text={text} onTextChange={onTextChange} />
        <div className={styles.engagementSummary}><span>Be the first to react</span><span>0 comments</span></div>
        <div className={styles.actions}>
          <Action icon={<ThumbsUp aria-hidden="true" width={18} />} label="Like" />
          <Action icon={<MessageCircle aria-hidden="true" width={18} />} label="Comment" />
          <Action icon={<Repeat2 aria-hidden="true" width={18} />} label="Repost" />
          <Action icon={<Send aria-hidden="true" width={18} />} label="Send" />
        </div>
      </div>
    </article>
  );
}

function FacebookPreview({ account, item, text, onTextChange }: PlatformPostPreviewProps) {
  const identity = accountIdentity(account, item);
  return (
    <article className={styles.preview} data-platform="facebook" data-testid="social-platform-preview">
      <div className={styles.standardPost}>
        <header className={styles.profileHeader}>
          <Avatar name={identity.name} platform="facebook" />
          <span className={styles.profileIdentity}><strong>{identity.name}</strong><span>Draft · <Globe2 aria-label="Public" width={12} /></span></span>
          <MoreHorizontal aria-hidden="true" width={20} />
        </header>
        <DraftEditor platform="facebook" text={text} onTextChange={onTextChange} />
        <div className={styles.engagementSummary}><span>Draft preview</span><span>0 comments · 0 shares</span></div>
        <div className={styles.actions}>
          <Action icon={<ThumbsUp aria-hidden="true" width={18} />} label="Like" />
          <Action icon={<MessageCircle aria-hidden="true" width={18} />} label="Comment" />
          <Action icon={<Share2 aria-hidden="true" width={18} />} label="Share" />
        </div>
      </div>
    </article>
  );
}

function TelegramPreview({ account, item, text, onTextChange }: PlatformPostPreviewProps) {
  const identity = accountIdentity(account, item);
  return (
    <article className={styles.preview} data-platform="telegram" data-testid="social-platform-preview">
      <div className={styles.telegramScene}>
        <Avatar name={identity.name} platform="telegram" />
        <div className={styles.telegramBubble}>
          <header><strong>{identity.name}</strong><span>@{identity.handle}</span></header>
          <DraftEditor platform="telegram" text={text} onTextChange={onTextChange} />
          <footer><span><Eye aria-hidden="true" width={13} /> Preview</span><span>Draft ✓✓</span></footer>
        </div>
        <span className={styles.telegramForward} aria-hidden="true"><Share2 width={16} /></span>
      </div>
    </article>
  );
}

function FarcasterPreview({ account, item, text, onTextChange }: PlatformPostPreviewProps) {
  const identity = accountIdentity(account, item);
  return (
    <article className={styles.preview} data-platform="farcaster" data-testid="social-platform-preview">
      <div className={styles.farcasterPost}>
        <Avatar name={identity.name} platform="farcaster" />
        <div className={styles.farcasterBody}>
          <header className={styles.identityRow}>
            <span><strong>{identity.name}</strong><span>@{identity.handle} · Draft</span></span>
            <MoreHorizontal aria-hidden="true" width={19} />
          </header>
          <DraftEditor platform="farcaster" text={text} onTextChange={onTextChange} />
          <div className={styles.actions}>
            <Action icon={<MessageCircle aria-hidden="true" width={17} />} label="Reply" />
            <Action icon={<Repeat2 aria-hidden="true" width={18} />} label="Recast" />
            <Action icon={<Heart aria-hidden="true" width={17} />} label="Like" />
            <Action icon={<Share2 aria-hidden="true" width={17} />} label="Share" />
          </div>
        </div>
      </div>
    </article>
  );
}

export function PlatformPostPreview(props: PlatformPostPreviewProps) {
  if (props.item.platform === "x") return <XPreview {...props} />;
  if (props.item.platform === "reddit") return <RedditPreview {...props} />;
  if (props.item.platform === "linkedin") return <LinkedInPreview {...props} />;
  if (props.item.platform === "facebook") return <FacebookPreview {...props} />;
  if (props.item.platform === "telegram") return <TelegramPreview {...props} />;
  return <FarcasterPreview {...props} />;
}
