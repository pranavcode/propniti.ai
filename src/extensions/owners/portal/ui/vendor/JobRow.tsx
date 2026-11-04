import Link from "@/components/Link";
import { CalendarClock, KeyRound } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { StatusBadge, Thumb } from "@/components/app/display";
import type { Job } from "../../vendor-data";
import { JobActions } from "./JobActions";

const photo = (json: string, id: string) => {
  try {
    return ((JSON.parse(json) as string[])[0] ?? `/img/props/${id}.webp`).replace(/\.webp$/, "-400.webp");
  } catch {
    return `/img/props/${id}-400.webp`;
  }
};
const PRIORITY: Record<string, "danger" | "warning" | "neutral"> = { Emergency: "danger", Urgent: "warning", Normal: "neutral", Low: "neutral" };

// One job in a list: where, when, how urgent, and what the vendor can do next.
export function JobRow({ j, me }: { j: Job; me: string }) {
  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
      <Link href={`/portal/vendor/jobs?id=${j.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
        <Thumb src={photo(j.photos, j.property_id)} size={48} className="rounded-lg" />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium">{j.title}</p>
          <p className="truncate text-[12px] text-muted-foreground">{j.id} · {j.property}{j.unit ? ` #${j.unit}` : " · common area"} · {j.category}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" />{j.scheduled_at ? formatDateTime(j.scheduled_at) : j.sla_due_at ? `Due by ${formatDateTime(j.sla_due_at)}` : "Not scheduled"}</span>
            {j.permission_to_enter ? <span className="inline-flex items-center gap-1"><KeyRound className="size-3" />OK to enter</span> : null}
          </p>
        </div>
      </Link>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {j.priority !== "Normal" && j.priority !== "Low" && <StatusBadge value={j.priority} tone={PRIORITY[j.priority]} />}
        <StatusBadge value={j.owner_declined ? "Owner declined" : j.invoiced && j.status !== "Paid" ? "Invoiced" : j.status} tone={j.owner_declined ? "danger" : j.status === "Paid" ? "success" : j.status === "Assigned" ? "info" : undefined} label={j.status === "Assigned" ? "New: accept or decline" : undefined} />
        <JobActions me={me} id={j.id} title={j.title} status={j.status} invoiced={!!j.invoiced || !!j.owner_declined} compact />
      </div>
    </li>
  );
}
