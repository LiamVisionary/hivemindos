"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Download, ExternalLink, LoaderCircle, ShieldCheck, X } from "lucide-react";

import { ConnectionsPanel } from "@/features/integrations/ConnectionsPanel";
import { openExternalUrl } from "@/lib/native/open-external-url";
import type { CapabilityCandidate, CapabilitySetupOption } from "@/lib/types/capability-approval";
import type { ConnectionProviderKey } from "@/lib/types/integrations";
import type { InstallableServiceStatus } from "@/lib/services/installable-services";

import styles from "./capability-setup-modal.module.css";

type ServiceResponse = { ok?: boolean; service?: InstallableServiceStatus; error?: string };

export function CapabilitySetupModal({
  candidate,
  onClose,
  onReady,
}: {
  candidate: CapabilityCandidate;
  onClose: () => void;
  onReady: () => void;
}) {
  const options = candidate.setupOptions ?? [];
  const [optionIndex, setOptionIndex] = useState(0);
  const option = options[optionIndex];

  if (!option) {
    return (
      <ModalFrame title={`Set up ${candidate.name}`} onClose={onClose}>
        <p className={styles.message}>This capability does not yet expose an automated setup route. Use its reviewed source or choose another capability.</p>
        {candidate.locator ? <button className={styles.secondaryButton} type="button" onClick={() => void openExternalUrl(candidate.locator!)}><ExternalLink size={14} /> Open source</button> : null}
      </ModalFrame>
    );
  }

  if (option.kind === "connection") {
    return (
      <ConnectionsPanel
        setupProviderKey={option.providerKey as ConnectionProviderKey}
        onSetupClose={onClose}
        onSetupComplete={onReady}
      />
    );
  }

  return (
    <InstallCapabilityModal
      key={option.serviceId}
      candidate={candidate}
      option={option}
      options={options}
      optionIndex={optionIndex}
      onOptionIndex={setOptionIndex}
      onClose={onClose}
      onReady={onReady}
    />
  );
}

function InstallCapabilityModal({
  candidate,
  option,
  options,
  optionIndex,
  onOptionIndex,
  onClose,
  onReady,
}: {
  candidate: CapabilityCandidate;
  option: Extract<CapabilitySetupOption, { kind: "installable-service" }>;
  options: CapabilitySetupOption[];
  optionIndex: number;
  onOptionIndex: (index: number) => void;
  onClose: () => void;
  onReady: () => void;
}) {
  const [service, setService] = useState<InstallableServiceStatus | null>(null);
  const [busy, setBusy] = useState("status");
  const [error, setError] = useState("");
  const sourceUrl = service?.sourceUrl || candidate.locator;
  const blockingRequirement = useMemo(
    () => Boolean(service && /required before|is required to install/i.test(service.detail)),
    [service],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/fleet/apps/installable-services?id=${encodeURIComponent(option.serviceId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as ServiceResponse | null;
        if (!response.ok || !data?.ok || !data.service) throw new Error(data?.error || "Could not check installation status.");
        if (!cancelled) setService(data.service);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not check installation status."); })
      .finally(() => { if (!cancelled) setBusy(""); });
    return () => { cancelled = true; };
  }, [option.serviceId]);

  async function install() {
    if (service?.installed) {
      onReady();
      return;
    }
    setBusy("install");
    setError("");
    try {
      const response = await fetch("/api/fleet/apps/installable-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: option.serviceId, action: "install" }),
      });
      const data = await response.json().catch(() => null) as ServiceResponse | null;
      if (!response.ok || !data?.ok || !data.service) throw new Error(data?.error || `${candidate.name} installation failed.`);
      setService(data.service);
      if (!data.service.installed) throw new Error(data.service.detail || `${candidate.name} did not report as installed.`);
      onReady();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${candidate.name} installation failed.`);
    } finally {
      setBusy("");
    }
  }

  return (
    <ModalFrame title={`Install ${candidate.name}?`} onClose={onClose} busy={Boolean(busy)}>
      <p className={styles.lede}>{candidate.summary}</p>
      {options.length > 1 ? (
        <div className={styles.optionGrid}>
          {options.map((entry, index) => (
            <button key={`${entry.kind}:${entry.label}`} type="button" aria-pressed={index === optionIndex} onClick={() => onOptionIndex(index)}>
              <strong>{entry.label}</strong><span>{entry.description}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.detailCard}>
        <span className={styles.statusIcon} aria-hidden="true">{service?.installed ? <Check size={16} /> : <Download size={16} />}</span>
        <div>
          <strong>{service?.installed ? "Ready" : option.label}</strong>
          <p>{service?.detail || option.description}</p>
        </div>
      </div>
      {service?.requirements?.length ? (
        <div className={styles.section}><strong>Requirements</strong><ul>{service.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul></div>
      ) : null}
      {service?.securityNotes?.length ? (
        <div className={styles.section}><strong><ShieldCheck size={14} /> Safety</strong><ul>{service.securityNotes.map((note) => <li key={note}>{note}</li>)}</ul></div>
      ) : null}
      {sourceUrl ? <button className={styles.sourceButton} type="button" onClick={() => void openExternalUrl(sourceUrl)}><ExternalLink size={13} /> Review source</button> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.actions}>
        <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={Boolean(busy)}>Not now</button>
        <button className={styles.primaryButton} type="button" onClick={() => void install()} disabled={Boolean(busy) || blockingRequirement}>
          {busy ? <LoaderCircle className={styles.spinner} size={15} /> : service?.installed ? <Check size={15} /> : <Download size={15} />}
          {busy === "status" ? "Checking…" : busy === "install" ? "Installing…" : service?.installed ? "Continue" : "Install & continue"}
        </button>
      </div>
    </ModalFrame>
  );
}

function ModalFrame({
  title,
  busy = false,
  onClose,
  children,
}: {
  title: string;
  busy?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
        <header><span className={styles.logo}><Download size={18} /></span><h2>{title}</h2><button type="button" aria-label="Close setup" onClick={onClose} disabled={busy}><X size={17} /></button></header>
        <div className={styles.body}>{children}</div>
      </section>
    </div>
  );
}
