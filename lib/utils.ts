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

export type AddressEntity = {
  address?: string | null;
  addressStreet?: string | null;
  addressHouseNumber?: string | null;
  addressZip?: string | null;
  addressCity?: string | null;
  addressExtra?: string | null;
};

// Formats the structured address fields into a single string.
// If multiline is true, it returns a string with newlines, ideal for PDFs/Documents.
// If multiline is false, it returns a comma-separated string, ideal for Geocoding.
export function buildAddressString(entity: AddressEntity | null, multiline = false): string {
  if (!entity) return "";
  
  if (entity.addressStreet || entity.addressCity) {
    const line1 = `${entity.addressStreet || ""} ${entity.addressHouseNumber || ""}`.trim();
    const line2 = `${entity.addressZip || ""} ${entity.addressCity || ""}`.trim();
    const line3 = entity.addressExtra || "";
    
    if (multiline) {
      return [line1, line2, line3].filter(Boolean).join("\n");
    } else {
      return [line1, line2, line3].filter(Boolean).join(", ");
    }
  }
  
  // Fallback to legacy single-string address if new fields aren't populated
  return entity.address || "";
}
