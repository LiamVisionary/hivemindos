"use client";

import * as React from "react";

import type { ConnectionProviderKey } from "@/lib/types/integrations";
import { BIcon } from "./integrations-primitives";
import {
  integrationModalActionsForProvider,
  type IntegrationModalActionId,
} from "./integration-modal-actions";
import { SlackSessionCapture } from "./SlackSessionCapture";

export function IntegrationModalActions({
  providerKey,
  providerLabel,
  initialActionId,
}: {
  providerKey: ConnectionProviderKey;
  providerLabel: string;
  initialActionId?: IntegrationModalActionId;
}) {
  const actions = integrationModalActionsForProvider(providerKey);
  const [selectedAction, setSelectedAction] = React.useState<IntegrationModalActionId | null>(
    actions.some((action) => action.id === initialActionId) ? initialActionId ?? null : null,
  );
  const selected = actions.find((action) => action.id === selectedAction);

  if (selected) {
    return (
      <div className="fm-action-view">
        <button type="button" className="fm-action-back" onClick={() => setSelectedAction(null)}>
          <span aria-hidden>←</span> Back to actions
        </button>
        <div className="fm-action-heading">
          <div className="fb-eyebrow">{providerLabel} action</div>
          <h4>{selected.label}</h4>
          <p>{selected.description}</p>
        </div>
        {selected.id === "slack-channel-download" ? <SlackSessionCapture actionView /> : null}
      </div>
    );
  }

  if (!actions.length) {
    return (
      <div className="fm-action-empty">
        <span className="fm-action-icon"><BIcon name="sparkles" size={18} /></span>
        <strong>No manual actions yet</strong>
        <p>Interactive {providerLabel} actions will appear here when they are available in the dashboard.</p>
      </div>
    );
  }

  return (
    <div className="fm-grid fm-action-grid">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="fm-card fm-action-card"
          onClick={() => setSelectedAction(action.id)}
          style={{ color: "var(--fg)", cursor: "pointer", textAlign: "left" }}
        >
          <span className="fb-tile fm-action-icon"><BIcon name={action.icon} size={18} /></span>
          <span className="body" style={{ display: "grid", gap: 6 }}>
            <strong style={{ display: "block" }}>{action.label}</strong>
            <span className="fm-summary">{action.description}</span>
          </span>
          <span className="fm-catfoot" style={{ width: "100%" }}>
            <small>Open action <span aria-hidden>→</span></small>
          </span>
        </button>
      ))}
    </div>
  );
}
