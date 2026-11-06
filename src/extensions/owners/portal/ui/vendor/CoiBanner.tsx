import Link from "@/components/Link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Coi } from "../../vendor-data";
import { formatDate } from "@/lib/format";

const ICON = { danger: "text-tone-danger", warning: "text-tone-warning", success: "text-tone-success" } as const;

// Insurance status at a glance: missing, waiting for verification, expired, expiring within 30 days, or valid.
export function CoiBanner({ coi }: { coi: Coi | undefined }) {
  const tone = !coi || coi.status === "Expired" ? "danger" : coi.status === "Expiring" || coi.status === "Pending verification" ? "warning" : "success";
  const text = !coi ? "We don't have your insurance certificate. Upload it to keep getting jobs."
    : coi.status === "Pending verification" ? `Your certificate from ${coi.carrier} is pending verification. The maintenance team checks it before it counts for new jobs.`
    : coi.status === "Expired" ? `Your insurance certificate expired on ${formatDate(coi.expires_on, "always")}. New jobs are on hold until you upload the renewal.`
    : coi.status === "Expiring" ? `Your insurance certificate expires in ${coi.days} days (${formatDate(coi.expires_on, "always")}). Upload the renewal so jobs aren't held.`
    : `Insurance is current until ${formatDate(coi.expires_on, "always")} (${coi.carrier}).`;
  const Icon = tone === "success" ? ShieldCheck : ShieldAlert;
  return (
    <div role={tone === "success" ? undefined : "status"} className={cn("flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3", tone === "danger" && "border-tone-danger/30 bg-tone-danger/5", tone === "warning" && "border-tone-warning/30 bg-tone-warning/5", tone === "success" && "bg-card")}>
      <Icon className={cn("size-5 shrink-0", ICON[tone])} aria-hidden />
      <p className="min-w-0 flex-1 text-[13px]">{text}</p>
      {tone !== "success" && coi?.status !== "Pending verification" && <Link href="/portal/vendor/insurance" className="text-[13px] font-medium text-primary hover:underline">Upload certificate</Link>}
    </div>
  );
}
