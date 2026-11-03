import { Skeleton } from "@/components/ui/skeleton";

// Leasing pages are dashboards and boards, so the fallback is header, KPI tiles and panels.
export default function LeasingLoading() {
  return (
    <div className="flex flex-col gap-5 px-4 pt-5 pb-10 md:px-6" aria-busy="true" aria-label="Loading leasing">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-64" />)}
      </div>
    </div>
  );
}
