"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";

// Signature capture (CLAUDE.md MVP signature_pad). Writes the PNG data URL into
// a hidden input so the surrounding <form> submits it as `name`.
export function SignaturePadField({ name }: { name: string }) {
  const t = useTranslations("confirmations");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Match the backing store to the display size for crisp strokes.
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d")?.scale(ratio, ratio);

    const pad = new SignaturePad(canvas, { penColor: "#1e3a8a" });
    padRef.current = pad;
    const onEnd = () => setValue(pad.isEmpty() ? "" : pad.toDataURL("image/png"));
    pad.addEventListener("endStroke", onEnd);

    return () => {
      pad.removeEventListener("endStroke", onEnd);
      pad.off();
    };
  }, []);

  function clear() {
    padRef.current?.clear();
    setValue("");
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        className="h-40 w-full touch-none rounded-lg border bg-background"
      />
      <input type="hidden" name={name} value={value} />
      <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={clear}>
        <Eraser className="size-4" />
        {t("clear")}
      </Button>
    </div>
  );
}
