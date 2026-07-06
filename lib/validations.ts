import { z } from "zod";

// Zod schemas — single source of truth for API-boundary validation (CLAUDE.md §9).
// Enum values mirror prisma/schema.prisma exactly.

export const qualifications = [
  "pflegefachkraft",
  "pflegehelfer",
  "betreuungskraft",
  "pflegedienstleitung",
] as const;

export const facilityTypes = [
  "pflegeheim",
  "seniorenheim",
  "ambulant",
  "tagespflege",
  "kurzzeitpflege",
] as const;

export const contractTypes = [
  "unbefristet",
  "befristet",
  "minijob",
  "werkstudent",
] as const;

// Worker document categories (subset of the Prisma DocumentCategory enum that
// applies to worker uploads — service_confirmation is produced elsewhere).
export const documentCategories = [
  "certification",
  "id_document",
  "vaccination",
  "contract",
  "other",
] as const;

export const locales = ["de", "en", "ar"] as const;

// Roles a super_admin may assign. (super_admin itself is provisioned via seed.)
export const assignableRoles = ["admin", "client", "worker"] as const;
export const allRoles = ["super_admin", ...assignableRoles] as const;

// Order lifecycle (CLAUDE.md §3) — admin-settable statuses.
export const orderStatuses = [
  "pending",
  "review",
  "availability_check",
  "assigned",
  "accepted",
  "in_progress",
  "completed",
  "confirmed",
  "cancelled",
] as const;

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:mm

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, { message: "min12" }),
});

export const orderSchema = z
  .object({
    requiredQualification: z.enum(qualifications),
    shiftDate: z.coerce.date(),
    startTime: z.string().regex(timeRegex),
    endTime: z.string().regex(timeRegex),
    quantity: z.coerce.number().int().min(1).max(50),
    notes: z.string().max(1000).optional(),
  })
  .refine((o) => o.startTime < o.endTime || o.endTime < o.startTime, {
    // Allow overnight shifts; only reject identical start/end.
    message: "startEndEqual",
    path: ["endTime"],
  });

// Calendar-based multi-shift request: one submission → many shifts (orders),
// each with its own qualification, time and headcount.
export const orderShiftSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    requiredQualification: z.enum(qualifications),
    startTime: z.string().regex(timeRegex),
    endTime: z.string().regex(timeRegex),
    quantity: z.coerce.number().int().min(1).max(50),
    bereich: z.string().max(120).optional(), // Wohnbereich / ward
  })
  .refine((s) => s.startTime !== s.endTime, {
    message: "startEndEqual",
    path: ["endTime"],
  });

export const orderRequestSchema = z.object({
  notes: z.string().max(1000).optional(),
  shifts: z.array(orderShiftSchema).min(1).max(60),
});

export type OrderShiftInput = z.infer<typeof orderShiftSchema>;
export type OrderRequestInput = z.infer<typeof orderRequestSchema>;

// Empty form values arrive as "" — treat them as "not provided".
const optionalDate = z.preprocess(
  (v) => (v ? v : undefined),
  z.coerce.date().optional(),
);
const optionalInt = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().int().min(0).max(80).optional(),
);
// A qualification hourly rate override (EUR) — blank means "use the default".
const optionalRate = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().min(0).max(1000).optional(),
);

export const workerSchema = z.object({
  fullName: z.string().min(2).max(120),
  qualification: z.enum(qualifications),
  contractType: z.enum(contractTypes),
  certifications: z.array(z.string().max(120)).default([]),
  skills: z.array(z.string().max(80)).default([]),
  // Spoken languages as ISO 639-1 codes (any world language).
  languages: z.array(z.string().min(2).max(10)).default([]),
  phone: z.string().max(40).optional(),
  address: z.string().max(240).optional(),
  // Personal / HR (sensitive — admin only).
  birthDate: optionalDate,
  birthPlace: z.string().max(120).optional(),
  nationality: z.string().length(2).optional(), // ISO 3166-1 alpha-2
  socialSecurityNumber: z.string().max(40).optional(),
  // Professional profile.
  bio: z.string().max(2000).optional(),
  yearsExperience: optionalInt,
  employedSince: optionalDate,
  requiredHours: z.coerce.number().min(0).max(744).optional().default(151.67),
  // Hours-account carryover (signed): positive = deficit owed, negative = credit.
  carryoverHours: z.coerce.number().min(-9999).max(9999).optional().default(0),
});

export const clientSchema = z.object({
  facilityName: z.string().min(2).max(160),
  // Dienstplan-Kürzel shown on the master schedule grid (2–3 letters/digits).
  shortCode: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : undefined),
    z.string().regex(/^[A-Z0-9ÄÖÜ]{2,3}$/).optional(),
  ),
  facilityType: z.enum(facilityTypes),
  address: z.string().max(240).optional(),
  contactPerson: z.string().max(120).optional(),
  billingInfo: z.string().max(500).optional(),
  // Surcharges entered as percentages (e.g. 25 = +25 %); stored as fractions.
  surchargeSat: z.coerce.number().min(0).max(500).optional(),
  surchargeSun: z.coerce.number().min(0).max(500).optional(),
  surchargeHoliday: z.coerce.number().min(0).max(500).optional(),
  surchargeNight: z.coerce.number().min(0).max(500).optional(),
  // Night window (HH:mm). Blank → platform default (20:00–06:00).
  nightStart: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
    z.string().regex(timeRegex).optional(),
  ),
  nightEnd: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
    z.string().regex(timeRegex).optional(),
  ),
  // Per-qualification hourly rates (EUR netto). Empty → platform default.
  ratePflegefachkraft: optionalRate,
  ratePflegehelfer: optionalRate,
  rateBetreuungskraft: optionalRate,
  ratePflegedienstleitung: optionalRate,
});

// ── Account provisioning (super_admin) ──
// Base login identity shared by every account type.
export const accountBaseSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(160),
  password: z.string().min(12, { message: "min12" }),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(12, { message: "min12" }),
});

// Changing an account's login email (super_admin) — it is the Supabase Auth
// identity, so the change must propagate to both Auth and our User row.
export const updateEmailSchema = z.object({
  email: z.string().email(),
});

// ── Service confirmation (Leistungsnachweis) ──
export const confirmationMethods = ["electronic", "upload"] as const;

export const serviceConfirmationSchema = z
  .object({
    assignmentId: z.string().uuid(),
    method: z.enum(confirmationMethods),
    // Any real number of hours (e.g. 7.8) — no fixed step (see confirm dialog).
    hoursWorked: z.coerce.number().min(0).max(24),
    clientNotes: z.string().max(2000).optional(),
    // Method A (electronic): the confirmer's typed full name; the legally binding
    // record is the timestamp + IP + consent baked into the PDF, not a drawn image.
    signerName: z.string().trim().min(2).max(120).optional(),
    // Optional legacy drawn signature (base64 PNG) — no longer required.
    signatureData: z.string().startsWith("data:image/").optional(),
    // Optional client-requested correction of the shift window (needs admin
    // approval). Both must be provided together; the note explains the change.
    adjustStart: z.string().regex(timeRegex).optional(),
    adjustEnd: z.string().regex(timeRegex).optional(),
  });

export type ServiceConfirmationInput = z.infer<typeof serviceConfirmationSchema>;

export type AccountBaseInput = z.infer<typeof accountBaseSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type OrderInput = z.infer<typeof orderSchema>;
export type WorkerInput = z.infer<typeof workerSchema>;
export type ClientInput = z.infer<typeof clientSchema>;
