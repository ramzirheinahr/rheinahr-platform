import "server-only";

import { prisma } from "@/lib/prisma";
import { createLocalStorageClient } from "@/lib/local-storage";
import { WORKER_FILES_BUCKET } from "@/lib/worker-files";

// Verified certification files of the given workers, as email attachments.
// Server-only helper — deliberately NOT in a "use server" file, where every
// export becomes a publicly callable endpoint without its callers' auth checks.
export async function getCertificatesForWorkers(workerIds: string[]) {
  if (workerIds.length === 0) return undefined;
  const uniqueWorkerIds = [...new Set(workerIds)];
  const docs = await prisma.workerDocument.findMany({
    where: { workerId: { in: uniqueWorkerIds }, category: "certification", verified: true },
  });
  if (docs.length === 0) return undefined;

  const storage = createLocalStorageClient();
  const loaded = await Promise.all(
    docs.map(async (doc) => {
      const { data, error } = await storage.storage.from(WORKER_FILES_BUCKET).download(doc.filePath);
      if (data && !error) {
        const buffer = Buffer.from(await data.arrayBuffer());
        return { filename: doc.fileName, content: buffer };
      }
      return null;
    })
  );
  return loaded.filter(Boolean) as { filename: string; content: Buffer }[];
}
