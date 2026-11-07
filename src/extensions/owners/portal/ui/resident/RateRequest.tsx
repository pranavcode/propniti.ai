"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePortalAction } from "../usePortalAction";

// Stars (and an optional note) for a finished repair. Shown until the resident rates it.
export function RateRequest({ me, workOrderId }: { me: string; workOrderId: string }) {
  const { run, busy } = usePortalAction("residents", me);
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const shown = hover || stars;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Rate the repair" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} onMouseEnter={() => setHover(n)} onClick={() => setStars(n)}
            className="flex size-10 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
            <Star className={cn("size-6 transition-colors", n <= shown ? "fill-tone-warning text-tone-warning" : "text-muted-foreground/50")} aria-hidden />
          </button>
        ))}
      </div>
      {stars > 0 && (
        <>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder={stars <= 2 ? "What went wrong?" : "Anything to add? (optional)"} aria-label="Comment" className="min-h-14 text-[13px]" />
          <Button size="sm" className="max-md:h-10" disabled={!!busy} onClick={() => run("rate_request", { workOrderId, stars, comment: comment.trim() })}>{busy ? "Sending…" : "Send rating"}</Button>
        </>
      )}
    </div>
  );
}
