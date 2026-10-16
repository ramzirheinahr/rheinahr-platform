import { createHash } from "node:crypto";

export const CLIENT_RATE_CHANGE_SOURCE = "Vergütungsseite: bestätigter Kundensatz";

export function hashClientPricingRateChange(input: {
  clientId: string;
  qualificationCode: string;
  hourlyRateInCents: number | null;
  effectiveFrom: string;
  verifiedByUserId: string;
  sourceReference: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function todayInBerlin(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
