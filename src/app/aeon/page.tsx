// src/app/aeon/page.tsx — standalone route for the AEON Autopilot screen.
// In the real dashboard, AEON is a view at /?view=aeon — see README "Wire into
// DashboardApp" to render <AeonAutopilotPanel/> when activeView === "aeon" instead.
"use client";

import { AeonAutopilotPanel } from "@/components/aeon";

export default function AeonPage() {
  return (
    <main style={{ height: "100dvh" }}>
      <AeonAutopilotPanel
        onToggleSkill={() => {}}
        onRunSkill={() => {}}
        onSendDeliverable={() => {}}
        onCreateWorkspace={() => {}}
      />
    </main>
  );
}
