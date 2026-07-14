"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Link as LinkIcon, Check } from "lucide-react";
import { toast } from "sonner";

export function CopyPublicLinkButton({ requestGroupId }: { requestGroupId: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      // The public route is unauthenticated, locale doesn't heavily matter, we use /de/
      const url = `${window.location.origin}/de/public/confirm/${requestGroupId}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link erfolgreich kopiert!");
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast.error("Fehler beim Kopieren des Links");
    }
  };

  return (
    <Button 
      variant="outline" 
      size="sm" 
      onClick={handleCopy}
      className="gap-2 shrink-0 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800"
    >
      {copied ? <Check className="size-4" /> : <LinkIcon className="size-4" />}
      Öffentlichen Link kopieren
    </Button>
  );
}
