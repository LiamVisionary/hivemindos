"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AZURE_MARKETPLACE_DEPLOY_CONFIRMATION,
  type AzureMarketplaceMachineCatalog,
  type AzureMarketplaceMachinePlan,
} from "@/lib/services/hivemindos-machines-contract";
import { confirmUserAction } from "@/lib/utils/confirm-user-action";
import styles from "./MachineInitModal.module.css";

type Subscription = { subscriptionId: string; displayName: string; state?: string };
type Deployment = {
  provisioningState: string;
  portalUrl: string;
  sshPrivateKeyPath: string;
  machineName: string;
  resourceGroup: string;
};

type ApiEnvelope = {
  ok?: boolean;
  error?: string;
  catalog?: AzureMarketplaceMachineCatalog;
  data?: { value?: Subscription[] };
  deployment?: Deployment;
};

const LOCATIONS = [
  { value: "southeastasia", label: "Southeast Asia · Singapore" },
  { value: "eastus", label: "East US · Virginia" },
  { value: "westus2", label: "West US 2 · Washington" },
  { value: "westeurope", label: "West Europe · Netherlands" },
] as const;

async function responseJson(response: Response): Promise<ApiEnvelope> {
  const payload = await response.json().catch(() => ({})) as ApiEnvelope;
  if (!response.ok || !payload.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}.`);
  return payload;
}

export function AzureMarketplaceMachineModal({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [catalog, setCatalog] = useState<AzureMarketplaceMachineCatalog | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(true);
  const [stage, setStage] = useState<"configure" | "deploying" | "ready">("configure");
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [machineName, setMachineName] = useState("hive-worker-1");
  const [resourceGroup, setResourceGroup] = useState("hivemindos-machines");
  const [location, setLocation] = useState<(typeof LOCATIONS)[number]["value"]>("southeastasia");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [planId, setPlanId] = useState<AzureMarketplaceMachinePlan["id"]>("starter");

  const load = useCallback(async () => {
    setBusy(true);
    setLoadError("");
    try {
      const catalogPayload = await fetch("/api/hivemindos-machines/azure", { cache: "no-store" }).then(responseJson);
      if (!catalogPayload.catalog) throw new Error("The official catalog was empty.");
      setCatalog(catalogPayload.catalog);
      if (catalogPayload.catalog.availability !== "available") return;

      const subscriptionsPayload = await fetch("/api/integrations/azure/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "subscriptions" }),
      }).then(responseJson);
      const rows = Array.isArray(subscriptionsPayload.data?.value) ? subscriptionsPayload.data.value : [];
      setSubscriptions(rows);
      setSubscriptionId((current) => current || rows.find((row) => row.state === "Enabled")?.subscriptionId || rows[0]?.subscriptionId || "");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load HivemindOS Machines.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const plan = useMemo(() => catalog?.plans.find((candidate) => candidate.id === planId) || catalog?.plans[0] || null, [catalog, planId]);
  const marketplaceReady = catalog?.availability === "available";

  const pollDeployment = useCallback(async () => {
    if (!subscriptionId || !machineName || !resourceGroup) return;
    try {
      const payload = await responseJson(await fetch("/api/hivemindos-machines/azure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", subscriptionId, resourceGroup, location, machineName }),
      }));
      if (!payload.deployment) throw new Error("Azure returned no deployment status.");
      setDeployment(payload.deployment);
      const state = payload.deployment.provisioningState.toLowerCase();
      if (state === "succeeded") setStage("ready");
      else if (["failed", "canceled", "cancelled"].includes(state)) {
        setLoadError(`Azure deployment ${payload.deployment.provisioningState.toLowerCase()}. Open Azure Portal for the failure detail.`);
        setStage("configure");
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not read the Azure deployment status.");
      setStage("configure");
    }
  }, [location, machineName, resourceGroup, subscriptionId]);

  useEffect(() => {
    if (stage !== "deploying") return;
    const timer = window.setInterval(() => void pollDeployment(), 5000);
    return () => window.clearInterval(timer);
  }, [pollDeployment, stage]);

  async function deploy() {
    if (!plan || !subscriptionId || !marketplaceReady) return;
    const monthlySoftware = plan.softwareUsdPerHour * 730;
    const confirmed = await confirmUserAction(
      `Deploy ${plan.label} to your Azure subscription?\n\nMicrosoft will bill your subscription for Azure infrastructure plus the HivemindOS software fee of $${plan.softwareUsdPerHour.toFixed(2)}/running hour (about $${monthlySoftware.toFixed(2)} for 730 running hours). Azure infrastructure, public IPv4, storage, bandwidth, tax, and regional pricing are separate and do not have a universal hard spending cap.\n\nThis also accepts the Microsoft Marketplace terms for this HivemindOS plan.`,
    );
    if (!confirmed) return;
    setLoadError("");
    setStage("deploying");
    try {
      const payload = await responseJson(await fetch("/api/hivemindos-machines/azure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deploy", subscriptionId, resourceGroup, location, machineName, planId: plan.id, confirmation: AZURE_MARKETPLACE_DEPLOY_CONFIRMATION, acceptMarketplaceTerms: true }),
      }));
      if (!payload.deployment) throw new Error("Azure returned no deployment record.");
      setDeployment(payload.deployment);
      if (payload.deployment.provisioningState.toLowerCase() === "succeeded") setStage("ready");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not deploy the HivemindOS Machine.");
      setStage("configure");
    }
  }

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (stage !== "deploying" && event.target === event.currentTarget) onClose(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="machine-init-title">
        {stage !== "deploying" ? <button className={styles.close} type="button" aria-label="Close machine initializer" onClick={onClose}>×</button> : null}
        <header className={styles.hero} data-tone={stage === "deploying" || stage === "ready" ? "live" : undefined}>
          <span className={styles.mark}><AzureMark /></span>
          <span className={styles.heroText}><span className={styles.eyebrow}>Microsoft Azure Marketplace</span><span className={styles.heroTitle}>HivemindOS Machine</span></span>
          <span className={styles.rail} aria-hidden="true">{[0, 1, 2].map((index) => <i key={index} data-on={(stage === "configure" ? 0 : stage === "deploying" ? 1 : 2) >= index ? "true" : undefined} data-live={stage !== "configure" && index > 0 ? "true" : undefined} />)}</span>
        </header>

        <div className={styles.body}>
          {busy ? (
            <div className={`${styles.step} ${styles.center}`} role="status" aria-label="Loading HivemindOS Machines"><span className={styles.largeSpinner} /><h2 id="machine-init-title" className={`${styles.title} ${styles.sm}`}>Checking Microsoft billing and plans…</h2></div>
          ) : stage === "deploying" ? (
            <div className={`${styles.step} ${styles.center}`} role="status" aria-label="Deploying HivemindOS Machine"><span className={styles.largeSpinner} /><h2 id="machine-init-title" className={`${styles.title} ${styles.sm}`}>Azure is creating your machine.</h2><p className={styles.lede}>The deployment stays in your Azure subscription. This usually takes several minutes; HivemindOS is checking the real Resource Manager status.</p>{deployment ? <div className={styles.card}><span className={styles.lead}><span>Provisioning state</span><strong>{deployment.provisioningState}</strong></span></div> : null}</div>
          ) : stage === "ready" && deployment ? (
            <div className={`${styles.step} ${styles.center}`}><span className={styles.successDisc}>✓</span><h2 id="machine-init-title" className={styles.title}>HivemindOS Machine is live.</h2><p className={styles.lede}><strong>{deployment.machineName}</strong> is initialized from the Marketplace image in <strong>{deployment.resourceGroup}</strong>.</p><div className={styles.card}><span className={styles.lead}><span>SSH private key</span><strong>{deployment.sshPrivateKeyPath}</strong></span></div></div>
          ) : !catalog ? (
            <div className={styles.step}><h2 id="machine-init-title" className={`${styles.title} ${styles.sm}`}>The official machine catalog is unavailable.</h2><p className={styles.lede}>{loadError || "Try again shortly."}</p></div>
          ) : (
            <div className={styles.step}>
              <h2 id="machine-init-title" className={`${styles.title} ${styles.sm}`}>{marketplaceReady ? "Choose your HivemindOS Machine." : "Marketplace publishing is being completed."}</h2>
              <p className={styles.lede}>Microsoft bills the user&rsquo;s Azure subscription. Azure infrastructure is one line item; the HivemindOS image software fee is another. No local Azure MCP package is needed.</p>
              <div className={styles.billingStrip}><span>Microsoft-billed</span><span>Customer-owned Azure</span><span>3% store fee</span></div>
              <div className={styles.types}>
                {catalog.plans.map((candidate) => (
                  <button type="button" key={candidate.id} className={styles.type} data-sel={plan?.id === candidate.id ? "true" : undefined} onClick={() => setPlanId(candidate.id)}>
                    <span className={styles.typeIcon}><AzureMark /></span>
                    <span className={styles.typeBody}><span className={styles.typeHead}><strong>{candidate.label}</strong><span className={styles.typeTag}>{candidate.recommendedVmSize}</span><span className={styles.typePrice}>${candidate.softwareUsdPerHour.toFixed(2)}/hr</span></span><small>{candidate.vcpus} vCPU · {candidate.memoryGb} GB RAM · {candidate.osDiskGb} GB OS disk</small></span>
                  </button>
                ))}
              </div>
              {marketplaceReady ? (
                <>
                  <div className={styles.grid2}>
                    <label className={styles.field}><span className={styles.fieldLabel}>Azure subscription</span><select className={styles.input} value={subscriptionId} onChange={(event) => setSubscriptionId(event.target.value)}><option value="">Connect Azure first</option>{subscriptions.map((subscription) => <option key={subscription.subscriptionId} value={subscription.subscriptionId}>{subscription.displayName}</option>)}</select></label>
                    <label className={styles.field}><span className={styles.fieldLabel}>Azure region</span><select className={styles.input} value={location} onChange={(event) => setLocation(event.target.value as typeof location)}>{LOCATIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  </div>
                  <div className={styles.grid2}>
                    <label className={styles.field}><span className={styles.fieldLabel}>Machine name</span><input className={styles.input} value={machineName} onChange={(event) => setMachineName(event.target.value)} /></label>
                    <label className={styles.field}><span className={styles.fieldLabel}>Resource group</span><input className={styles.input} value={resourceGroup} onChange={(event) => setResourceGroup(event.target.value)} /></label>
                  </div>
                  <div className={styles.cost}><div className={styles.costHead}><span>HivemindOS software</span><strong>${plan?.softwareUsdPerHour.toFixed(2)}<small> /running hr</small></strong></div><p className={styles.costNote}>Azure VM compute, Standard SSD, public IPv4, bandwidth, regional premiums, and tax are separate Microsoft charges. A stopped VM can still incur disk and IP charges. Standard pay-as-you-go subscriptions do not have a universal hard cap.</p></div>
                </>
              ) : (
                <div className={styles.publisherGate}><strong>Publisher gates remaining</strong><span>Marketplace account and verified organization</span><span>Tax and payout validation</span><span>Certified HivemindOS VM image and preview approval</span><p>The prices above are the server-owned submission draft. They cannot bill anyone until Microsoft approves and publishes the offer.</p></div>
              )}
              {loadError ? <p className={styles.error} role="alert">{loadError}</p> : null}
            </div>
          )}
        </div>

        <footer className={styles.foot}>
          <div className={styles.footActions}>
            {stage === "ready" && deployment ? <button className={`${styles.btn} ${styles.ghost} ${styles.grow}`} type="button" onClick={() => window.open(deployment.portalUrl, "_blank", "noopener,noreferrer")}>Open Azure Portal ↗</button> : <button className={`${styles.btn} ${styles.text} ${styles.grow}`} type="button" onClick={onBack} disabled={stage === "deploying"}>‹ Back</button>}
            {!busy && stage === "configure" && !catalog ? <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => void load()}>Retry</button> : null}
            {!busy && stage === "configure" && marketplaceReady ? <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => void deploy()} disabled={!plan || !subscriptionId || !machineName.trim() || !resourceGroup.trim()}>Deploy with Microsoft billing</button> : null}
            {!busy && stage === "configure" && catalog && !marketplaceReady ? <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={() => window.open("https://partner.microsoft.com/dashboard/marketplace-offers/overview", "_blank", "noopener,noreferrer")}>Open Partner Center ↗</button> : null}
            {stage === "ready" ? <button className={`${styles.btn} ${styles.primary}`} type="button" onClick={onClose}>Done</button> : null}
          </div>
        </footer>
      </section>
    </div>
  );
}

function AzureMark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12.2 2 5.4 8.1 2 14.7h6.1L12.2 2Z" fill="currentColor" opacity=".72" /><path d="m13.2 5.1-4 11.7 7.6 4.2H22L13.2 5.1Z" fill="currentColor" /></svg>;
}
