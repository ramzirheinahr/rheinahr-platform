const fs = require("fs");
let content = fs.readFileSync("components/client/confirm-service-dialog.tsx", "utf-8");

content = content.replace('import { Button } from "@/components/ui/button";',
`import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";\nimport { Button } from "@/components/ui/button";`);

content = content.replace('FileSignature, FileText, ExternalLink, ShieldCheck, Clock } from "lucide-react";',
'FileSignature, FileText, ExternalLink, ShieldCheck, Clock, UploadCloud, Download } from "lucide-react";');

content = content.replace('  scheduledEnd?: string;\n}) {',
'  scheduledEnd?: string;\n  isAdmin?: boolean;\n}) {');

const formStart = '<form onSubmit={onSubmit} className="space-y-5">\n          <input type="hidden" name="assignmentId" value={assignmentId} />';
const formEnd = '</form>\n      </DialogContent>';

const idx1 = content.indexOf(formStart);
const idx2 = content.indexOf(formEnd);

if (idx1 !== -1 && idx2 !== -1) {
    const formHtml = content.substring(idx1, idx2 + '</form>'.length);
    const replacement = `{isAdmin ? (
          <Tabs defaultValue="electronic" className="mt-2">
            <TabsList className="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="electronic">Elektronisch</TabsTrigger>
              <TabsTrigger value="manual">Manuell (Upload)</TabsTrigger>
            </TabsList>
            <TabsContent value="electronic">
              ${formHtml.replace('className="space-y-5"', 'className="flex flex-col gap-5"')}
            </TabsContent>
            <TabsContent value="manual">
              <form action={async (formData) => {
                formData.set("method", "upload");
                formData.set("assignmentId", assignmentId);
                formData.set("hoursWorked", hours.toString());
                startTransition(async () => {
                   const res = await confirmService(formData);
                   if (res.ok) {
                     toast.success(t("confirmed"));
                     setOpen(false);
                     router.refresh();
                   } else {
                     toast.error(t("saveError"));
                   }
                });
              }} className="flex flex-col gap-5">
                <div className="rounded-lg border p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h4 className="text-sm font-medium">1. Vorlage herunterladen</h4>
                      <p className="text-xs text-muted-foreground">PDF generieren und manuell unterschreiben lassen.</p>
                    </div>
                    <Button asChild variant="outline" size="sm" className="gap-2">
                      <a href={\`/api/confirmations/\${assignmentId}/blank-pdf?hours=\${hours}\`} download>
                        <Download className="size-4" /> Download PDF
                      </a>
                    </Button>
                  </div>
                  
                  <div className="border-t pt-4 space-y-3">
                    <div className="space-y-1">
                      <h4 className="text-sm font-medium">2. Unterschriebenes Dokument hochladen</h4>
                      <p className="text-xs text-muted-foreground">Das eingescannte Dokument hier hochladen.</p>
                    </div>
                    <Input type="file" name="document" accept="application/pdf" required />
                  </div>

                  <div className="border-t pt-4 space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="manualHoursWorked">{t("hoursWorked")}</Label>
                      <Input
                        id="manualHoursWorked"
                        type="number"
                        step="any"
                        min={0}
                        max={24}
                        required
                        value={hours}
                        onChange={(e) => setHours(Number(e.target.value))}
                        className="max-w-32"
                      />
                    </div>
                  </div>
                </div>
                
                <Button type="submit" className="w-full gap-2" disabled={pending}>
                  <UploadCloud className="size-4" />
                  {pending ? c("loading") : "Hochladen & Bestätigen"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        ) : (
          ${formHtml}
        )}
      </DialogContent>`;

    const newContent = content.substring(0, idx1) + replacement + content.substring(idx2 + formEnd.length);
    fs.writeFileSync("components/client/confirm-service-dialog.tsx", newContent);
    console.log("Patched successfully");
} else {
    console.log("Failed to find form boundaries");
}
