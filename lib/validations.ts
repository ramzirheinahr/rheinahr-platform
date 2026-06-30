import { z } from "zod";

// Zod schemas — single source of truth for API-boundary validation (CLAUDE.md §9).
// Enum values mirror prisma/schema.prisma exactly.

export const qualifications = [
  "pflegefachkraft",
  "altenpfleger",
  "gesundheitspfleger",
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

export const workerSchema = z.object({
  fullName: z.string().min(2).max(120),
  qualification: z.enum(qualifications),
  contractType: z.enum(contractTypes),
  certifications: z.array(z.string().max(120)).default([]),
  languages: z.array(z.enum(locales)).default([]),
  phone: z.string().max(40).optional(),
  address: z.string().max(240).optional(),
});

export const clientSchema = z.object({
  facilityName: z.string().min(2).max(160),
  facilityType: z.enum(facilityTypes),
  address: z.string().max(240).optional(),
  contactPerson: z.string().max(120).optional(),
  billingInfo: z.string().max(500).optional(),
});

// ── Account provisioning (super_admin) ──
// Base login identity shared by every account type.
export const accountBaseSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(160),
  password: z.string().min(12, { message: "min12" }),
});

// Worker / client profile fields, without duplicated identity fields (fullName
// comes from the account base).
export const workerProfileSchema = workerSchema.omit({ fullName: true });
export const clientProfileSchema = clientSchema;

// Updating an account: role, display name and active flag (email is immutable —
// it is the auth identity). Password reset is a separate action.
export const updateAccountSchema = z.object({
  fullName: z.string().min(2).max(160),
  role: z.enum(assignableRoles),
  active: z.boolean(),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(12, { message: "min12" }),
});

// ── Service confirmation (Leistungsnachweis) ──
export const confirmationMethods = ["electronic", "upload"] as const;

export const serviceConfirmationSchema = z
  .object({
    assignmentId: z.string().uuid(),
    method: z.enum(confirmationMethods),
    hoursWorked: z.coerce.number().min(0).max(24),
    // Method A: base64 PNG from the signature pad.
    signatureData: z.string().startsWith("data:image/").optional(),
  })
  .refine((v) => v.method !== "electronic" || !!v.signatureData, {
    message: "signatureRequired",
    path: ["signatureData"],
  });

export type ServiceConfirmationInput = z.infer<typeof serviceConfirmationSchema>;

export type AccountBaseInput = z.infer<typeof accountBaseSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type OrderInput = z.infer<typeof orderSchema>;
export type WorkerInput = z.infer<typeof workerSchema>;
export type ClientInput = z.infer<typeof clientSchema>;
