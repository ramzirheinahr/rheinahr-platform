import { prisma } from "@/lib/prisma";

// The subset of worker data shown on the client-facing professional profile.
// No sensitive PII (birth date, nationality, SV-Nr, address, phone).
export type WorkerProfileData = {
  id: string;
  fullName: string;
  qualification: string;
  languages: string[];
  skills: string[];
  certifications: string[];
  yearsExperience: number | null;
  employedSince: Date | null;
  bio: string | null;
  hasPhoto: boolean;
  verifiedCertCount: number;
  birthDate: Date | null;
  verifiedCertificates: { id: string; fileName: string }[];
};

export async function getWorkerProfileData(
  id: string,
): Promise<WorkerProfileData | null> {
  const w = await prisma.worker
    .findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        qualification: true,
        languages: true,
        skills: true,
        certifications: true,
        yearsExperience: true,
        employedSince: true,
        bio: true,
        photoPath: true,
        birthDate: true,
        documents: {
          where: { verified: true },
          select: { id: true, fileName: true },
        },
      },
    })
    .catch(() => null);
  if (!w) return null;

  return {
    id: w.id,
    fullName: w.fullName,
    qualification: w.qualification,
    languages: w.languages,
    skills: w.skills,
    certifications: w.certifications,
    yearsExperience: w.yearsExperience,
    employedSince: w.employedSince,
    bio: w.bio,
    hasPhoto: !!w.photoPath,
    verifiedCertCount: w.documents.length,
    birthDate: w.birthDate,
    verifiedCertificates: w.documents,
  };
}
