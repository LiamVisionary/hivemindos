"use client";

// The "Zero Human Company" dashboard view. The dashboard mounts this as
// `GovernancePanel` (governance route); the implementation lives in the
// zero-human-companies feature folder — a portfolio of agent-run companies
// (colonies) wired end-to-end to the real companies / approvals / agents /
// kanban APIs, with a per-company cockpit (board, team, approvals, governance,
// treasury + kill switch).
import { ZeroHumanCompaniesView } from "./zero-human-companies/ZeroHumanCompaniesView";
import type { SkillBrowserAttachmentTarget } from "@/features/dashboard/dashboard-types";
import type { KanbanLinkedDirectory, KanbanMachineTarget } from "@/lib/types/kanban";

type DirectoryPicker = (machine: KanbanMachineTarget | null, onChoose: (directory: KanbanLinkedDirectory) => void) => void | Promise<void>;

export function GovernancePanel({
  theme = "dark",
  openSkillAttachmentBrowser,
  chooseDirectoryForMachine,
  defaultDirectoryMachine,
}: {
  theme?: "dark" | "light";
  openSkillAttachmentBrowser?: (target: SkillBrowserAttachmentTarget) => void | Promise<void>;
  chooseDirectoryForMachine?: DirectoryPicker;
  defaultDirectoryMachine?: KanbanMachineTarget | null;
}) {
  // The shell (.commandMain) is viewport-capped with overflow hidden, so every
  // route panel owns its own scrolling via the global .tabPanel contract (see
  // sibling panels). Without this wrapper the company cockpit/board clipped at
  // the fold with no scrollbar once real companies had more content than fits.
  return (
    <section className="tabPanel" aria-label="Zero Human Companies">
      <ZeroHumanCompaniesView
        theme={theme}
        openSkillAttachmentBrowser={openSkillAttachmentBrowser}
        chooseDirectoryForMachine={chooseDirectoryForMachine}
        defaultDirectoryMachine={defaultDirectoryMachine}
      />
    </section>
  );
}
