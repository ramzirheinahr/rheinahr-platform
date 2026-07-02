"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw, Copy } from "lucide-react";

// Cryptographically-strong password the admin sets for a worker/client. Excludes
// look-alike characters (0/O, 1/l/I) and guarantees at least one of each class so
// it always satisfies the 12-char policy in lib/validations.ts.
function generatePassword(length = 16): string {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%&*?";
  const all = lower + upper + digits + symbols;
  const rand = (max: number) => crypto.getRandomValues(new Uint32Array(1))[0] % max;
  const pick = (set: string) => set[rand(set.length)];

  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (chars.length < length) chars.push(pick(all));
  // Fisher–Yates shuffle so the guaranteed characters aren't always in front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// Password input with "auto-generate" and "copy" buttons. Self-contained value
// state; `trailing` lets a parent drop a submit button on the same row.
export function PasswordField({
  id = "password",
  name = "password",
  placeholder,
  trailing,
}: {
  id?: string;
  name?: string;
  placeholder?: string;
  trailing?: React.ReactNode;
}) {
  const t = useTranslations("accounts");
  const c = useTranslations("common");
  const [value, setValue] = useState("");

  function onGenerate() {
    setValue(generatePassword());
  }

  async function onCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("passwordCopied"));
    } catch {
      toast.error(c("error"));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        id={id}
        name={name}
        type="text"
        minLength={12}
        required
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="max-w-sm font-mono"
      />
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={t("generatePassword")}
        title={t("generatePassword")}
        onClick={onGenerate}
      >
        <RefreshCw className="size-4" />
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={t("copyPassword")}
        title={t("copyPassword")}
        onClick={onCopy}
        disabled={!value}
      >
        <Copy className="size-4" />
      </Button>
      {trailing}
    </div>
  );
}
