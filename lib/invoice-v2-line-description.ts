import { defaultQualificationLabel } from "./invoice-exact-engine";

type V2LineDescriptionSource = {
  description: string;
  workerName?: unknown;
  qualification?: unknown;
  itemCategory?: unknown;
};

/** Display only frozen line-item identity; never look up a worker's current name. */
export function describeV2LineWithWorker(item: V2LineDescriptionSource, qualificationNames?: Record<string, string>): string {
  const description = item.description.trim();
  const workerName = typeof item.workerName === "string" ? item.workerName.trim() : "";
  if (!workerName || description.includes(workerName)) return description;

  if (item.itemCategory === "base") {
    const qualification = typeof item.qualification === "string" ? item.qualification.trim() : "";
    return qualification
      ? `${workerName} (${qualificationNames?.[qualification] || defaultQualificationLabel(qualification)})`
      : workerName;
  }

  return `${description} (${workerName})`;
}
