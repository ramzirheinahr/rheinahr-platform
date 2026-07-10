"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { SignaturePadField } from "@/components/client/signature-pad-field";
import { signContract } from "./actions";
import { toast } from "sonner";
import { format } from "date-fns";
import { FileSignature } from "lucide-react";

export function ContractSignDialog({ contract }: { contract: any }) {
  const router = useRouter();
  const t = useTranslations("contracts");
  const [open, setOpen] = useState(false);
  const [signatureData, setSignatureData] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSign(e: React.FormEvent) {
    e.preventDefault();
    if (!signatureData) {
      toast.error("Please provide a signature");
      return;
    }
    
    setSubmitting(true);
    try {
      await signContract(contract.id, signatureData);
      toast.success("Contract signed successfully");
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message || "Failed to sign contract");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" className="gap-2" />}>
        <FileSignature className="size-4" />
        {t("sign")}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Arbeitnehmerüberlassungsvertrag</DialogTitle>
          <DialogDescription>
            Please review the shifts included in this contract and sign below.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          <div className="rounded-md border p-4 bg-muted/20 space-y-2">
            <h3 className="font-semibold text-lg">Contract Details</h3>
            <p className="text-sm"><strong>Period:</strong> {contract.period}</p>
            <p className="text-sm"><strong>Shifts:</strong> {contract.assignments?.length}</p>
            
            <div className="mt-4 pt-4 border-t">
              <h4 className="font-medium mb-2">Included Assignments:</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {contract.assignments?.map((a: any) => (
                  <li key={a.id} className="flex justify-between">
                    <span>{format(new Date(a.order.shiftDate), "dd.MM.yyyy")}</span>
                    <span>{a.order.startTime} - {a.order.endTime}</span>
                    <span className="font-medium">{a.worker.fullName}</span>
                    <span className="capitalize">{a.order.requiredQualification}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <form onSubmit={handleSign} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Your Signature</label>
              <SignaturePadField name="signatureData" onChange={setSignatureData} />
            </div>
            
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!signatureData || submitting}>
                {submitting ? "Signing..." : "Sign and Confirm"}
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
