import type { LiquidGlassConfig } from "tauri-plugin-liquid-glass-api";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export type AppNavLiquidGlassTheme = "dark" | "light";
export type AppNavLiquidGlassMode = "native" | "vibrancy" | "fallback";

const TINT_BY_THEME: Record<AppNavLiquidGlassTheme, string> = {
  dark: "#14161c42",
  light: "#f8f4ee5c",
};

let liquidGlassWarningShown = false;

function appNavLiquidGlassEnabled() {
  return /^(1|true|yes|on)$/i.test(process.env.NEXT_PUBLIC_HIVEMINDOS_LIQUID_GLASS_NAV ?? "");
}

function isMacDesktopRuntime() {
  if (!isTauriDesktopRuntime()) return false;
  const platform = navigator.platform.toLowerCase();
  return navigator.userAgent.includes("Mac") || platform.includes("mac");
}

async function disableNativeLiquidGlass() {
  if (!isMacDesktopRuntime()) return;

  try {
    const { setLiquidGlassEffect } = await import("tauri-plugin-liquid-glass-api");
    await setLiquidGlassEffect({ enabled: false });
  } catch (error) {
    if (!liquidGlassWarningShown) {
      console.warn("HivemindOS: Liquid Glass nav shelf effect could not be disabled.", error);
      liquidGlassWarningShown = true;
    }
  }
}

export async function applyAppNavLiquidGlass(theme: AppNavLiquidGlassTheme): Promise<AppNavLiquidGlassMode | null> {
  const root = document.documentElement;

  if (!appNavLiquidGlassEnabled()) {
    root.dataset.liquidGlass = "disabled";
    await disableNativeLiquidGlass();
    return null;
  }

  if (!isMacDesktopRuntime()) {
    root.dataset.liquidGlass = "fallback";
    return "fallback";
  }

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
    root.dataset.liquidGlass = nativeGlassSupported ? "native" : "vibrancy";
    return nativeGlassSupported ? "native" : "vibrancy";
  } catch (error) {
    if (!liquidGlassWarningShown) {
      console.warn("HivemindOS: Liquid Glass nav shelf effect could not be applied.", error);
      liquidGlassWarningShown = true;
    }
    root.dataset.liquidGlass = "disabled";
    return null;
  }
}
