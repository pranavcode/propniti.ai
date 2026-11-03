import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/app/data-table";

// Route-change fallback inside the shell: header and table skeletons, not a spinner. Each /app
// section's loading.tsx renders it, and the entity catch-all wraps its body in it. There is no
// loading.tsx at /app itself: it would start streaming (status 200) before the catch-all can 404.
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-5 px-4 pt-5 md:px-6" aria-busy aria-label="Loading">
      <div className="flex items-start gap-3">
        <Skeleton className="size-8 rounded-md" />
        <div className="flex flex-col gap-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-3.5 w-80" /></div>
      </div>
      <DataTableSkeleton tabs />
    </div>
  );
}
