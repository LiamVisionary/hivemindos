import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names (clsx + tailwind-merge). Matches the app's @/lib/utils cn. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
