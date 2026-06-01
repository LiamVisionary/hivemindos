import type { ComponentType, ReactNode } from "react";

type ClassFn = (...classes: Array<string | false | null | undefined>) => string;

type ButtonProps = {
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  size?: "sm" | string;
  type?: "button" | string;
  variant?: "secondary" | string;
};

type BrainServiceSection = {
  id: string;
  icon: ReactNode;
  label: string;
};

type BrainServiceOverviewCard = {
  action: string;
  bullets?: ReactNode[];
  canToggle?: boolean;
  detail: ReactNode;
  enabled?: boolean;
  eyebrow: string;
  icon: ReactNode;
  id: string;
  installAction?: {
    disabled?: boolean;
    icon?: ReactNode;
    label: string;
    onClick?: () => void;
    progressLabel?: string;
    setupSteps?: string[];
    state?: "failed" | "install" | "installing" | "installed" | "success";
  };
  onToggle?: (enabled: boolean) => void;
  status: string;
  title: string;
  tone: "idle" | "live" | string;
  toggleLabel?: string;
};

export function BrainServiceRunResult({ label, output, status }: { label: string; output?: string; status?: string }) {
  const text = String(output || "").trim();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const artifact = lines.find((line) => line.toLowerCase().startsWith("artifacts:"));
  const verdict = lines.find((line) => line.toLowerCase().startsWith("verdict:"));
  const modelIssue = lines.find((line) => /ollama|model/i.test(line) && /missing|not running|not found|failed|error/i.test(line));
  const summary = verdict || modelIssue || lines.find((line) => !/^info\s/i.test(line)) || status || "No command output yet.";

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <strong>{label}</strong>
          <span>{summary}</span>
        </div>
        {artifact ? <code>{artifact.replace(/^artifacts:\s*/i, "")}</code> : null}
      </div>
      {text ? (
        <details>
          <summary>Command transcript</summary>
          <pre>{text}</pre>
        </details>
      ) : null}
    </>
  );
}

export function BrainServiceSegmentedNav({
  activeSection,
  brainClass,
  sections,
  setActiveSection,
}: {
  activeSection: string;
  brainClass: ClassFn;
  sections: BrainServiceSection[];
  setActiveSection: (section: string) => void;
}) {
  return (
    <div className={brainClass("brainServiceSegmented")} role="tablist" aria-label="Brain service sections">
      {sections.map((section) => {
        const selected = activeSection === section.id;
        return (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`brain-service-panel-${section.id}`}
            id={`brain-service-tab-${section.id}`}
            className={brainClass("brainServiceSegment", selected && "selected")}
            onClick={() => setActiveSection(section.id)}
          >
            {section.icon}
            {section.label}
          </button>
        );
      })}
    </div>
  );
}

export function BrainServiceOverview({
  brainClass,
  Button,
  cards,
  setActiveSection,
}: {
  brainClass: ClassFn;
  Button: ComponentType<ButtonProps>;
  cards: BrainServiceOverviewCard[];
  setActiveSection: (section: string) => void;
}) {
  return (
    <div className={brainClass("brainServiceOverviewGrid")}>
      {cards.map((card) => {
        const showActionButton = (!card.onToggle || card.enabled || card.canToggle) && card.installAction?.state !== "installing" && !(card.installAction?.state === "install" && !card.canToggle);
        const showControlRow = Boolean((card.canToggle && card.onToggle) || showActionButton);
        const toggleText = card.toggleLabel ?? (card.enabled ? `${card.title} enabled` : `Enable ${card.title}`);
        return (
          <article key={card.id} className={brainClass("brainServiceOverviewCard", card.tone === "live" ? "live" : "idle")}>
            <div className={brainClass("brainServiceOverviewTopline")}>
              <span className={brainClass("brainServiceOverviewIcon")}>{card.icon}</span>
              <small className={brainClass(card.tone === "live" ? "serviceBadgeLive" : "serviceBadgeIdle")}>{card.status}</small>
            </div>
            <div>
              <small>{card.eyebrow}</small>
              <h4>{card.title}</h4>
              <p>{card.detail}</p>
            </div>
            {card.bullets?.length ? (
              <ul className={brainClass("brainServiceOverviewBullets")}>
                {card.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}
              </ul>
            ) : null}
            {card.installAction && card.installAction.state === "installing" ? (
              <div className={brainClass("brainServiceOverviewInstallProgress")} role="status" aria-live="polite">
                <span className={brainClass("brainServiceOverviewInstallPulse")} aria-hidden="true" />
                <strong>{card.installAction.progressLabel ?? card.installAction.label}</strong>
                {card.installAction.setupSteps?.length ? (
                  <ol>
                    {card.installAction.setupSteps.slice(0, 4).map((step, index) => <li key={step} style={{ "--step-index": index } as Record<string, number>}>{step}</li>)}
                  </ol>
                ) : null}
              </div>
            ) : card.installAction && !card.canToggle ? (
              <Button type="button" size="sm" variant="secondary" disabled={card.installAction.disabled} onClick={card.installAction.onClick}>
                {card.installAction.icon}
                {card.installAction.label}
              </Button>
            ) : null}
            {showControlRow ? (
              <div className={brainClass("brainServiceOverviewControls")}>
                {card.canToggle && card.onToggle ? (
                  <label className={brainClass("brainServiceEnableToggle")}>
                    <input type="checkbox" checked={Boolean(card.enabled)} onChange={(event) => card.onToggle?.(event.target.checked)} />
                    <span className={brainClass("brainServiceSwitch")} aria-hidden="true"><span /></span>
                    <span>{toggleText}</span>
                  </label>
                ) : null}
                {showActionButton ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => setActiveSection(card.id)}>
                    {card.action}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function BrainServiceSettingsDeck({
  brainClass,
  gbrainSettings,
  syntoSettings,
}: {
  brainClass: ClassFn;
  gbrainSettings?: ReactNode;
  syntoSettings?: ReactNode;
}) {
  return (
    <div className={brainClass("brainServiceSettingsDeck")}>
      <article className={brainClass("brainServiceSettingsCard")}>
        <div>
          <small>GBrain</small>
          <h4>Retrieval settings</h4>
          <p>Provider policy, search behavior, and MCP mode for semantic retrieval.</p>
        </div>
        {gbrainSettings}
      </article>
      <article className={brainClass("brainServiceSettingsCard")}>
        <div>
          <small>Syntho</small>
          <h4>Synthesis settings</h4>
          <p>Source access, model choice, review threshold, and MCP exposure.</p>
        </div>
        {syntoSettings}
      </article>
    </div>
  );
}
