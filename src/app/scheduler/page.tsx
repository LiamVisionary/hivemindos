import { SchedulerView } from "@/components/scheduler";
export const dynamic = "force-dynamic";
export default function SchedulerPage() {
  return <main className="flex h-[100dvh] w-full flex-col overflow-hidden"><SchedulerView /></main>;
}
