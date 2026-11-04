import { Skeleton } from "@/components/ui/skeleton";

// Dashboard homes: header, KPI row and two chart blocks. Plain divs, so the dashboard doesn't load
// the table's client code just for its fallback.
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5 px-4 pt-5 md:px-6" aria-busy aria-label="Loading">
      <div className="flex flex-col gap-2"><Skeleton className="h-6 w-64" /><Skeleton className="h-3.5 w-96" /></div>
      <Skeleton className="h-56 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}</div>
      <div className="grid gap-3 md:grid-cols-3"><Skeleton className="h-72 rounded-lg md:col-span-2" /><Skeleton className="h-72 rounded-lg" /></div>
    </div>
  );
}
