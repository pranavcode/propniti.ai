"use client";
/* eslint-disable @next/next/no-img-element -- static docs images; image optimisation is off on Workers */

import { useEffect, useRef, useState } from "react";

// Click a doc image to see it full size. Without JS the image link still opens the file.
export function DocLightbox() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [img, setImg] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a.doc-zoom");
      if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      setImg({ src: link.getAttribute("href") ?? "", alt: link.querySelector("img")?.alt ?? "" });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (img && !dialog.current?.open) dialog.current?.showModal();
  }, [img]);

  const svg = img?.src.endsWith(".svg");
  return (
    <dialog
      ref={dialog}
      onClose={() => setImg(null)}
      onClick={() => dialog.current?.close()}
      aria-label={img?.alt || "Image"}
      className="m-0 h-[100dvh] max-h-none w-screen max-w-none overflow-auto bg-transparent p-0 backdrop:bg-[#1C1917]/80 backdrop:backdrop-blur-sm"
    >
      {img && (
        <div className="flex min-h-full min-w-fit items-center justify-center p-4 sm:p-8">
          <img
            src={img.src}
            alt={img.alt}
            className={svg ? "w-[min(1100px,calc(100vw-4rem))] min-w-[720px] max-w-none rounded-2xl bg-[#FFFDF8] p-4" : "max-h-[92dvh] w-auto max-w-full rounded-xl"}
          />
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="fixed right-4 top-4 rounded-full bg-[#FBF9F4] px-4 py-2 text-[13px] font-medium text-[#1C1917] shadow-lg"
          >
            Close
          </button>
        </div>
      )}
    </dialog>
  );
}
