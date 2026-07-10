"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { FileSignature, Upload, Download, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";

export function ArbeitsvertragSection({ 
  workerId,
  url,
  signedAt 
}: { 
  workerId: string;
  url: string | null;
  signedAt: Date | null;
}) {
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/workers/${workerId}/upload-arbeitsvertrag`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        window.location.reload();
      } else {
        alert("Fehler beim Hochladen");
      }
    } catch (err) {
      console.error(err);
      alert("Fehler beim Hochladen");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col space-y-1.5 p-6 border-b">
        <h3 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
          <FileSignature className="size-5" />
          Arbeitsvertrag (iGZ)
        </h3>
        <p className="text-sm text-muted-foreground">
          Generieren Sie den Arbeitsvertrag oder laden Sie eine unterschriebene Version hoch.
        </p>
      </div>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <h4 className="font-medium">Vertrag generieren</h4>
            <p className="text-sm text-muted-foreground">
              Lädt den vorausgefüllten Arbeitsvertrag als PDF herunter.
            </p>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => window.open(`/api/workers/${workerId}/arbeitsvertrag`, "_blank")}>
            <Download className="size-4" />
            PDF herunterladen
          </Button>
        </div>

        <div className="flex items-center gap-4 border-t pt-6">
          <div className="flex-1">
            <h4 className="font-medium">Unterschriebenen Vertrag hochladen</h4>
            <p className="text-sm text-muted-foreground">
              Laden Sie das vom Mitarbeiter unterschriebene Dokument hoch, um es im System zu speichern.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input 
              type="file" 
              accept="application/pdf" 
              className="max-w-[250px]"
              onChange={handleUpload}
              disabled={isUploading}
            />
            {isUploading && <span className="text-sm text-muted-foreground">Lädt...</span>}
          </div>
        </div>

        {url && signedAt && (
          <div className="flex items-center gap-3 p-4 bg-green-50 text-green-900 rounded-md border border-green-200">
            <CheckCircle2 className="size-5 text-green-600" />
            <div className="flex-1">
              <p className="font-medium">Vertrag unterschrieben und hochgeladen</p>
              <p className="text-sm text-green-700/80">Am {format(new Date(signedAt), "dd.MM.yyyy HH:mm")} Uhr</p>
            </div>
            <Button variant="outline" size="sm" className="bg-white" onClick={() => window.open(url, "_blank")}>
              Ansehen
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
