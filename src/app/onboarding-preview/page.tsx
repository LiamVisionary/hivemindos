import { notFound } from "next/navigation";

import { NativeFirstRunOnboarding } from "@/features/native/NativeFirstRunOnboarding";

export const dynamic = "force-dynamic";

export default async function OnboardingPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>;
}) {
  if (process.env.HIVEMINDOS_ONBOARDING_PREVIEW !== "1") notFound();
  const { platform } = await searchParams;
  const demoPlatform = platform === "windows" || platform === "linux" ? platform : "macos";
  return (
    <main aria-label="Onboarding browser test fixture">
      <NativeFirstRunOnboarding demoMode demoPlatform={demoPlatform} />
    </main>
  );
}
