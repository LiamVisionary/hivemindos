import type { Metadata } from "next";
import Image from "next/image";
import {
  Activity,
  Bot,
  CheckCircle2,
  ExternalLink,
  LockKeyhole,
  Network,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  DesignSystemRuntimeStyles,
  HexCell,
  ProgressBar,
  Segmented,
  Skeleton,
  Spinner,
  StatusDot,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/design-system/ui";

import styles from "./design-system.module.css";

export const metadata: Metadata = {
  title: "Design System | HivemindOS",
  description: "HivemindOS design tokens, production UI primitives, assets, and static design kit previews.",
};

const colorTokens = [
  { name: "Honey", value: "#e7b45c", css: "var(--honey)" },
  { name: "Live", value: "#6fcdba", css: "var(--live)" },
  { name: "Panel", value: "#14161c", css: "var(--panel)" },
  { name: "Panel high", value: "#1e222b", css: "var(--panel-hi)" },
  { name: "Risk", value: "#e58e85", css: "var(--danger)" },
];

const staticPreviews = [
  {
    href: "/design-system/ui_kits/dashboard/index.html",
    title: "Dashboard recreation",
    description: "Original generated Fleet, Chat, and Wallets control-room kit.",
  },
  {
    href: "/design-system/components/core/core.card.html",
    title: "Standalone core card",
    description: "Generated HTML specimen for Button, Badge, Card, Checkbox, Segment, StatusDot, and code line.",
  },
  {
    href: "/design-system/components/feedback/feedback.card.html",
    title: "Standalone feedback card",
    description: "Generated HTML specimen for Tooltip, Spinner, Skeleton, and ProgressBar.",
  },
  {
    href: "/design-system/guidelines/colors-accent.html",
    title: "Accent tokens",
    description: "Generated color guideline card for honey actions and live mint signals.",
  },
];

const assetTiles = [
  { src: "/design-system/assets/logo/hivemindos-logo.png", alt: "HivemindOS logo" },
  { src: "/design-system/assets/logo/app-icon-1024.png", alt: "HivemindOS app icon" },
  { src: "/design-system/assets/brand/honey-hive-icon.png", alt: "Honey hive icon" },
  { src: "/design-system/assets/brand/honey-pot.png", alt: "Honey pot brand glyph" },
];

function SectionHeader({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy?: string;
}) {
  return (
    <div className={styles.sectionHeader}>
      <div>
        <div className={styles.eyebrow}>{eyebrow}</div>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {copy ? <p className={styles.sectionCopy}>{copy}</p> : null}
      </div>
    </div>
  );
}

export default function DesignSystemPage() {
  return (
    <main className={styles.page}>
      <DesignSystemRuntimeStyles />
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.brandLockup}>
            <Image
              className={styles.appIcon}
              src="/design-system/assets/logo/app-icon-1024.png"
              alt="HivemindOS app icon"
              width={152}
              height={152}
              priority
            />
            <div>
              <div className={styles.eyebrow}>HivemindOS design system</div>
              <h1 className={styles.title}>Private swarm command</h1>
              <p className={styles.lede}>
                Production-ready tokens, primitives, brand assets, and the generated standalone kit now live inside
                this project. This route renders the TSX primitives through the real Next app path.
              </p>
            </div>
          </div>
          <div className={styles.heroActions}>
            <Button asChild>
              <a href="/design-system/ui_kits/dashboard/index.html" target="_blank" rel="noreferrer">
                <ExternalLink />
                Open standalone kit
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="/design-system/readme.md" target="_blank" rel="noreferrer">
                Read source guide
              </a>
            </Button>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeader
            eyebrow="Tokens"
            title="Color, type, spacing, motion"
            copy="The preview scope uses the imported honey-first palette so the app shell is not globally reskinned."
          />
          <div className={styles.swatchGrid}>
            {colorTokens.map((token) => (
              <div className={styles.swatch} key={token.name}>
                <div className={styles.swatchColor} style={{ background: token.css }} />
                <div>
                  <div className={styles.swatchName}>{token.name}</div>
                  <div className={styles.swatchValue}>{token.value}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeader
            eyebrow="Primitives"
            title="Core controls"
            copy="Buttons and badges are pill-shaped; mint is reserved for live or working state."
          />
          <div className={styles.twoColumnGrid}>
            <Card className={styles.wideCard}>
              <CardHeader>
                <CardTitle>Controls</CardTitle>
                <CardDescription>Button, Badge, StatusDot, Checkbox, Segmented, Tooltip.</CardDescription>
              </CardHeader>
              <CardContent className={styles.componentStack}>
                <div className={styles.row}>
                  <Button>Set up wallet</Button>
                  <Button variant="secondary">Configure</Button>
                  <Button variant="outline">Details</Button>
                  <Button variant="ghost">Skip</Button>
                  <Button variant="danger">Remove</Button>
                </div>
                <div className={styles.row}>
                  <Button size="xs">xs</Button>
                  <Button size="sm">sm</Button>
                  <Button size="lg">large</Button>
                  <Button isLoading>Working</Button>
                </div>
                <div className={styles.row}>
                  <Badge variant="success">Healthy</Badge>
                  <Badge variant="warning">Needs funding</Badge>
                  <Badge variant="danger">Requires approval</Badge>
                  <Badge variant="honey" mono>
                    Queen
                  </Badge>
                  <Badge variant="outline">Read-only</Badge>
                </div>
                <div className={styles.row}>
                  <StatusDot tone="working" label="Working" />
                  <StatusDot tone="healthy" label="Healthy" />
                  <StatusDot tone="scheduled" label="Scheduled" />
                  <StatusDot tone="danger" label="Auth failed" />
                </div>
                <div className={styles.row}>
                  <label className={styles.checkRow}>
                    <Checkbox defaultChecked aria-label="Read-only collector" />
                    Read-only collector
                  </label>
                  <label className={styles.checkRow}>
                    <Checkbox aria-label="Require approval" />
                    Require approval
                  </label>
                </div>
                <div className={styles.row}>
                  <Segmented options={["Hive", "Graph", "Map", "List"]} defaultValue="Hive" />
                  <Segmented
                    variant="solid"
                    options={[
                      { value: "buy", label: "Buy" },
                      { value: "sell", label: "Sell", tone: "sell" },
                    ]}
                    defaultValue="buy"
                  />
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm">
                          Tailnet-only
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Private network access only; no public port is opened.</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Fleet cell</CardTitle>
                <CardDescription>One card, one main job, with attributed status.</CardDescription>
              </CardHeader>
              <CardContent className={styles.componentStack}>
                <div className={styles.row}>
                  <Network size={18} />
                  <div>
                    <div className={styles.miniLabel}>Atlas</div>
                    <p className={styles.monoLine}>atlas.tailnet.example - macOS - 3 agents</p>
                  </div>
                </div>
                <ProgressBar value={68} tone="live" label="Fleet availability" />
                <ProgressBar value={42} tone="honey" label="Budget runway" />
                <ProgressBar indeterminate tone="honey" label="Discovering machines" />
              </CardContent>
              <CardFooter>
                <Button size="sm">
                  <Activity />
                  Open details
                </Button>
                <Button size="sm" variant="outline">
                  Inspect logs
                </Button>
              </CardFooter>
            </Card>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeader
            eyebrow="Brand"
            title="Honeycomb assets"
            copy="The app icon, glyphs, and role portraits are mirrored under public/design-system for browser previews."
          />
          <div className={styles.cardGrid}>
            <Card>
              <CardHeader>
                <CardTitle>Agent hex cells</CardTitle>
                <CardDescription>Portraits sit inside the signature hex motif.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className={styles.agentGrid}>
                  <div className={styles.hexWrap}>
                    <HexCell tone="honey" size={94} selected pulse>
                      <Image
                        className={styles.hexImage}
                        src="/design-system/assets/bees/queen-bee.png"
                        alt="Queen agent portrait"
                        width={90}
                        height={90}
                      />
                    </HexCell>
                    <Badge variant="honey" mono>
                      Queen
                    </Badge>
                  </div>
                  <div className={styles.hexWrap}>
                    <HexCell tone="live" size={86} pulse>
                      <Image
                        className={styles.hexImage}
                        src="/design-system/assets/bees/worker-bee-code.png"
                        alt="Coder agent portrait"
                        width={86}
                        height={86}
                      />
                    </HexCell>
                    <Badge variant="live" mono>
                      Coder
                    </Badge>
                  </div>
                  <div className={styles.hexWrap}>
                    <HexCell tone="neutral" size={86}>
                      <Bot size={42} strokeWidth={1.7} />
                    </HexCell>
                    <Badge variant="secondary" mono>
                      General
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Asset shelf</CardTitle>
                <CardDescription>Logo, app mark, and supporting brand glyphs.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className={styles.assetStrip}>
                  {assetTiles.map((asset) => (
                    <div className={styles.assetTile} key={asset.src}>
                      <Image src={asset.src} alt={asset.alt} width={180} height={180} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Trust language</CardTitle>
                <CardDescription>Plain labels for private, local-first operating state.</CardDescription>
              </CardHeader>
              <CardContent className={styles.componentStack}>
                <div className={styles.row}>
                  <Badge variant="outline">
                    <LockKeyhole />
                    Stored locally
                  </Badge>
                  <Badge variant="success">
                    <ShieldCheck />
                    Tailnet-only
                  </Badge>
                </div>
                <div className={styles.row}>
                  <Badge variant="warning">
                    <WalletCards />
                    Needs funding
                  </Badge>
                  <Badge variant="live">
                    <CheckCircle2 />
                    Agent is working
                  </Badge>
                </div>
                <p className={styles.monoLine}>
                  Coordination keeps attribution: Planner created the task, Coder made changes, Reviewer flagged risk.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeader
            eyebrow="Feedback"
            title="Loading and progress states"
            copy="Pending UI uses motion: spinners for inline work, skeletons for regions, bars for progress."
          />
          <div className={styles.cardGrid}>
            <Card>
              <CardHeader>
                <CardTitle>Inline busy</CardTitle>
                <CardDescription>Spinner with a clear text label.</CardDescription>
              </CardHeader>
              <CardContent className={styles.componentStack}>
                <Spinner label="Checking collector health" />
                <Spinner tone="live" label="Agent is streaming" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Region skeleton</CardTitle>
                <CardDescription>Mirrors the shape of future content.</CardDescription>
              </CardHeader>
              <CardContent className={styles.componentStack} role="status" aria-label="Loading fleet rows">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-24 w-full rounded-[14px]" />
                <Skeleton className="h-4 w-4/5" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Progress meters</CardTitle>
                <CardDescription>Deterministic values and indeterminate waits.</CardDescription>
              </CardHeader>
              <CardContent className={styles.componentStack}>
                <ProgressBar value={82} tone="live" label="Setup complete" />
                <ProgressBar value={26} tone="danger" label="Budget risk" />
                <ProgressBar indeterminate thickness={4} label="Syncing design assets" />
              </CardContent>
            </Card>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeader
            eyebrow="Static kit"
            title="Generated HTML previews"
            copy="These links render the original generated package from public/design-system."
          />
          <div className={styles.staticLinks}>
            {staticPreviews.map((preview) => (
              <a className={styles.staticLink} href={preview.href} key={preview.href} target="_blank" rel="noreferrer">
                <strong>{preview.title}</strong>
                <span>{preview.description}</span>
              </a>
            ))}
          </div>
          <p className={styles.footerNote}>
            Source package: design-system/. Browser mirror: public/design-system/. Production components:
            src/design-system/ui/.
          </p>
        </section>
      </div>
    </main>
  );
}
