import { createAgentNotification } from "@/lib/services/obsidian/agent-notifications";
import { createIncidentStore } from "./incident-store";
import { createIncidentInvestigationService } from "./service";

export const incidentStore = createIncidentStore();
export const incidentInvestigationService = createIncidentInvestigationService({
  store: incidentStore,
  onDiagnosed: async (incident) => {
    const diagnosis = incident.diagnosis;
    if (!diagnosis) return;
    const recommendations = diagnosis.recommendations.length
      ? `\n\nRecommendations (review required):\n${diagnosis.recommendations.map((item) => `- ${item}`).join("\n")}`
      : "";
    await createAgentNotification({
      id: `sre-diagnosis-${incident.id}`,
      title: `SRE diagnosis: ${incident.bundle.summary}`,
      body: [
        `Root cause: ${diagnosis.rootCause}`,
        `Confidence: ${Math.round(diagnosis.validityScore * 100)}%`,
        `Incident: ${incident.id}`,
        recommendations,
        "\nOpenSRE recommendations are evidence for review. They do not grant approval or execute actions.",
      ].join("\n").slice(0, 8_000),
      priority: incident.bundle.severity === "critical" ? "urgent" : "high",
      kind: "alert",
      agentId: "sre-investigator",
      agentName: "SRE Investigator",
      source: "sre-investigation",
      tags: ["sre", "incident", `incident:${incident.id}`, "review-required"],
    });
  },
});
