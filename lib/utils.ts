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

// German datetime format (dd.mm.yyyy HH:mm) in Europe/Berlin timezone.
// Essential for legal signatures so the time matches local German time, not UTC.
export function formatDateTimeDE(date: Date): string {
  const formatter = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return formatter.format(date).replace(",", ""); // e.g. "06.08.2026 17:00"
}

// Formats the structured address fields into a single string.
export function buildAddressString(entity: { address?: string | null } | null): string {
  return entity?.address || "";
}
