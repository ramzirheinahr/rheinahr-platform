"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClientSubUser, updateClientSubUser } from "./actions";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";

export type SubUser = {
  id: string;
  email: string;
  fullName: string | null;
  jobTitle: string | null;
  active: boolean;
  isMainUser: boolean;
};

export function SubUsersSection({ users, isMainUser, clientId }: { users: SubUser[], isMainUser: boolean, clientId?: string }) {
  const t = useTranslations("clientUsers");
  const c = useTranslations("common");
  const router = useRouter();
  
  const [editingUser, setEditingUser] = useState<SubUser | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = isCreating
        ? await createClientSubUser(formData, clientId)
        : await updateClientSubUser(editingUser!.id, formData, clientId);
        
      if (res.ok) {
        toast.success(isCreating ? t("created") : t("updated"));
        setEditingUser(null);
        setIsCreating(false);
        router.refresh();
      } else {
        toast.error(t(res.error as any));
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t("title")}</h2>
        {isMainUser && (
          <Button onClick={() => setIsCreating(true)} variant="outline" className="gap-2">
            <Plus className="size-4" />
            {t("new")}
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 text-muted-foreground border-b">
            <tr>
              <th className="px-4 py-3 font-medium">{t("jobTitle")}</th>
              <th className="px-4 py-3 font-medium">{c("name")}</th>
              <th className="px-4 py-3 font-medium">{c("email")}</th>
              <th className="px-4 py-3 font-medium">{t("active")}</th>
              {isMainUser && <th className="px-4 py-3 text-right font-medium">{c("actions")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">
                  {user.jobTitle || (user.isMainUser ? t("mainUser") : c("none"))}
                  {user.isMainUser && (
                    <Badge variant="outline" className="ml-2 text-xs">{t("mainUser")}</Badge>
                  )}
                </td>
                <td className="px-4 py-3">{user.fullName || c("none")}</td>
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">
                  <Badge variant={user.active ? "default" : "secondary"}>
                    {user.active ? "Ja" : "Nein"}
                  </Badge>
                </td>
                {isMainUser && (
                  <td className="px-4 py-3 text-right">
                    {!user.isMainUser && (
                      <button
                        onClick={() => setEditingUser(user)}
                        className="text-primary hover:underline"
                      >
                        {c("edit")}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {users.length <= 1 && (
          <div className="p-4 text-center text-muted-foreground text-sm">
            {t("empty")}
          </div>
        )}
      </div>

      <Dialog open={isCreating || !!editingUser} onOpenChange={(open) => {
        if (!open) {
          setIsCreating(false);
          setEditingUser(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isCreating ? t("new") : t("edit")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">{c("name")}</Label>
              <Input id="fullName" name="fullName" defaultValue={editingUser?.fullName || ""} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{c("email")}</Label>
              <Input id="email" name="email" type="email" defaultValue={editingUser?.email || ""} required />
            </div>
            {isCreating && (
              <div className="space-y-2">
                <Label htmlFor="password">{c("password")}</Label>
                <Input id="password" name="password" type="password" required minLength={12} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="jobTitle">{t("jobTitle")}</Label>
              <Input id="jobTitle" name="jobTitle" placeholder={t("jobTitlePlaceholder")} defaultValue={editingUser?.jobTitle || ""} />
            </div>
            <div className="flex items-center space-x-2 pt-2">
              <input 
                type="checkbox" 
                id="active" 
                name="active" 
                defaultChecked={editingUser?.active ?? true} 
                className="size-4 accent-primary" 
              />
              <Label htmlFor="active">{t("active")}</Label>
            </div>
            <div className="pt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { setIsCreating(false); setEditingUser(null); }}>
                {c("cancel")}
              </Button>
              <Button type="submit" disabled={isPending}>{c("save")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
