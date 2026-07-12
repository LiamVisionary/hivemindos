"use client";

import { RotateCcw } from "lucide-react";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import {
  GLOBAL_CUSTOM_INSTRUCTIONS_KEY,
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
} from "@/lib/services/chat/global-custom-instructions";
import { Badge, Btn, Field, TextArea } from "./AgentSettingsModalPrimitives";

/** Global, ChatGPT-style custom instructions. Persisted to the shared dashboard
 *  state key so it applies to every agent/model in the dashboard chat, not just
 *  the agent whose settings are open. Empty by default and only applied when
 *  non-empty (see buildCustomInstructionsContext). */
export function AgentSettingsCustomInstructionsPanel() {
  const [value, setValue] = useRememberedDashboardValue(GLOBAL_CUSTOM_INSTRUCTIONS_KEY, "");
  const trimmed = value.trim();
  return (
    <div className="as-block accent as-worker-detail">
      <div>
        <strong>Custom instructions</strong>
        <div className="as-cap-list">
          <Badge tone="honey">Global</Badge>
          <Badge tone="plain">All agents</Badge>
        </div>
      </div>
      <Field
        label="How should agents respond to you?"
        hint={trimmed ? `${trimmed.length}/${MAX_CUSTOM_INSTRUCTIONS_LENGTH}` : "Empty — not applied"}
      >
        <TextArea
          value={value}
          onChange={(event) => setValue(event.target.value.slice(0, MAX_CUSTOM_INSTRUCTIONS_LENGTH))}
          rows={6}
          placeholder={"e.g. Be concise and direct — skip the pleasantries. When you give code, explain the why. I'm an engineer; assume technical depth."}
        />
      </Field>
      <p style={{ margin: 0, fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5 }}>
        Prepended to every dashboard chat, across all agents and models. Applied only when non-empty; safety, correctness, and explicit in-conversation requests still take priority.
      </p>
      {trimmed ? (
        <div className="as-soul-actions">
          <Btn sm onClick={() => setValue("")}>
            <RotateCcw size={13} aria-hidden="true" />
            Clear
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
