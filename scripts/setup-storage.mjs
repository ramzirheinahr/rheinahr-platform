// Provision private local buckets for document storage.
import { mkdir, chmod } from "node:fs/promises";
import path from "node:path";

const root = process.env.LOCAL_STORAGE_DIR;
if (!root || !path.isAbsolute(root)) {
  console.error("LOCAL_STORAGE_DIR must be an absolute path");
  process.exit(1);
}
for (const bucket of ["confirmations", "worker-files", "system-assets"]) {
  const directory = path.join(root, bucket);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  console.log(`Ready: ${bucket}`);
}
