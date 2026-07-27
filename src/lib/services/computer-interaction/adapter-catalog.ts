import type { ComputerInteractionAdapterId } from "./types";

export type ComputerInteractionIntent = {
  surface: "dashboard" | "browser" | "desktop" | "api";
  needsVision?: boolean;
};

const ADAPTER_ROUTES: Record<ComputerInteractionIntent["surface"], ComputerInteractionAdapterId[]> = {
  dashboard: ["hive-action", "bee-pilot", "page-agent", "browser-use", "screenshot"],
  api: ["hive-action", "browser-use", "screenshot"],
  browser: ["browser-use", "screenshot"],
  desktop: ["screenshot"],
};

export function selectComputerInteractionAdapters(intent: ComputerInteractionIntent): ComputerInteractionAdapterId[] {
  const route = [...ADAPTER_ROUTES[intent.surface]];
  if (intent.needsVision && !route.includes("screenshot")) route.push("screenshot");
  return route;
}

