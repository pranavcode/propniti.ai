import { PublicHeader } from "@/components/public/chrome";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-7xl flex flex-col gap-6 px-4 pt-6 sm:px-6" aria-busy="true" aria-label="Loading home">
        <Skeleton className="aspect-[4/3] rounded-2xl  sm:aspect-auto sm:h-[460px]" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-3"><Skeleton className="h-8 w-3/4 rounded" /><Skeleton className="h-5 w-1/2 rounded" /><Skeleton className="h-24 rounded-xl" /></div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </main>
    </>
  );
}
