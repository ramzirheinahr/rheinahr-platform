"use client";

import { useState, useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Upload, Trash2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { updateSystemSetting, createSystemAssetUploadUrl } from "@/app/[locale]/admin/settings/system/actions";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function ImageUploadField({
  label,
  settingKey,
  initialUrl,
}: {
  label: string;
  settingKey: string;
  initialUrl: string | null;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error("Invalid file type (PNG, JPEG, WEBP allowed)");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File is too large (Max 5MB)");
      return;
    }

    start(async () => {
      try {
        const { path, token } = await createSystemAssetUploadUrl(file.name);
        
        const supabase = createSupabaseBrowserClient();
        const { error: uploadError } = await supabase.storage
          .from("system-assets")
          .uploadToSignedUrl(path, token, file, { contentType: file.type });

        if (uploadError) {
          toast.error("Upload failed: " + uploadError.message);
          return;
        }

        const { data: { publicUrl } } = supabase.storage
          .from("system-assets")
          .getPublicUrl(path);

        await updateSystemSetting(settingKey, publicUrl);
        setUrl(publicUrl);
        toast.success(`${label} updated successfully!`);
      } catch (err: any) {
        toast.error(err.message || "Failed to upload image");
      }
    });
  }

  function onDelete() {
    start(async () => {
      await updateSystemSetting(settingKey, "");
      setUrl(null);
      toast.success(`${label} removed`);
    });
  }

  return (
    <div className="flex items-start gap-6 rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex size-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="size-full object-cover" />
        ) : (
          <ImageIcon className="size-10 text-muted-foreground opacity-50" />
        )}
      </div>
      <div className="space-y-2 flex-1">
        <h4 className="font-semibold text-lg">{label}</h4>
        <p className="text-sm text-muted-foreground">
          Recommended size: 1920x1080 (Hero) or 800x800 (Sections). Max 5MB.
        </p>
        <div className="pt-4 flex flex-wrap gap-3">
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
          <Button type="button" variant="secondary" disabled={pending} onClick={() => inputRef.current?.click()} className="gap-2">
            <Upload className="size-4" />
            {pending ? "Uploading..." : "Upload Image"}
          </Button>
          {url && (
            <Button type="button" variant="outline" disabled={pending} onClick={onDelete} className="gap-2 text-destructive">
              <Trash2 className="size-4" />
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SystemSettingsForm({ settings }: { settings: Record<string, string> }) {
  return (
    <div className="grid gap-6">
      <ImageUploadField
        label="Landing Page - Hero Image"
        settingKey="landing.hero_image"
        initialUrl={settings["landing.hero_image"] || null}
      />
      <ImageUploadField
        label="Landing Page - Facilities Section"
        settingKey="landing.facilities_image"
        initialUrl={settings["landing.facilities_image"] || null}
      />
      <ImageUploadField
        label="Landing Page - Workers Section"
        settingKey="landing.workers_image"
        initialUrl={settings["landing.workers_image"] || null}
      />
      <ImageUploadField
        label="App Icon (Favicon & PWA)"
        settingKey="company.iconUrl"
        initialUrl={settings["company.iconUrl"] || null}
      />
    </div>
  );
}
