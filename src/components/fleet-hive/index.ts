/* Barrel export for the Fleet "Hive" view + app-wide nav shelf. */
export { FleetHiveView, default } from "./FleetHiveView";
export { AppNavShelf } from "./AppNavShelf";
export type { ShelfTheme } from "./AppNavShelf";
export type {
  HiveAgent,
  HiveMachine,
  HiveSelection,
  HiveMachineKind,
} from "./fleet-hive-types";
export { mapFleetMachines, mapFleetMachine, mapFleetAgent } from "./fleet-hive-mappers";
