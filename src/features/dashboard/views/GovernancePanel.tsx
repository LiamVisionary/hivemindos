"use client";

// The "Zero Human Company" dashboard view. The dashboard mounts this as
// `GovernancePanel` (governance route); the implementation lives in the
// zero-human-companies feature folder — a portfolio of agent-run companies
// (colonies) wired end-to-end to the real companies / approvals / agents /
// kanban APIs, with a per-company cockpit (board, team, approvals, governance,
// treasury + kill switch).
import { ZeroHumanCompaniesView } from "./zero-human-companies/ZeroHumanCompaniesView";

export function GovernancePanel({ theme = "dark" }: { theme?: "dark" | "light" }) {
  return <ZeroHumanCompaniesView theme={theme} />;
}
