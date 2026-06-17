import type { LiquidGlassConfig } from "tauri-plugin-liquid-glass-api";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export type AppNavLiquidGlassTheme = "dark" | "light";
export type AppNavLiquidGlassMode = "native" | "vibrancy";

const TINT_BY_THEME: Record<AppNavLiquidGlassTheme, string> = {
  dark: "#14161c42",
  light: "#fbf8f15c",
};

let liquidGlassWarningShown = false;

function isMacDesktopRuntime() {
  if (!isTauriDesktopRuntime()) return false;
  const platform = navigator.platform.toLowerCase();
  return navigator.userAgent.includes("Mac") || platform.includes("mac");
}

export async function applyAppNavLiquidGlass(theme: AppNavLiquidGlassTheme): Promise<AppNavLiquidGlassMode | null> {
  if (!isMacDesktopRuntime()) return null;

  try {
    const { GlassMaterialVariant, isGlassSupported, setLiquidGlassEffect } =
      await import("tauri-plugin-liquid-glass-api");
    const nativeGlassSupported = await isGlassSupported().catch(() => false);
    const config: LiquidGlassConfig = {
      enabled: true,
      cornerRadius: 0,
      tintColor: TINT_BY_THEME[theme],
      variant: GlassMaterialVariant.Sidebar,
    };

    await setLiquidGlassEffect(config);
    document.documentElement.dataset.liquidGlass = nativeGlassSupported ? "native" : "vibrancy";
    return nativeGlassSupported ? "native" : "vibrancy";
  } catch (error) {
    if (!liquidGlassWarningShown) {
      console.warn("HivemindOS: Liquid Glass nav shelf effect could not be applied.", error);
      liquidGlassWarningShown = true;
    }
    delete document.documentElement.dataset.liquidGlass;
    return null;
  }
}
