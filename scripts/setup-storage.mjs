import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Private buckets — files are only ever served through short-lived signed URLs.
const BUCKETS = [
  { name: "confirmations", public: false, allowedMimeTypes: ["image/png", "image/jpeg", "application/pdf"] },
  // Worker profile photos + uploaded certificates/ID/vaccination docs.
  { name: "worker-files", public: false, allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "application/pdf"] },
  // Public system assets like landing page images
  { name: "system-assets", public: true, allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] },
];

const { data: existing } = await supabase.storage.listBuckets();
for (const b of BUCKETS) {
  if (existing?.some((e) => e.name === b.name)) {
    console.log("bucket exists:", b.name);
    // Ensure public status is correct
    await supabase.storage.updateBucket(b.name, { public: b.public, allowedMimeTypes: b.allowedMimeTypes });
    continue;
  }
  const { error } = await supabase.storage.createBucket(b.name, {
    public: b.public,
    fileSizeLimit: "10MB",
    allowedMimeTypes: b.allowedMimeTypes,
  });
  if (error) { console.error("FAIL:", b.name, error.message); process.exitCode = 1; }
  else console.log("created private bucket:", b.name);
}
