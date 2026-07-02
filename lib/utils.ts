import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// German display format (dd.mm.yyyy). Shift dates are stored as UTC midnight,
// so read the UTC fields to avoid off-by-one around DST.
export function formatDateDE(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(date.getUTCDate())}.${p(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`
}
