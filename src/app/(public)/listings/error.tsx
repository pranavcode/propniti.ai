"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-24 text-center">
      <h1 className="text-[22px] font-semibold">We couldn&apos;t load homes right now</h1>
      <p className="text-[15px] text-muted-foreground">This is usually brief. Try again, or start a new search.</p>
      <div className="mt-2 flex gap-2">
        <button onClick={reset} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"><RotateCcw className="size-4" aria-hidden />Try again</button>
        <Link href="/listings" className="inline-flex h-10 items-center rounded-lg border px-4 font-medium hover:bg-muted">All homes</Link>
      </div>
    </main>
  );
}
