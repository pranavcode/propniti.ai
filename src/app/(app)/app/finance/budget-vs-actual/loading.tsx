import { Skeleton } from "@/components/ui/skeleton";
import { ChartSkeleton } from "@/components/app/dashboard";

export default function Loading() {
  return (
    <div className="flex flex-col gap-5 px-4 pt-5 md:px-6" aria-busy aria-label="Loading budget vs actual">
      <div className="flex items-start gap-3">
        <Skeleton className="size-8 rounded-md" />
        <div className="flex flex-col gap-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-3.5 w-96" /></div>
      </div>
      <div className="flex gap-2"><Skeleton className="h-8 w-56" /><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-36" /></div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]"><ChartSkeleton kind="line" height={220} /><Skeleton className="h-full min-h-40" /></div>
      <div className="space-y-1">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
    </div>
  );
}
