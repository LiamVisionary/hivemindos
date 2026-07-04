import { notFound } from "next/navigation";

import PageAgentLab from "@/features/page-agent/PageAgentLab";

export const metadata = {
  title: "Page Agent — Lab",
};

// Isolated proof surface for the in-page GUI agent. Available in development by
// default; in production it stays off unless explicitly enabled, so it never
// ships to end users before the real, gated integration lands.
const LAB_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.PAGE_AGENT_LAB === "1";

export default function PageAgentLabRoute() {
  if (!LAB_ENABLED) notFound();
  return <PageAgentLab />;
}
