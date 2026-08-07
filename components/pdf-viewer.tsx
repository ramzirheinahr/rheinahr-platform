"use client";

import { useEffect, useRef, useState } from "react";

export function PdfViewer({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadPdf = async () => {
      try {
        setLoading(true);
        // Load PDF.js dynamically if not already loaded
        const pdfjsLib = (window as any).pdfjsLib;
        if (!pdfjsLib) {
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
          (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }

        const loadingTask = (window as any).pdfjsLib.getDocument({ url, withCredentials: true });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        if (!active) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const parentWidth = canvas.parentElement?.clientWidth || 300;
        // Start with unscaled viewport to determine base width
        const viewport = page.getViewport({ scale: 1 });
        // Scale to fit 100% of parent width, keeping ratio
        const scale = parentWidth / viewport.width;
        const scaledViewport = page.getViewport({ scale });

        canvas.height = scaledViewport.height;
        canvas.width = scaledViewport.width;

        await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
        if (active) setLoading(false);
      } catch (err) {
        console.error("PDF rendering error:", err);
        if (active) {
          setError(true);
          setLoading(false);
        }
      }
    };

    loadPdf();
    return () => {
      active = false;
    };
  }, [url]);

  if (error) {
    // Fallback for browsers if JS render fails
    return <iframe src={url} className="w-full h-full border-0" title="PDF Preview" />;
  }

  return (
    <div className="w-full h-full overflow-y-auto flex justify-center bg-slate-200/50 relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
          <span className="text-sm text-slate-500 animate-pulse">Lade Dokument...</span>
        </div>
      )}
      <canvas ref={canvasRef} className="max-w-full shadow-sm bg-white" />
    </div>
  );
}
