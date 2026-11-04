import { PublicHeader } from "@/components/public/chrome";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-7xl flex flex-col gap-6 px-4 pt-8 sm:px-6" aria-busy="true" aria-label="Loading homes">
        <Skeleton className="h-9 w-72 rounded-lg" />
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-11 rounded-lg" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="overflow-hidden rounded-xl border">
              <Skeleton className="aspect-[4/3]" />
              <div className="flex flex-col gap-2 p-4"><Skeleton className="h-5 w-24 rounded" /><Skeleton className="h-4 w-40 rounded" /><Skeleton className="h-4 w-32 rounded" /></div>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
