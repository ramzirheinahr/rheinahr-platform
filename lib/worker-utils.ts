import { formatDateDE } from "@/lib/utils";

export function formatWorkerSalutation(salutation?: string | null): string {
  if (!salutation) return "";
  const s = salutation.toLowerCase().trim();
  if (s === "herr") return "Herr";
  if (s === "frau") return "Frau";
  return salutation;
}

export function formatWorkerDisplayName(worker: {
  fullName: string;
  salutation?: string | null;
}): string {
  const sal = formatWorkerSalutation(worker.salutation);
  return sal ? `${sal} ${worker.fullName}` : worker.fullName;
}

export function formatWorkerEmailIntro(worker: {
  fullName: string;
  salutation?: string | null;
}): string {
  const s = worker.salutation?.toLowerCase().trim();
  if (s === "frau") {
    return `unserer Mitarbeiterin <strong>Frau ${worker.fullName}</strong>`;
  }
  if (s === "herr") {
    return `unserem Mitarbeiter <strong>Herrn ${worker.fullName}</strong>`;
  }
  return `unserem Mitarbeiter / unserer Mitarbeiterin <strong>${worker.fullName}</strong>`;
}

export function formatWorkerBirthDate(birthDate?: Date | string | null): string {
  if (!birthDate) return "";
  const d = typeof birthDate === "string" ? new Date(birthDate) : birthDate;
  if (isNaN(d.getTime())) return "";
  return formatDateDE(d);
}

export const formatBirthDate = formatWorkerBirthDate;
