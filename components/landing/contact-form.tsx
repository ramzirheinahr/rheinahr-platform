"use client";

import { useTransition, useRef } from "react";
import { submitContactRequest } from "@/app/[locale]/contact-actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

export function ContactForm() {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await submitContactRequest(formData);
      if (result.success) {
        toast.success("Ihre Anfrage wurde erfolgreich gesendet!");
        formRef.current?.reset();
      } else {
        toast.error(result.error || "Ein Fehler ist aufgetreten.");
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-4 w-full text-left">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" placeholder="Max Mustermann" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-Mail</Label>
          <Input id="email" name="email" type="email" placeholder="max@beispiel.de" required />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="phone">Telefonnummer</Label>
          <Input id="phone" name="phone" type="tel" placeholder="+49 123 456789" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company">Einrichtung / Firma</Label>
          <Input id="company" name="company" placeholder="Pflegeheim Sonnenschein" required />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="message">Ihre Nachricht</Label>
        <Textarea id="message" name="message" placeholder="Wie können wir Ihnen helfen?" rows={4} required />
      </div>
      <Button type="submit" size="lg" className="w-full sm:w-auto sm:place-self-end mt-2" disabled={isPending}>
        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
        Anfrage senden
      </Button>
    </form>
  );
}
