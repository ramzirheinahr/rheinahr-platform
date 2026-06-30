import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BUCKET = "confirmations";
const { data: buckets } = await supabase.storage.listBuckets();
if (buckets?.some(b => b.name === BUCKET)) {
  console.log("bucket exists:", BUCKET);
} else {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "10MB", allowedMimeTypes: ["image/png","image/jpeg","application/pdf"] });
  if (error) { console.error("FAIL:", error.message); process.exitCode = 1; }
  else console.log("created private bucket:", BUCKET);
}
