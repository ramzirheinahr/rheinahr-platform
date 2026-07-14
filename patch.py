import re

with open("components/client/confirm-service-dialog.tsx", "r") as f:
    content = f.read()

# 1. Imports
content = content.replace('import { Button } from "@/components/ui/button";',
'''import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";''')

content = content.replace('FileSignature, FileText, ExternalLink, ShieldCheck, Clock } from "lucide-react";',
'FileSignature, FileText, ExternalLink, ShieldCheck, Clock, UploadCloud, Download } from "lucide-react";')

# 2. Props
content = content.replace('  scheduledEnd?: string;\n}) {',
'  scheduledEnd?: string;\n  isAdmin?: boolean;\n}) {')

# 3. Form logic
content = content.replace('const formData = new FormData(e.currentTarget);\n    formData.set("method", "electronic");',
'const formData = new FormData(e.currentTarget);\n    formData.set("method", "electronic");')

# 4. Extract form inner content
form_start = '<form onSubmit={onSubmit} className="space-y-5">\n          <input type="hidden" name="assignmentId" value={assignmentId} />'
form_end = '</form>\n      </DialogContent>'

start_idx = content.find(form_start)
end_idx = content.find(form_end) + len(form_end)

if start_idx != -1 and end_idx != -1:
    form_html = content[start_idx:end_idx - len('\n      </DialogContent>')]
    
    # We replace the outer <form ... > with our Tabs structure.
    # To do this safely, we will just construct the replacement manually.

    replacement = f"""{{isAdmin ? (
          <Tabs defaultValue="electronic" className="mt-2">
            <TabsList className="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="electronic">Elektronisch</TabsTrigger>
              <TabsTrigger value="manual">Manuell (Upload)</TabsTrigger>
            </TabsList>
            <TabsContent value="electronic">
              {form_html.replace('className="space-y-5"', 'className="flex flex-col gap-5"')}
            </TabsContent>
            <TabsContent value="manual">
              <form action={{async (formData) => {{
                formData.set("method", "upload");
                formData.set("assignmentId", assignmentId);
                formData.set("hoursWorked", hours.toString());
                startTransition(async () => {{
                   const res = await confirmService(formData);
                   if (res.ok) {{
                     toast.success(t("confirmed"));
                     setOpen(false);
                     router.refresh();
                   }} else {{
                     toast.error(t("saveError"));
                   }}
                }});
              }}}} className="flex flex-col gap-5">
                <div className="rounded-lg border p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h4 className="text-sm font-medium">1. Vorlage herunterladen</h4>
                      <p className="text-xs text-muted-foreground">PDF generieren und manuell unterschreiben lassen.</p>
                    </div>
                    <Button asChild variant="outline" size="sm" className="gap-2">
                      <a href={{`/api/confirmations/${{assignmentId}}/blank-pdf?hours=${{hours}}`}} download>
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
                      <Label htmlFor="manualHoursWorked">{{t("hoursWorked")}}</Label>
                      <Input
                        id="manualHoursWorked"
                        type="number"
                        step="any"
                        min={{0}}
                        max={{24}}
                        required
                        value={{hours}}
                        onChange={{(e) => setHours(Number(e.target.value))}}
                        className="max-w-32"
                      />
                    </div>
                  </div>
                </div>
                
                <Button type="submit" className="w-full gap-2" disabled={{pending}}>
                  <UploadCloud className="size-4" />
                  {{pending ? c("loading") : "Hochladen & Bestätigen"}}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        ) : (
          {form_html}
        )}
      </DialogContent>"""

    new_content = content[:start_idx] + replacement + content[end_idx:]

    with open("components/client/confirm-service-dialog.tsx", "w") as f:
        f.write(new_content)
    print("Patched successfully")
else:
    print("Could not find form block")
