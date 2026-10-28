"use client";

import { useState } from "react";
import { ratingSummary, sameSubject } from "@/lib/ratings";
import { useDemo } from "@/lib/store";
import type { RatingSubject } from "@/lib/types";
import { Button } from "./ui";

export function Stars({ value, size = "text-base" }: { value: number; size?: string }) {
  return (
    <span className={`inline-flex ${size} leading-none tracking-[0.05em]`} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= Math.round(value) ? "text-[#B7862F]" : "text-[#1C1917]/15"}>★</span>
      ))}
    </span>
  );
}

export function RatingBadge({ subject }: { subject: RatingSubject }) {
  const { state } = useDemo();
  const { avg, count } = ratingSummary(state.ratings, subject);
  if (avg === null) return <span className="text-xs text-[#78716C]">No ratings yet</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Stars value={avg} />
      <span className="font-medium tabular-nums">{avg.toFixed(1)}</span>
      <span className="text-xs text-[#78716C]">({count})</span>
    </span>
  );
}

// Lets a user rate someone or something once per job; rating again replaces it.
export function RateBox({ by, subject, label, refId }: { by: string; subject: RatingSubject; label: string; refId?: string }) {
  const { state, act } = useDemo();
  const existing = state.ratings.find((r) => r.by === by && sameSubject(r.subject, subject) && r.ref === refId);
  const [stars, setStars] = useState(existing?.stars ?? 0);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [saved, setSaved] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!stars) return;
        act.rate(by, subject, stars, comment, refId);
        setSaved(true);
      }}
      className="space-y-3 rounded-[1.25rem] bg-[#F6F2EA] p-4 ring-1 ring-[#1C1917]/[0.06]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-[#1C1917]">{label}</span>
        <div role="radiogroup" aria-label={label} className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              onClick={() => {
                setStars(n);
                setSaved(false);
              }}
              className={`text-2xl leading-none transition-transform duration-300 hover:scale-110 ${n <= stars ? "text-[#B7862F]" : "text-[#1C1917]/15"}`}
            >
              ★
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
          setSaved(false);
        }}
        maxLength={300}
        rows={2}
        placeholder="What went well, or what could be better? (optional)"
        className="w-full rounded-xl border-0 bg-white/70 px-3 py-2 text-sm ring-1 ring-inset ring-[#1C1917]/12"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!stars}>{existing ? "Update rating" : "Submit rating"}</Button>
        {saved && <span className="text-sm text-[#4A6340]">Thanks — saved.</span>}
        {!stars && <span className="text-xs text-[#78716C]">Pick 1–5 stars</span>}
      </div>
    </form>
  );
}
