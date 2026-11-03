import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { AS_OF } from "@/seed/constants";
import { portalCtx } from "@/extensions/owners/portal/context";
import { cois } from "@/extensions/owners/portal/vendor-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { CoiBanner } from "@/extensions/owners/portal/ui/vendor/CoiBanner";
import { CoiForm } from "@/extensions/owners/portal/ui/vendor/CoiForm";

export default async function VendorInsurance() {
  const c = await portalCtx("vendor");
  if (!c) return null;
  const list = await cois(c);
  return (
    <>
      <PortalTitle title="Insurance" description="We need a current certificate of insurance before assigning jobs. This page warns you when yours has 30 days or less left." />
      <div className="space-y-4">
        <CoiBanner coi={list[0]} />
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <section className="overflow-hidden rounded-xl border bg-card">
            <h2 className="border-b px-4 py-3 text-[14px] font-semibold">Certificates on file</h2>
            {list.length ? (
              <ul className="divide-y">
                {list.map((k) => (
                  <li key={k.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{k.carrier}</p><p className="text-[12px] text-muted-foreground">General liability <Money value={k.gl_limit_cents} cents style="whole" /> · {k.workers_comp ? "workers' comp included" : "no workers' comp"}</p></div>
                    <div className="text-right"><StatusBadge value={k.status} tone={k.status === "Valid" ? "success" : k.status === "Expiring" ? "warning" : "danger"} /><p className="mt-0.5 text-[11.5px] text-muted-foreground tabular-nums">{k.days >= 0 ? `${k.days} days left` : `expired ${-k.days} days ago`}</p></div>
                  </li>
                ))}
              </ul>
            ) : <div className="p-4"><EmptyState kind="documents" title="No certificate on file" description="Upload your certificate to keep getting jobs." compact /></div>}
          </section>
          <CoiForm me={c.me} today={AS_OF} />
        </div>
      </div>
    </>
  );
}
