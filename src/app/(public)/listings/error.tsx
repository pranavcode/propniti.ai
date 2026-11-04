"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-24 text-center">
      <h1 className="text-[22px] font-semibold">We couldn&apos;t load homes right now</h1>
      <p className="text-[15px] text-muted-foreground">This is usually brief. Try again, or start a new search.</p>
      <div className="mt-2 flex gap-2">
        <Button onClick={reset} className="h-10 px-4"><RotateCcw data-icon="inline-start" aria-hidden />Try again</Button>
        <Button asChild variant="outline" className="h-10 px-4"><Link href="/listings">All homes</Link></Button>
      </div>
    </main>
  );
}
