import { cn } from "@/lib/utils";

// Dashboard layout: 12 columns on xl, 2 on tablet, 1 on phones. `span` is the xl width.
const SPAN: Record<number, string> = {
  3: "xl:col-span-3", 4: "xl:col-span-4", 5: "xl:col-span-5", 6: "xl:col-span-6", 7: "xl:col-span-7", 8: "xl:col-span-8", 9: "xl:col-span-9", 12: "xl:col-span-12",
};

export function DashboardGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12", className)}>{children}</div>;
}

export function GridItem({ span = 6, wide, children, className }: { span?: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12; wide?: boolean; children: React.ReactNode; className?: string }) {
  // wide: also take both columns on tablet (big charts, tables).
  return <div className={cn("min-w-0", SPAN[span], (wide || span >= 8) && "md:col-span-2", className)}>{children}</div>;
}

// A row of KPI cards: 2 per row on phones, 4–6 across on desktop.
export function KpiRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]", className)}>{children}</div>;
}
