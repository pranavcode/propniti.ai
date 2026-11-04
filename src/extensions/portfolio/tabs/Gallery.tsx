"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Images } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type Photo = { src: string; thumb: string; caption: string };

// Photo mosaic (1 large + up to 4 small) or a strip, with a keyboard lightbox: ←/→ to move, Esc to close.
export function Gallery({ photos, title, variant = "mosaic", className }: { photos: Photo[]; title: string; variant?: "mosaic" | "strip"; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const n = photos.length;
  const step = useCallback((d: number) => setOpen((i) => (i == null ? i : (i + d + n) % n)), [n]);

  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step]);

  if (!n) return null;
  const tile = (p: Photo, i: number, cls: string, big = false) => (
    <button key={p.src} type="button" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1} of ${n}: ${p.caption}`}
      className={cn("group/ph relative overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring", cls)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static webp in /public; the Workers build has no image optimizer */}
      <img src={big ? p.src : p.thumb} alt={`${title}: ${p.caption}`} loading={big ? "eager" : "lazy"} className="size-full object-cover transition-transform duration-500 group-hover/ph:scale-[1.03] motion-reduce:transition-none" />
      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">{p.caption}</span>
    </button>
  );

  return (
    <div className={className}>
      {variant === "mosaic" ? (
        <div className="relative grid h-[340px] grid-cols-4 grid-rows-2 gap-1.5 overflow-hidden rounded-lg">
          {tile(photos[0], 0, n === 1 ? "col-span-4 row-span-2" : "col-span-2 row-span-2", true)}
          {photos.slice(1, 5).map((p, i) => tile(p, i + 1, n === 2 ? "col-span-2 row-span-2" : n === 3 || (n === 4 && i === 2) ? "col-span-2" : "col-span-1"))}
          {n > 1 && (
            <button type="button" onClick={() => setOpen(0)} className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1.5 rounded-md border bg-background/95 px-2.5 py-1 text-[12px] font-medium shadow-sm hover:bg-background">
              <Images className="size-3.5" /> All {n} photos
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {photos.slice(0, 4).map((p, i) => tile(p, i, "aspect-[4/3] rounded-md", false))}
        </div>
      )}

      <Dialog open={open != null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-[min(1100px,94vw)] gap-0 overflow-hidden border-0 bg-black p-0 sm:max-w-[min(1100px,94vw)] [&_[data-slot=dialog-close]]:z-10 [&_[data-slot=dialog-close]]:bg-white/15 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:hover:bg-white/30">
          {open != null && (
            <>
              <DialogTitle className="sr-only">{title}: {photos[open].caption}</DialogTitle>
              <DialogDescription className="sr-only">Photo {open + 1} of {n}. Use the left and right arrow keys to move between photos.</DialogDescription>
              <div className="relative flex aspect-[3/2] max-h-[78vh] items-center justify-center bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element -- full-size static webp */}
                <img src={photos[open].src} alt={`${title}: ${photos[open].caption}`} className="max-h-full max-w-full object-contain" />
                {n > 1 && (
                  <>
                    <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="absolute top-1/2 left-3 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/30"><ChevronLeft className="size-5" /></button>
                    <button type="button" onClick={() => step(1)} aria-label="Next photo" className="absolute top-1/2 right-3 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/30"><ChevronRight className="size-5" /></button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 bg-black px-4 py-2.5 text-[12.5px] text-white/85">
                <span className="font-medium text-white">{photos[open].caption}</span>
                <span className="text-white/60">{title}</span>
                <span className="ml-auto tabular-nums text-white/60">{open + 1} / {n}</span>
              </div>
              {n > 1 && (
                <div className="flex gap-1.5 overflow-x-auto bg-black px-4 pb-3">
                  {photos.map((p, i) => (
                    <button key={p.src} type="button" onClick={() => setOpen(i)} aria-label={`Show ${p.caption}`} aria-current={i === open}
                      className={cn("h-12 w-[72px] shrink-0 overflow-hidden rounded opacity-50 ring-white transition-opacity hover:opacity-100", i === open && "opacity-100 ring-2")}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- 400px thumb */}
                      <img src={p.thumb} alt="" className="size-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
