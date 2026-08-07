import { notFound } from "next/navigation";

import { OnboardingPreviewHarness } from "./OnboardingPreviewHarness";

export const dynamic = "force-dynamic";

export default async function OnboardingPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ agents?: string; platform?: string }>;
}) {
  if (process.env.HIVEMINDOS_ONBOARDING_PREVIEW !== "1") notFound();
  const { agents, platform } = await searchParams;
  const demoPlatform = platform === "windows" || platform === "linux" ? platform : "macos";
  return (
    <main aria-label="Onboarding browser test fixture">
      <OnboardingPreviewHarness demoHasAgents={agents !== "none"} demoPlatform={demoPlatform} />
    </main>
  );
}
