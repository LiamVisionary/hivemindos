"use client";

import { useState } from "react";

import { GuidedDashboardTour } from "@/features/dashboard/GuidedDashboardTour";
import { NativeFirstRunOnboarding } from "@/features/native/NativeFirstRunOnboarding";

type OnboardingPreviewHarnessProps = {
  demoHasAgents: boolean;
  demoPlatform: "macos" | "windows" | "linux";
};

export function OnboardingPreviewHarness({ demoHasAgents, demoPlatform }: OnboardingPreviewHarnessProps) {
  const [handoff, setHandoff] = useState("waiting");

  return (
    <>
      <output data-testid="onboarding-handoff">{handoff}</output>
      <NativeFirstRunOnboarding demoMode demoHasAgents={demoHasAgents} demoPlatform={demoPlatform} />
      <GuidedDashboardTour
        selectView={() => undefined}
        openFirstAgentSetup={() => setHandoff("agent-setup")}
        openFirstChat={() => {
          setHandoff(demoHasAgents ? "chat" : "no-agent");
          return demoHasAgents;
        }}
      />
    </>
  );
}
