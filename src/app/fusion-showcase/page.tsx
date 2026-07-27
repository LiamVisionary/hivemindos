import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import {
  AppWindow,
  Bot,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Database,
  FileCheck2,
  Filter,
  GitBranch,
  MessageSquare,
  Network,
  PackageCheck,
  Play,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import styles from "./fusion-showcase.module.css";

type FusionSkillCard = {
  name: string;
  slug: string;
  description: string;
  signal: string;
  accent: string;
  kind: "skill" | "workflow" | "aeon";
};

type FusionStep = {
  label: string;
  detail: string;
  icon: LucideIcon;
  tone: "teal" | "gold" | "violet";
};

type WorkflowNode = {
  label: string;
  detail: string;
  logoSrc: string;
  logoAlt: string;
  tone: "teal" | "gold" | "violet" | "blue" | "black";
  meta: string;
};

type WorkflowReceipt = {
  label: string;
  detail: string;
  icon: LucideIcon;
};

type FusionLogo = {
  label: string;
  src: string;
  alt: string;
  tone: "teal" | "gold" | "violet" | "blue" | "black";
};

const fusionSkills: FusionSkillCard[] = [
  {
    name: "Hive Skill Fusion",
    slug: "hive-skill-fusion",
    description: "Turns a natural-language capability request into a durable shared skill by discovering and combining the best available tools, apps, agents, credentials, and delivery channels.",
    signal: "Reusable skill synthesis",
    accent: "#5f8f5a",
    kind: "skill",
  },
  {
    name: "Hive Workflow Fusion",
    slug: "hive-workflow-fusion",
    description: "Builds and runs an adaptive execution graph for a multi-step task, choosing operators, sequencing handoffs, verifying artifacts, and requiring real delivery receipts.",
    signal: "End-to-end orchestration",
    accent: "#e6bb5c",
    kind: "workflow",
  },
  {
    name: "Hive AEON Fusion",
    slug: "hive-aeon-fusion",
    description: "Converts fused skills and workflows into AEON-ready background duties with cadence, readiness checks, retry policy, artifact paths, and approval gates.",
    signal: "Autonomous duty conversion",
    accent: "#7f6bb2",
    kind: "aeon",
  },
];

const fusionSteps: FusionStep[] = [
  { label: "Prompt", detail: "Goal, constraints, side effects", icon: MessageSquare, tone: "teal" },
  { label: "Retrieve", detail: "Skills, tools, apps, agents", icon: Search, tone: "teal" },
  { label: "Rank", detail: "Best fit, cost, safety, proof", icon: Filter, tone: "gold" },
  { label: "Fuse", detail: "Capability map and graph", icon: GitBranch, tone: "gold" },
  { label: "Verify", detail: "Artifacts, receipts, dry runs", icon: CheckCircle2, tone: "violet" },
  { label: "Deliver", detail: "Skill, workflow, AEON duty", icon: Send, tone: "violet" },
];

const testedWorkflowNodes: WorkflowNode[] = [
  {
    label: "X research",
    detail: "Pull current social signal from the configured X-capable path.",
    logoSrc: "/fusion/logos/x.svg",
    logoAlt: "X logo",
    tone: "black",
    meta: "source",
  },
  {
    label: "Obsidian brain",
    detail: "Retrieve shared skills, Liam style context, and hive memory.",
    logoSrc: "/fusion/logos/obsidian.svg",
    logoAlt: "Obsidian logo",
    tone: "violet",
    meta: "RAG",
  },
  {
    label: "Writer bee",
    detail: "Draft the post with the app's real writer subclass.",
    logoSrc: "/icons/worker-bee-writer-v2.png",
    logoAlt: "HivemindOS writer bee subclass icon",
    tone: "gold",
    meta: "agent",
  },
  {
    label: "ComfyUI image",
    detail: "Generate a matching visual through the discovered image app.",
    logoSrc: "/fusion/logos/comfyui.svg",
    logoAlt: "ComfyUI logo",
    tone: "blue",
    meta: "image",
  },
  {
    label: "Telegram send",
    detail: "Deliver the final artifact to the user's configured channel.",
    logoSrc: "/fusion/logos/telegram.svg",
    logoAlt: "Telegram logo",
    tone: "teal",
    meta: "receipt",
  },
];

const workflowReceipts: WorkflowReceipt[] = [
  { label: "Discovered", detail: "No provider hard-code", icon: Search },
  { label: "Fused", detail: "Research + brain + writer + image + delivery", icon: GitBranch },
  { label: "Proved", detail: "Artifacts and message receipt required", icon: CheckCircle2 },
];

const workflowLogos: FusionLogo[] = [
  { label: "X", src: "/fusion/logos/x.svg", alt: "X logo", tone: "black" },
  { label: "Brain", src: "/fusion/logos/obsidian.svg", alt: "Obsidian logo", tone: "violet" },
  { label: "Writer", src: "/icons/worker-bee-writer-v2.png", alt: "HivemindOS writer bee subclass icon", tone: "gold" },
  { label: "Image", src: "/fusion/logos/comfyui.svg", alt: "ComfyUI logo", tone: "blue" },
  { label: "Send", src: "/fusion/logos/telegram.svg", alt: "Telegram logo", tone: "teal" },
];

function OrbitingCircles({
  children,
  duration = 24,
  iconSize = 54,
  radius = 96,
  reverse = false,
}: {
  children: ReactNode[];
  duration?: number;
  iconSize?: number;
  radius?: number;
  reverse?: boolean;
}) {
  return (
    <div
      className={`${styles.orbitingCircles} ${reverse ? styles.reverse : ""}`}
      style={{
        "--duration": `${duration}s`,
        "--icon-size": `${iconSize}px`,
        "--radius": `${radius}px`,
      } as CSSProperties}
    >
      {children.map((child, index) => (
        <span
          className={styles.orbitItem}
          key={index}
          style={{
            "--count": children.length,
            "--index": index,
          } as CSSProperties}
        >
          {child}
        </span>
      ))}
    </div>
  );
}

function OrbitIcon({ icon: Icon, tone = "teal" }: { icon: LucideIcon; tone?: "teal" | "gold" | "violet" }) {
  return (
    <span className={`${styles.orbitIcon} ${styles[tone]}`}>
      <Icon aria-hidden="true" />
    </span>
  );
}

function LogoMark({ logo, size = 48 }: { logo: FusionLogo; size?: number }) {
  return (
    <span
      className={`${styles.logoTile} ${styles[logo.tone]}`}
      style={{
        "--logo-image-size": `${size}px`,
        "--logo-tile-size": `${Math.max(size + 20, 58)}px`,
      } as CSSProperties}
    >
      <Image className={styles.logoImage} src={logo.src} alt={logo.alt} width={size} height={size} unoptimized />
    </span>
  );
}

function SpecificSkillIllustration({ kind }: { kind: FusionSkillCard["kind"] }) {
  if (kind === "workflow") {
    return (
      <div className={`${styles.skillArt} ${styles.specificWorkflowArt}`} role="img" aria-label="Hive Workflow Fusion tested workflow illustration">
        <div className={styles.cardMiniFlow}>
          {workflowLogos.map((logo) => (
            <div className={styles.cardMiniNode} key={logo.label}>
              <LogoMark logo={logo} size={42} />
              <span>{logo.label}</span>
            </div>
          ))}
        </div>
        <div className={styles.cardProofStrip}>
          <span><Search aria-hidden="true" /> discover</span>
          <span><GitBranch aria-hidden="true" /> sequence</span>
          <span><CheckCircle2 aria-hidden="true" /> receipt</span>
        </div>
      </div>
    );
  }

  if (kind === "aeon") {
    return (
      <div className={`${styles.skillArt} ${styles.specificAeonArt}`} role="img" aria-label="Hive AEON Fusion tested workflow illustration">
        <div className={styles.aeonBadge}>
          <span>AEON</span>
          <Clock3 aria-hidden="true" />
        </div>
        <div className={styles.aeonLogoRing}>
          {workflowLogos.map((logo) => (
            <div className={styles.aeonLogoNode} key={logo.label}>
              <LogoMark logo={logo} size={40} />
            </div>
          ))}
        </div>
        <div className={styles.cardProofStrip}>
          <span><RefreshCcw aria-hidden="true" /> retry</span>
          <span><ShieldCheck aria-hidden="true" /> approval</span>
          <span><Send aria-hidden="true" /> deliver</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.skillArt} ${styles.specificSkillArt}`} role="img" aria-label="Hive Skill Fusion tested workflow illustration">
      <div className={styles.logoCluster}>
        {workflowLogos.map((logo) => (
          <div className={styles.logoClusterItem} key={logo.label}>
            <LogoMark logo={logo} />
            <span>{logo.label}</span>
          </div>
        ))}
      </div>
      <div className={styles.fusionPackage}>
        <PackageCheck aria-hidden="true" />
        <span>new skill</span>
      </div>
    </div>
  );
}

function GenericSkillIllustration({ kind }: { kind: FusionSkillCard["kind"] }) {
  if (kind === "workflow") {
    const workflowNodes = [
      { icon: Search, label: "Find", tone: "teal" },
      { icon: Filter, label: "Select", tone: "gold" },
      { icon: Play, label: "Run", tone: "teal" },
      { icon: ShieldCheck, label: "Prove", tone: "violet" },
    ] satisfies Array<{ icon: LucideIcon; label: string; tone: "teal" | "gold" | "violet" }>;

    return (
      <div className={`${styles.skillArt} ${styles.workflowArt}`} role="img" aria-label="Hive Workflow Fusion illustration">
        <div className={styles.receiptRow} aria-hidden="true">
          <span><FileCheck2 aria-hidden="true" /></span>
          <span><BrainCircuit aria-hidden="true" /></span>
          <span><CheckCircle2 aria-hidden="true" /></span>
        </div>
        <div className={styles.pipeline}>
          {workflowNodes.map((node) => {
            const Icon = node.icon;
            return (
              <div className={`${styles.pipelineNode} ${styles[node.tone]}`} key={node.label}>
                <Icon aria-hidden="true" />
              </div>
            );
          })}
          <div className={styles.outputCapsule}>
            <PackageCheck aria-hidden="true" />
          </div>
        </div>
      </div>
    );
  }

  if (kind === "aeon") {
    return (
      <div className={`${styles.skillArt} ${styles.aeonArt}`} role="img" aria-label="Hive AEON Fusion illustration">
        <div className={styles.visualCore}>
          <Bot aria-hidden="true" />
        </div>
        <OrbitingCircles duration={28} radius={100}>
          {[
            <OrbitIcon icon={Clock3} tone="gold" key="clock" />,
            <OrbitIcon icon={AppWindow} key="apps" />,
            <OrbitIcon icon={ShieldCheck} tone="violet" key="gate" />,
            <OrbitIcon icon={RefreshCcw} tone="gold" key="retry" />,
            <OrbitIcon icon={Database} key="memory" />,
          ]}
        </OrbitingCircles>
        <OrbitingCircles duration={18} iconSize={38} radius={62} reverse>
          {[
            <OrbitIcon icon={FileCheck2} tone="violet" key="artifact" />,
            <OrbitIcon icon={Network} key="network" />,
            <OrbitIcon icon={CheckCircle2} tone="gold" key="check" />,
          ]}
        </OrbitingCircles>
      </div>
    );
  }

  return (
    <div className={`${styles.skillArt} ${styles.skillFusionArt}`} role="img" aria-label="Hive Skill Fusion illustration">
      <div className={styles.visualCore}>
        <Sparkles aria-hidden="true" />
      </div>
      <OrbitingCircles duration={26} radius={98}>
        {[
          <OrbitIcon icon={Wrench} tone="gold" key="tools" />,
          <OrbitIcon icon={Bot} tone="gold" key="agents" />,
          <OrbitIcon icon={Boxes} tone="violet" key="apps" />,
          <OrbitIcon icon={Database} key="memory" />,
          <OrbitIcon icon={Send} tone="violet" key="delivery" />,
        ]}
      </OrbitingCircles>
      <OrbitingCircles duration={17} iconSize={38} radius={58} reverse>
        {[
          <OrbitIcon icon={BrainCircuit} tone="violet" key="brain" />,
          <OrbitIcon icon={Network} key="map" />,
          <OrbitIcon icon={PackageCheck} tone="gold" key="package" />,
        ]}
      </OrbitingCircles>
    </div>
  );
}

function FusionInfographic() {
  return (
    <section className={styles.infographic} aria-labelledby="fusion-map-title">
      <div className={styles.infographicCopy}>
        <p className={styles.eyebrow}>How fusion works</p>
        <h2 id="fusion-map-title">The agent does not memorize a provider. It retrieves the parts, ranks them, fuses the run, then proves the result.</h2>
      </div>

      <ol className={styles.fusionFlow} aria-label="Fusion flow steps">
        {fusionSteps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li className={styles.flowStep} key={step.label}>
              <span className={`${styles.flowIcon} ${styles[step.tone]}`}>
                <Icon aria-hidden="true" />
              </span>
              <div>
                <em>{index + 1}</em>
                <strong>{step.label}</strong>
                <p>{step.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SpecificWorkflowShowcase() {
  return (
    <section className={styles.workflowShowcase} aria-labelledby="specific-workflow-title">
      <div className={styles.workflowCopy}>
        <p className={styles.eyebrow}>Specific tested workflow</p>
        <h2 id="specific-workflow-title">Base news into an X post, generated image, and Telegram delivery.</h2>
        <p>
          Fusion looks up the available runtime parts, chooses the best configured path for each job, and produces a real delivery receipt instead of stopping at a plan.
        </p>
      </div>

      <div className={styles.workflowCanvas} role="img" aria-label="Specific hive workflow fusion using X, Obsidian, writer bee, ComfyUI, and Telegram">
        <div className={styles.workflowTrack}>
          {testedWorkflowNodes.map((node, index) => (
            <div className={styles.workflowNode} key={node.label}>
              <span className={styles.nodeIndex}>{String(index + 1).padStart(2, "0")}</span>
              <LogoMark logo={{ label: node.label, src: node.logoSrc, alt: node.logoAlt, tone: node.tone }} />
              <strong>{node.label}</strong>
              <p>{node.detail}</p>
              <em>{node.meta}</em>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.receiptGrid} aria-label="Workflow proof points">
        {workflowReceipts.map((receipt) => {
          const Icon = receipt.icon;
          return (
            <div className={styles.receiptChip} key={receipt.label}>
              <Icon aria-hidden="true" />
              <span>
                <strong>{receipt.label}</strong>
                <small>{receipt.detail}</small>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function FusionShowcasePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="fusion-showcase-title">
        <p className={styles.eyebrow}>HivemindOS packaged skills</p>
        <h1 id="fusion-showcase-title">Hive fusion skills turn loose intent into executable agent systems.</h1>
        <p className={styles.lede}>
          Each card represents a packaged auto-install skill that helps agents discover the current runtime, select the best available parts, and produce verified outcomes without hard-coding providers. The first workflow below uses real logos from one of the end-to-end tests.
        </p>
      </section>

      <SpecificWorkflowShowcase />

      <section className={styles.backupSection} aria-labelledby="fusion-cards-title">
        <div className={styles.backupHeader}>
          <p className={styles.eyebrow}>Hive fusion skill cards</p>
          <h2 id="fusion-cards-title">Each packaged skill now shows the concrete tested workflow parts.</h2>
        </div>
        <div className={styles.cardGrid} aria-label="Hive fusion skill cards with specific workflow icons">
          {fusionSkills.map((skill) => (
            <article className={styles.skillCard} key={skill.slug} style={{ "--skill-accent": skill.accent } as CSSProperties}>
              <div className={styles.artFrame}>
                <SpecificSkillIllustration kind={skill.kind} />
              </div>
              <div className={styles.cardBody}>
                <div className={styles.cardMeta}>
                  <span>{skill.signal}</span>
                  <code>{skill.slug}</code>
                </div>
                <h2>{skill.name}</h2>
                <p>{skill.description}</p>
              </div>
            </article>
          ))}
        </div>

        <details className={styles.backupDetails}>
          <summary>Show generic backup cards</summary>
          <div className={styles.cardGrid} aria-label="Generic backup hive skill fusion cards">
            {fusionSkills.map((skill) => (
              <article className={styles.skillCard} key={skill.slug} style={{ "--skill-accent": skill.accent } as CSSProperties}>
                <div className={styles.artFrame}>
                  <GenericSkillIllustration kind={skill.kind} />
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.cardMeta}>
                    <span>{skill.signal}</span>
                    <code>{skill.slug}</code>
                  </div>
                  <h2>{skill.name}</h2>
                  <p>{skill.description}</p>
                </div>
              </article>
            ))}
          </div>
        </details>
      </section>

      <FusionInfographic />
    </main>
  );
}
