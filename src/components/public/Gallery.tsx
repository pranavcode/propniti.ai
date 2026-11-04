"use client";
/* eslint-disable @next/next/no-img-element -- every photo ships pre-sized (400 px thumbnail + full WebP), so plain lazy <img> with fixed dimensions is enough and works the same on the Workers build */

import { useState } from "react";
import { ChevronLeft, ChevronRight, Images } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type Photo = { src: string; alt: string; group: "Property" | "Home" };

const thumb = (src: string) => src.replace(/\.webp$/, "-400.webp");

// Hero plus four thumbnails; any photo opens a full-size viewer with arrow-key navigation.
// Grid tiles use the 400 px thumbnails; only the viewer loads full-size images.
export function Gallery({ photos }: { photos: Photo[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const show = (i: number) => setOpen((i + photos.length) % photos.length);
  const current = open == null ? null : photos[open];

  return (
    <>
      <div className="grid gap-2 overflow-hidden rounded-2xl sm:grid-cols-4 sm:grid-rows-2 sm:[height:min(56vw,460px)]">
        {photos.slice(0, 5).map((p, i) => (
          <button
            key={p.src + i}
            type="button"
            onClick={() => setOpen(i)}
            className={cn("group relative overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", i === 0 ? "aspect-[4/3] sm:col-span-2 sm:row-span-2 sm:aspect-auto" : "hidden sm:block")}
          >
            <img
              src={i === 0 ? p.src : thumb(p.src)}
              srcSet={i === 0 ? `${thumb(p.src)} 400w, ${p.src} 1600w` : undefined}
              sizes={i === 0 ? "(min-width: 640px) 50vw, 100vw" : undefined}
              alt={p.alt}
              width={i === 0 ? 1600 : 400}
              height={i === 0 ? 1200 : 300}
              loading={i === 0 ? "eager" : "lazy"}
              fetchPriority={i === 0 ? "high" : undefined}
              decoding="async"
              className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none"
            />
            {i === Math.min(4, photos.length - 1) && (
              <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-lg bg-background/95 px-2.5 py-1.5 text-[13px] font-medium shadow">
                <Images className="size-4" aria-hidden />All {photos.length} photos
              </span>
            )}
          </button>
        ))}
      </div>

      <Dialog open={open != null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent
          className="max-w-[min(96vw,1200px)] gap-3 p-3 sm:max-w-[min(96vw,1200px)]"
          onKeyDown={(e) => {
            if (open == null) return;
            if (e.key === "ArrowRight") show(open + 1);
            if (e.key === "ArrowLeft") show(open - 1);
          }}
        >
          <DialogTitle className="px-1 text-[14px]">{current?.group === "Home" ? "Inside the home" : "The property"} · {open != null ? open + 1 : 0} of {photos.length}</DialogTitle>
          <DialogDescription className="sr-only">Use the left and right arrow keys to move between photos.</DialogDescription>
          {current && (
            <div className="relative">
              <img src={current.src} alt={current.alt} width={1600} height={1200} className="max-h-[75vh] w-full rounded-lg bg-muted object-contain" />
              <button type="button" onClick={() => show(open! - 1)} aria-label="Previous photo" className="absolute top-1/2 left-2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-background/90 shadow hover:bg-background"><ChevronLeft className="size-5" /></button>
              <button type="button" onClick={() => show(open! + 1)} aria-label="Next photo" className="absolute top-1/2 right-2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-background/90 shadow hover:bg-background"><ChevronRight className="size-5" /></button>
            </div>
          )}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <button key={p.src + i} type="button" onClick={() => setOpen(i)} aria-label={`Photo ${i + 1}: ${p.alt}`} aria-current={i === open} className={cn("h-14 w-20 shrink-0 overflow-hidden rounded-md ring-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring", i === open ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100")}>
                <img src={thumb(p.src)} alt="" width={80} height={56} loading="lazy" className="size-full object-cover" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
