import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import {
  fetchLiveModelStrengthHints,
  pickStrongestModelCandidate,
  scoreModelStrength,
  type ModelStrengthCandidate,
} from "@/lib/config/model-strength";

/**
 * Keeps the hive crowned: when no agent carries the explicit "queen" beeRole,
 * the strongest available agent is promoted so brain loops, voice, and the
 * tray Queen Bee entry work right after setup instead of silently no-oping.
 *
 * Selection order:
 *  1. An existing explicit queen always wins — crowning is sticky and this
 *     hook never re-crowns or demotes.
 *  2. An agent literally named like a queen (user intent is unambiguous).
 *  3. The agent whose configured model ranks strongest in the curated
 *     model-strength matrix.
 *  4. When every configured model is unknown to the matrix, a keyless
 *     OpenRouter listing refines the heuristic scores once; crowning still
 *     happens if that fetch fails.
 *
 * Agents with no configured model are never auto-crowned — the fleet banner
 * walks the user through creating or finishing a queen instead.
 */
export function useQueenCrown(input: {
  hydrated: boolean;
  agents: AgentProfile[];
  setAgents: Dispatch<SetStateAction<AgentProfile[]>>;
}) {
  const { hydrated, agents, setAgents } = input;
  const liveHintsAttemptedRef = useRef(false);

  useEffect(() => {
    if (!hydrated || agents.length === 0) return;
    if (agents.some((agent) => agent.beeRole === "queen")) return;

    const crown = (agentId: string) => {
      setAgents((current) => (
        current.some((agent) => agent.beeRole === "queen")
          ? current
          : current.map((agent) => (agent.id === agentId ? { ...agent, beeRole: "queen" } : agent))
      ));
    };

    const candidates = agents.filter((agent) => agent.beeRole !== "observer" && agent.beeRole !== "human");
    if (candidates.length === 0) return;

    const namedQueen = candidates.find((agent) => /queen/i.test(agent.name));
    if (namedQueen) {
      crown(namedQueen.id);
      return;
    }

    const modelCandidates: ModelStrengthCandidate[] = candidates.map((agent) => ({
      key: agent.id,
      modelId: agent.model,
    }));
    const offlinePick = pickStrongestModelCandidate(modelCandidates);
    if (!offlinePick) return;

    const everyModelUnknown = modelCandidates.every((candidate) => (
      !candidate.modelId?.trim() || scoreModelStrength(candidate.modelId).label === "heuristic"
    ));
    if (!everyModelUnknown || liveHintsAttemptedRef.current) {
      crown(offlinePick.key);
      return;
    }

    liveHintsAttemptedRef.current = true;
    let cancelled = false;
    void fetchLiveModelStrengthHints().then((hints) => {
      if (cancelled) return;
      const refined = hints ? pickStrongestModelCandidate(modelCandidates, hints) : null;
      crown((refined ?? offlinePick).key);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, agents, setAgents]);
}
