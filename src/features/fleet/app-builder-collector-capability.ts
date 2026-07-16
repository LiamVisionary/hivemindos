import type { MachineGroup } from "@/features/dashboard/dashboard-types";
import { APP_BUILDER_CONTRACT } from "@/lib/services/app-builder/contract";
import { collectorSupportsAppBuilderContract } from "@/lib/services/app-builder/collector-recovery";

export function machineNeedsAppBuilderRepair(machine: MachineGroup) {
  return machine.collector === "ready" && !collectorSupportsAppBuilderContract(
    machine.capabilities?.appBuilderContractVersion,
    APP_BUILDER_CONTRACT.version,
  );
}
