import Link from "@/components/Link";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

// Shown when the applicant has no application on file yet.
export function NoApplication() {
  return (
    <div className="mx-auto mt-6 max-w-md rounded-xl border bg-card p-6 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary"><Home className="size-5" aria-hidden /></span>
      <h1 className="mt-3 text-[17px] font-semibold">We couldn&apos;t find an application for you yet</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">Browse available homes and apply online. Once you apply, you can follow every step here.</p>
      <Button asChild className="mt-4"><Link href="/listings">Browse available homes</Link></Button>
    </div>
  );
}
