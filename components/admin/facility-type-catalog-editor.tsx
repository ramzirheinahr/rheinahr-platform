"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Building2 } from "lucide-react";
import {
  createFacilityTypeAction,
  updateFacilityTypeAction,
  deleteFacilityTypeAction,
} from "@/app/[locale]/admin/settings/system/facility-type-actions";
import type { FacilityTypeItem } from "@/lib/facility-type-shared";
import { facilityTypeName } from "@/lib/facility-type-shared";

export function FacilityTypeCatalogEditor({
  initialItems,
}: {
  initialItems: FacilityTypeItem[];
}) {
  const t = useTranslations("facilityTypeCatalog");
  const locale = useLocale();
  const router = useRouter();

  const [isPending, startTransition] = useTransition();
  const [items, setItems] = useState<FacilityTypeItem[]>(initialItems);

  // New item form state
  const [newCode, setNewCode] = useState("");
  const [newNameDe, setNewNameDe] = useState("");
  const [newNameEn, setNewNameEn] = useState("");
  const [newNameAr, setNewNameAr] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newNameDe.trim()) {
      toast.error(t("fillRequired"));
      return;
    }

    startTransition(async () => {
      const res = await createFacilityTypeAction({
        code: newCode.trim(),
        nameDe: newNameDe.trim(),
        nameEn: newNameEn.trim() || newNameDe.trim(),
        nameAr: newNameAr.trim() || newNameDe.trim(),
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      toast.success(t("createdSuccess"));
      setNewCode("");
      setNewNameDe("");
      setNewNameEn("");
      setNewNameAr("");
      router.refresh();
    });
  };

  const handleUpdate = (item: FacilityTypeItem, newActive?: boolean) => {
    const active = newActive !== undefined ? newActive : item.active;

    startTransition(async () => {
      const res = await updateFacilityTypeAction({
        code: item.code,
        nameDe: item.nameDe,
        nameEn: item.nameEn,
        nameAr: item.nameAr,
        sortOrder: item.sortOrder,
        active,
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      toast.success(t("savedSuccess"));
      router.refresh();
    });
  };

  const handleDelete = (code: string, count?: number) => {
    if (count && count > 0) {
      toast.error(t("cannotDeleteUsed"));
      return;
    }

    if (!confirm(t("deleteConfirm"))) {
      return;
    }

    startTransition(async () => {
      const res = await deleteFacilityTypeAction(code);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      toast.success(t("deletedSuccess"));
      setItems((prev) => prev.filter((i) => i.code !== code));
      router.refresh();
    });
  };

  const handleChangeField = (
    code: string,
    field: "nameDe" | "nameEn" | "nameAr" | "sortOrder",
    value: string
  ) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.code !== code) return item;
        return {
          ...item,
          [field]: field === "sortOrder" ? parseInt(value, 10) || 0 : value,
        };
      })
    );
  };

  return (
    <section className="space-y-6 rounded-xl border p-4 sm:p-6 bg-card">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-sky-100 dark:bg-sky-950/60 p-2 text-sky-700 dark:text-sky-300">
          <Building2 className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
      </div>

      {/* Add New Type Form */}
      <form onSubmit={handleCreate} className="rounded-lg border bg-muted/20 p-4 space-y-4">
        <div className="font-medium text-sm text-foreground flex items-center gap-1.5">
          <Plus className="size-4" />
          {t("addNewTitle")}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-code" className="text-xs">
              {t("code")} *
            </Label>
            <Input
              id="new-code"
              placeholder={t("codePlaceholder")}
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              required
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-name-de" className="text-xs">
              {t("nameDe")} *
            </Label>
            <Input
              id="new-name-de"
              placeholder="z. B. Rehaklinik"
              value={newNameDe}
              onChange={(e) => setNewNameDe(e.target.value)}
              required
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-name-en" className="text-xs">
              {t("nameEn")}
            </Label>
            <Input
              id="new-name-en"
              placeholder="e.g. Rehab Clinic"
              value={newNameEn}
              onChange={(e) => setNewNameEn(e.target.value)}
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-name-ar" className="text-xs">
              {t("nameAr")}
            </Label>
            <Input
              id="new-name-ar"
              placeholder="مثال: مركز تأهيل"
              value={newNameAr}
              onChange={(e) => setNewNameAr(e.target.value)}
              className="text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
            <Plus className="size-4" />
            {t("addButton")}
          </Button>
        </div>
      </form>

      {/* Existing Facility Types List */}
      <div className="space-y-3">
        {items.map((item) => {
          const clientCount = item.clientCount ?? 0;
          return (
            <div
              key={item.code}
              className={`space-y-3 rounded-lg border p-4 transition-colors ${
                item.active ? "bg-background" : "bg-muted/40 opacity-75"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">
                    {facilityTypeName(item, locale)}
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {item.code}
                  </Badge>
                  <Badge
                    variant={item.active ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {item.active ? t("active") : t("archived")}
                  </Badge>
                  {clientCount > 0 ? (
                    <Badge variant="outline" className="text-[10px] text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40">
                      {t("usedBy", { count: clientCount })}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      {t("unused")}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => handleUpdate(item)}
                    className="h-8 text-xs"
                  >
                    {t("save")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => handleUpdate(item, !item.active)}
                    className="h-8 text-xs"
                  >
                    {item.active ? t("archive") : t("reactivate")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isPending || clientCount > 0}
                    onClick={() => handleDelete(item.code, clientCount)}
                    title={clientCount > 0 ? t("cannotDeleteUsed") : t("delete")}
                    className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10 disabled:opacity-30"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">{t("nameDe")}</Label>
                  <Input
                    value={item.nameDe}
                    onChange={(e) => handleChangeField(item.code, "nameDe", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">{t("nameEn")}</Label>
                  <Input
                    value={item.nameEn}
                    onChange={(e) => handleChangeField(item.code, "nameEn", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">{t("nameAr")}</Label>
                  <Input
                    value={item.nameAr}
                    onChange={(e) => handleChangeField(item.code, "nameAr", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">{t("sortOrder")}</Label>
                  <Input
                    type="number"
                    value={item.sortOrder}
                    onChange={(e) => handleChangeField(item.code, "sortOrder", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
