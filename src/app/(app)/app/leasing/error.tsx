"use client";

import Link from "@/components/Link";
import { useEffect } from "react";
import { ErrorBanner } from "@/components/app/states";
import { Button } from "@/components/ui/button";

// Error boundary for the leasing pages: keeps the shell usable and offers the leasing lists, which
// render through the generic pages and keep working when a dashboard query fails.
export default function LeasingError({ error, retry, reset }: { error: unknown; retry?: () => void; reset?: () => void }) {
  useEffect(() => console.error(error), [error]);
  const digest = (error as { digest?: string } | null)?.digest;
  return (
    <div className="flex flex-col gap-4 px-4 pt-6 md:px-6">
      <ErrorBanner
        title="This leasing page couldn't load"
        message={<>Nothing was changed. Try again, or work from the lists for now.{digest && <span className="ml-1 font-mono text-[11px]">Ref {digest}</span>}</>}
        onRetry={retry ?? reset}
      />
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm"><Link href="/app/leasing/prospects">Prospects</Link></Button>
        <Button asChild variant="outline" size="sm"><Link href="/app/leasing/applications">Applications</Link></Button>
      </div>
    </div>
  );
}
