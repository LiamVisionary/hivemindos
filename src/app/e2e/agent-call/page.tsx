import { notFound } from "next/navigation";
import AgentCallE2EHarness from "./AgentCallE2EHarness";

export default function AgentCallE2EPage() {
  if (process.env.NODE_ENV === "production" && process.env.HIVE_E2E_ENABLE_ROUTES !== "1") notFound();
  return <AgentCallE2EHarness />;
}
