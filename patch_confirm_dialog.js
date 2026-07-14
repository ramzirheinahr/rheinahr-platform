const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "components/client/confirm-service-dialog.tsx");
let content = fs.readFileSync(filePath, "utf-8");

// 1. Add Tabs import
if (!content.includes("Tabs,")) {
  content = content.replace(
    `import { Input } from "@/components/ui/input";`,
    `import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";\nimport { Input } from "@/components/ui/input";`
  );
}

// 2. Add Upload icon
if (!content.includes("UploadCloud")) {
  content = content.replace(
    `FileSignature, FileText, ExternalLink, ShieldCheck, Clock`,
    `FileSignature, FileText, ExternalLink, ShieldCheck, Clock, UploadCloud, Download`
  );
}

// 3. Add isAdmin prop to signature
if (!content.includes("isAdmin?: boolean;")) {
  content = content.replace(
    `scheduledEnd?: string;\n}) {`,
    `scheduledEnd?: string;\n  isAdmin?: boolean;\n}) {`
  );
}

// 4. Wrap form rendering
const formStart = `        <form onSubmit={onSubmit} className="flex flex-col gap-5">`;
const formEnd = `        </form>\n      </DialogContent>`;

const formContent = content.substring(content.indexOf(formStart), content.indexOf(formEnd) + 15);

const electronicForm = `
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          {/* hidden method input */}
          <input type="hidden" name="method" value="electronic" />
          ` + formContent.substring(15 + formStart.length).replace(`formData.set("method", "electronic");`, `// handled by hidden input`);

const manualForm = `
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
`;

const replaceWith = `
        {isAdmin ? (
          <Tabs defaultValue="electronic" className="mt-2">
            <TabsList className="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="electronic">Elektronisch</TabsTrigger>
              <TabsTrigger value="manual">Manuell (Upload)</TabsTrigger>
            </TabsList>
            <TabsContent value="electronic">
               ${formStart}${formContent.substring(formStart.length)}
            </TabsContent>
            <TabsContent value="manual">
               ${manualForm}
            </TabsContent>
          </Tabs>
        ) : (
          ${formStart}${formContent.substring(formStart.length)}
        )}
      </DialogContent>`;

content = content.replace(formContent + "\n      </DialogContent>", replaceWith);

fs.writeFileSync(filePath, content);
console.log("Patched confirm-service-dialog.tsx");
