"use client";

import { RotateCcw, Sparkles } from "lucide-react";
import {
  DEFAULT_QUEEN_BEE_PERSONALITY,
  queenBeePersonalityOrDefault,
} from "@/lib/config/queen-bee-personality";
import { Badge, Btn, Field, TextArea } from "./AgentSettingsModalPrimitives";

type AgentSettingsQueenPersonalityPanelProps = {
  iconSrc?: string;
  personality?: string;
  onChange: (personality: string) => void;
};

export function AgentSettingsQueenPersonalityPanel({
  iconSrc,
  personality,
  onChange,
}: AgentSettingsQueenPersonalityPanelProps) {
  const savedPersonality = personality?.trim() ?? "";
  const visiblePersonality = queenBeePersonalityOrDefault(savedPersonality);

  return (
    <div className="as-block accent as-worker-detail">
      {iconSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconSrc} alt="" />
      ) : null}
      <div>
        <strong>Queen Bee</strong>
        <div className="as-cap-list">
          <Badge>Coordinator</Badge>
          <Badge>Companion</Badge>
          <Badge>Strategist</Badge>
        </div>
      </div>
      <Field label="Personality" hint={savedPersonality ? "Custom" : "Default"}>
        <TextArea
          value={visiblePersonality}
          onChange={(event) => onChange(event.target.value)}
          rows={10}
        />
      </Field>
      <div className="as-soul-actions">
        <Btn sm onClick={() => onChange(DEFAULT_QUEEN_BEE_PERSONALITY)}>
          <Sparkles size={13} aria-hidden="true" />
          Load default
        </Btn>
        <Btn sm onClick={() => onChange("")}>
          <RotateCcw size={13} aria-hidden="true" />
          Use built-in default
        </Btn>
      </div>
    </div>
  );
}
