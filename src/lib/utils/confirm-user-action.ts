"use client";

export async function confirmUserAction(message: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const result = window.confirm(message) as boolean | Promise<boolean>;
    if (typeof result === "boolean") return result;
    return await result;
  } catch (error) {
    console.error("Could not open confirmation dialog.", error);
    return false;
  }
}
