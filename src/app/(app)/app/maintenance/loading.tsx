import { Skeleton } from "@/components/ui/skeleton";

// Maintenance pages are a dashboard, a board and forms: header, KPI tiles and panels, not a spinner.
export default function MaintenanceLoading() {
  return (
    <div className="flex flex-col gap-5 px-4 pt-5 pb-10 md:px-6" aria-busy="true" aria-label="Loading maintenance">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-3 xl:grid-cols-12">
        <Skeleton className="h-44 xl:col-span-8" />
        <Skeleton className="h-44 xl:col-span-4" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid gap-3 xl:grid-cols-12">
        <Skeleton className="h-80 xl:col-span-7" />
        <Skeleton className="h-80 xl:col-span-5" />
      </div>
    </div>
  );
}
