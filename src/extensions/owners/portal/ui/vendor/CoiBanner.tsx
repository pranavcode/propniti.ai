import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Coi } from "../../vendor-data";

// Insurance status at a glance: missing, expired, expiring within 30 days, or valid.
export function CoiBanner({ coi }: { coi: Coi | undefined }) {
  const tone = !coi || coi.status === "Expired" ? "danger" : coi.status === "Expiring" ? "warning" : "success";
  const text = !coi ? "We don't have your insurance certificate. Upload it to keep getting jobs."
    : coi.status === "Expired" ? `Your insurance certificate expired on ${coi.expires_on}. New jobs are on hold until you upload the renewal.`
    : coi.status === "Expiring" ? `Your insurance certificate expires in ${coi.days} days (${coi.expires_on}). Upload the renewal so jobs aren't held.`
    : `Insurance is current until ${coi.expires_on} (${coi.carrier}).`;
  const Icon = tone === "success" ? ShieldCheck : ShieldAlert;
  return (
    <div role={tone === "success" ? undefined : "alert"} className={cn("flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3", tone === "danger" && "border-tone-danger/30 bg-tone-danger/5", tone === "warning" && "border-tone-warning/30 bg-tone-warning/5", tone === "success" && "bg-card")}>
      <Icon className={cn("size-5 shrink-0", `text-tone-${tone}`)} aria-hidden />
      <p className="min-w-0 flex-1 text-[13px]">{text}</p>
      {tone !== "success" && <Link href="/portal/vendor/insurance" className="text-[13px] font-medium text-primary hover:underline">Upload certificate</Link>}
    </div>
  );
}
