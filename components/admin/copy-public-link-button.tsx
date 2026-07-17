"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Link as LinkIcon, Check, Mail } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendPublicLinkEmail } from "@/app/[locale]/admin/orders/[id]/link-actions";

export function CopyPublicLinkButton({ 
  requestGroupId, 
  type = "confirm",
  contractId
}: { 
  requestGroupId: string,
  type?: "confirm" | "contract",
  contractId?: string
}) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleCopy = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    try {
      const path = type === "contract" ? "contract" : "confirm";
      let url = `${window.location.origin}/de/public/${path}/${requestGroupId}`;
      
      const params = new URLSearchParams();
      if (type === "contract" && contractId) {
        params.set("contractId", contractId);
      } else if (type === "confirm") {
        if (startDate) params.set("from", startDate);
        if (endDate) params.set("to", endDate);
      }

      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }

      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link erfolgreich kopiert!");
      if (type === "confirm") setOpen(false);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast.error("Fehler beim Kopieren des Links");
    }
  };

  const handleEmail = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    startTransition(async () => {
      const res = await sendPublicLinkEmail({
        requestGroupId,
        type,
        contractId,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      if (res.ok) {
        toast.success("E-Mail wurde erfolgreich gesendet!");
        if (type === "confirm") setOpen(false);
      } else {
        const msg = res.error === "no_shifts" 
          ? "Keine Schichten gefunden, E-Mail nicht gesendet." 
          : "Fehler beim Senden der E-Mail";
        toast.error(msg);
      }
    });
  };

  const buttonContent = (
    <>
      {copied ? <Check className="size-4" /> : <LinkIcon className="size-4" />}
      {type === "contract" ? "Link" : "Link kopieren"}
    </>
  );

  const buttonClass = "gap-2 shrink-0 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800";

  if (type === "confirm") {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="outline" size="sm" className={buttonClass} />}>
          {buttonContent}
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Link für Leistungsnachweise</DialogTitle>
            <DialogDescription>
              Wählen Sie einen Zeitraum (optional), um nur bestimmte Schichten im Link anzuzeigen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="startDate" className="text-right">
                Von
              </Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="endDate" className="text-right">
                Bis
              </Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
            <Button variant="outline" onClick={handleCopy} className="gap-2">
              <LinkIcon className="size-4" />
              Link kopieren
            </Button>
            <Button onClick={handleEmail} disabled={isPending} className="gap-2 bg-blue-600 hover:bg-blue-700">
              <Mail className="size-4" />
              {isPending ? "Sendet..." : "Per E-Mail senden"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button 
        variant="outline" 
        size="sm" 
        onClick={handleCopy}
        className={buttonClass}
        title="Link kopieren"
      >
        {buttonContent}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleEmail}
        disabled={isPending}
        className={buttonClass}
        title="Per E-Mail senden"
      >
        <Mail className="size-4" />
        {isPending ? "Sendet..." : "E-Mail"}
      </Button>
    </div>
  );
}
