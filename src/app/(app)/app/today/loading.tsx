import { Skeleton } from "@/components/ui/skeleton";

// Today's shape while the briefing and figures load: header, briefing, KPI row, three charts.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 px-4 pt-5 pb-10 md:px-6" aria-busy aria-label="Loading Today">
      <div className="flex flex-col gap-2"><Skeleton className="h-6 w-64" /><Skeleton className="h-3.5 w-48" /></div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-2 rounded-lg border p-4">{[90, 75, 82, 68, 60].map((w) => <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />)}</div>
        <Skeleton className="h-56 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{["a", "b", "c", "d"].map((k) => <Skeleton key={k} className="h-28 rounded-lg" />)}</div>
      <div className="grid gap-3 lg:grid-cols-3">{["a", "b", "c"].map((k) => <Skeleton key={k} className="h-64 rounded-lg" />)}</div>
    </div>
  );
}
