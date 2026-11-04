"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ErrorBanner } from "@/components/app/states";
import { Button } from "@/components/ui/button";

// Page-level error boundary for /app: the shell (sidebar, top bar, assistant) stays usable.
// Next passes `retry`; older runtimes pass `reset`.
export default function AppError({ error, retry, reset }: { error: unknown; retry?: () => void; reset?: () => void }) {
  useEffect(() => console.error(error), [error]);
  const again = retry ?? reset;
  const digest = (error as { digest?: string } | null)?.digest;
  return (
    <div className="flex flex-col gap-4 px-4 pt-6 md:px-6">
      <ErrorBanner
        title="This page couldn't load"
        message={<>Your data is safe; nothing was changed. Try again, or go back to your home page.{digest && <span className="ml-1 font-mono text-[11px]">Ref {digest}</span>}</>}
        onRetry={again}
      />
      <div><Button asChild variant="outline" size="sm"><Link href="/app">Go to home</Link></Button></div>
    </div>
  );
}
