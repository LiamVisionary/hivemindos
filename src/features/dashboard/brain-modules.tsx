import type { ComponentType, ReactNode } from "react";

export type BrainModuleAction = {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
};

export type BrainModuleStat = {
  key: string;
  label: string;
  value: ReactNode;
  icon?: ReactNode;
};

export type BrainModuleInstallState = "failed" | "install" | "installing" | "installed" | "success";

export type BrainModuleInstallDefinition = {
  buttonLabel: string;
  disabled?: boolean;
  features?: ReactNode[];
  icon?: ReactNode;
  failureLabel?: ReactNode;
  installingLabel?: string;
  onInstall?: () => void;
  secondaryActions?: BrainModuleAction[];
  setupSteps?: string[];
  state: BrainModuleInstallState;
  successLabel?: string;
};

export type BrainModuleDefinition = {
  id: string;
  name: string;
  icon?: ReactNode;
  statusLabel: string;
  statusTone: "live" | "idle";
  active?: boolean;
  variant?: string;
  title: string;
  description: ReactNode;
  install?: BrainModuleInstallDefinition;
  stats?: BrainModuleStat[];
  badges?: ReactNode[];
  primaryAction?: BrainModuleAction;
  quickActions?: BrainModuleAction[];
  actions?: BrainModuleAction[];
  body?: ReactNode;
  settings?: ReactNode;
  result?: ReactNode;
  footer?: ReactNode;
};

export type BrainModuleButtonProps = {
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  size?: "sm" | "md" | string;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "secondary" | string;
};

export type BrainModuleRenderContext = {
  Button: ComponentType<BrainModuleButtonProps>;
  vaultClass: (...classes: Array<string | false | null | undefined>) => string;
};

export class BrainModule {
  readonly definition: BrainModuleDefinition;

  constructor(definition: BrainModuleDefinition) {
    this.definition = definition;
  }

  render({ Button, vaultClass }: BrainModuleRenderContext) {
    const brainModule = this.definition;
    const installState = brainModule.install?.state ?? (brainModule.active ? "installed" : "install");
    const showInstalledView = installState === "installed";
    return (
      <article key={brainModule.id} className={vaultClass("brainServiceCard", brainModule.variant, brainModule.active && "active", installState !== "installed" && "installView")}>
        <div className={vaultClass("brainServiceTopline")}>
          <span className={vaultClass("brainServiceModuleTitle")}>
            <span className={vaultClass("brainServiceModuleTile")}>{brainModule.icon}</span>
            {brainModule.name}
          </span>
          <small className={vaultClass(brainModule.statusTone === "live" ? "serviceBadgeLive" : "serviceBadgeIdle")}>
            {brainModule.statusTone === "live" ? <span className={vaultClass("brainServiceLiveDot")} aria-hidden="true" /> : null}
            {brainModule.statusLabel}
          </small>
        </div>
        <h4>{brainModule.title}</h4>
        <p>{brainModule.description}</p>

        {installState === "success" ? (
          <div className={vaultClass("brainModuleSuccess")} role="status" aria-live="polite">
            <span className={vaultClass("brainModuleCheckmark")}>
              <svg viewBox="0 0 64 64" aria-hidden="true">
                <circle cx="32" cy="32" r="27" />
                <path d="M19 33.5 28 42l18-21" />
              </svg>
            </span>
            <strong>{brainModule.install?.successLabel ?? "Installed!"}</strong>
          </div>
        ) : installState === "installing" ? (
          <div className={vaultClass("brainModuleInstalling")} role="status" aria-live="polite">
            <div className={vaultClass("brainModuleInstallOrbit")} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <strong>{brainModule.install?.installingLabel ?? `Installing ${brainModule.name}`}</strong>
            {brainModule.install?.setupSteps?.length ? (
              <ol className={vaultClass("brainModuleInstallSteps")}>
                {brainModule.install.setupSteps.map((step, index) => <li key={step} style={{ "--step-index": index } as Record<string, number>}>{step}</li>)}
              </ol>
            ) : null}
          </div>
        ) : !showInstalledView && brainModule.install ? (
          <div className={vaultClass("brainModuleInstallContent")}>
            {installState === "failed" && brainModule.install.failureLabel ? (
              <div className={vaultClass("brainModuleInstallFailure")} role="status" aria-live="polite">
                {brainModule.install.failureLabel}
              </div>
            ) : null}
            {brainModule.install.features?.length ? (
              <div className={vaultClass("brainModuleFeatureList")}>
                {brainModule.install.features.map((feature, index) => <span key={index}>{feature}</span>)}
              </div>
            ) : null}
            <div className={vaultClass("brainModuleInstallActions")}>
              <Button type="button" size="sm" variant="secondary" className={vaultClass("brainModuleInstallButton")} disabled={brainModule.install.disabled} onClick={brainModule.install.onInstall}>
                {brainModule.install.icon}
                {brainModule.install.buttonLabel}
              </Button>
              {brainModule.install.secondaryActions?.map((action) => (
                <Button key={action.key} type="button" size="sm" variant="secondary" disabled={action.disabled} onClick={action.onClick}>
                  {action.icon}
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {showInstalledView && (brainModule.stats?.length || brainModule.badges?.length) ? (
          <details className={vaultClass("brainServiceDisclosure")} open>
            <summary>Details</summary>
            {brainModule.stats?.length ? (
              <div className={vaultClass("brainServiceStats")}>
                {brainModule.stats.map((stat) => (
                  <div key={stat.key}>
                    <div className={vaultClass("brainServiceStatLabel")}>{stat.label}</div>
                    <div className={vaultClass("brainServiceStatValue")}>{stat.value}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {brainModule.badges?.length ? (
              <div className={vaultClass("brainServiceBadges")}>
                {brainModule.badges.map((badge, index) => <span key={index}>{badge}</span>)}
              </div>
            ) : null}
          </details>
        ) : null}

        {showInstalledView && (brainModule.primaryAction || brainModule.quickActions?.length) ? (
          <div className={vaultClass("brainServicePrimaryActions")}>
            {brainModule.primaryAction ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className={vaultClass("brainServicePrimaryButton")}
                disabled={brainModule.primaryAction.disabled}
                onClick={brainModule.primaryAction.onClick}
              >
                {brainModule.primaryAction.icon}
                {brainModule.primaryAction.label}
              </Button>
            ) : null}
            {brainModule.quickActions?.map((action) => (
              <Button
                key={action.key}
                type="button"
                size="sm"
                variant="secondary"
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}

        {showInstalledView && brainModule.body ? (
          <details className={vaultClass("brainServiceDisclosure")}>
            <summary>Question</summary>
            {brainModule.body}
          </details>
        ) : null}
        {showInstalledView && brainModule.result ? (
          <div className={vaultClass("brainServiceResult")}>
            {brainModule.result}
          </div>
        ) : null}
        {showInstalledView && brainModule.actions?.length ? (
          <details className={vaultClass("brainServiceDisclosure")}>
            <summary>Advanced actions</summary>
            <div className={vaultClass("brainServiceActions")}>
              {brainModule.actions.map((action) => (
                <Button
                  key={action.key}
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={action.disabled}
                  onClick={action.onClick}
                >
                  {action.icon}
                  {action.label}
                </Button>
              ))}
            </div>
          </details>
        ) : null}
        {showInstalledView ? brainModule.footer : null}
      </article>
    );
  }
}
