import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { can } from "@/entities";
import type { Row } from "@/entities/types";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { formatDateTime } from "@/lib/format";
import { getRow } from "@/server/query";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { latestTriage, policyFor, rankVendors, techniciansFor } from "@/extensions/maintenance/queries";
import { all, effective } from "@/extensions/maintenance/store";
import { PhotoCheckBadge } from "@/extensions/maintenance/tabs";
import { ActionButton } from "@/extensions/maintenance/ui/client";
import { DispatchPanel } from "@/extensions/maintenance/ui/Dispatch";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ trade?: string }> };

export async function generateMetadata({ params }: Props) {
  return { title: `Triage ${decodeURIComponent((await params).id)} · Propniti` };
}

export default async function TriagePage({ params, searchParams }: Props) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const sp = await searchParams;
  const { actor, ws } = await currentSession();
  if (!can(actor.role, "read", "work_orders")) return <div className="p-6"><EmptyState title="Work orders aren't part of your role" action={{ label: "Go to your home", href: "/app" }} /></div>;
  const db = getPlatform().db;
  const wo = await getRow({ db, ws, actor }, "work_orders", id);
  if (!wo) notFound();
  const suggestion = await latestTriage(db, ws, id);
  const trade = (sp.trade && sp.trade.length < 40 ? sp.trade : null) ?? String(suggestion?.changes.category ?? wo.category);
  const [vendors, techs, policy, photos] = await Promise.all([
    rankVendors(db, ws, trade, String(wo.property_id), actor.propertyIds),
    techniciansFor(db, ws, String(wo.property_id)),
    policyFor(db, ws, String(wo.property_id)),
    all<Row>(db, `SELECT * FROM ${effective("photos", ws)} p WHERE p.entity_type = 'work_orders' AND p.entity_id = ? ORDER BY p.taken_at LIMIT 6`, [id]),
  ]);
  const pending = ["New", "Triaged"].includes(String(wo.status));
  const dispatchable = ["New", "Triaged", "Assigned", "On hold"].includes(String(wo.status));
  const canAct = can(actor.role, "work_orders.dispatch", "work_orders");

  return (
    <div>
      <PageHeader
        title={String(wo.title)}
        meta={<><Link href={`/app/maintenance/work-orders/${encodeURIComponent(id)}`} className="hover:underline">{id}</Link><span>·</span><span>{String(wo.property_id__label)}{wo.unit_id__label ? ` · ${wo.unit_id__label}` : " · common area"}</span><span>·</span><span>Opened {formatDateTime(String(wo.opened_at))}</span><StatusBadge value={wo.status} /></>}
        actions={<Button asChild size="sm" variant="outline"><Link href={`/app/maintenance/work-orders/${encodeURIComponent(id)}`}>Open work order <ArrowRight /></Link></Button>}
      />
      <PageBody>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            {!pending && (
              <div className="mb-4 rounded-lg border border-tone-success/30 bg-tone-success/[0.05] p-4">
                <p className="flex items-center gap-2 text-[14px] font-medium"><CheckCircle2 className="size-4 text-tone-success" />Dispatched{wo.vendor_id__label ? ` to ${wo.vendor_id__label}` : wo.assignee_id__label ? ` to ${wo.assignee_id__label}` : ""}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{String(wo.category)} · {String(wo.priority)} · {String(wo.status).toLowerCase()}. {suggestion?.queue_state === "auto_handled" ? "The triage agent applied its suggestion on its own because the estimate is inside your auto-approve limit. It's in the audit log; change it below if you'd send someone else." : ""}</p>
                <div className="mt-3 flex gap-2">
                  <Button asChild size="sm"><Link href={`/app/maintenance/work-orders/${encodeURIComponent(id)}?tab=wo_timeline`}>See the timeline</Link></Button>
                  <Button asChild size="sm" variant="outline"><Link href="/app/maintenance/intake">Log another request</Link></Button>
                </div>
              </div>
            )}
            {!canAct ? (
              <EmptyState compact title="Only maintenance and property managers dispatch work" description="You can read the request and the agent's suggestion." />
            ) : dispatchable ? (
              <>
                {!suggestion && pending && (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4">
                    <p className="flex items-center gap-2 text-[13px]"><Sparkles className="size-4 text-tone-ai" />The triage agent hasn&apos;t looked at this request yet.</p>
                    <ActionButton entity="work_orders" id={id} action="work_orders.run_triage" label="Triage with AI" variant="default" follow />
                  </div>
                )}
                {/* Keyed by trade: a new trade brings a new vendor list, so the picks start over. */}
                <DispatchPanel key={trade}
                  wo={{ id, priority: String(wo.priority), category: String(wo.category), estimate: wo.estimate == null ? null : Number(wo.estimate) }}
                  trade={trade} suggestion={suggestion} vendors={vendors} techs={techs} policy={policy}
                />
              </>
            ) : null}
          </div>
          <aside className="flex flex-col gap-3">
            <section className="rounded-lg border bg-card p-3">
              <h2 className="text-[12.5px] font-semibold">Request</h2>
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed">{String(wo.description || wo.title)}</p>
              <p className="mt-2 text-[12px] text-muted-foreground">{wo.permission_to_enter ? "Permission to enter given" : "Call before entering"} · source {String(wo.source).toLowerCase()}</p>
            </section>
            <section className="rounded-lg border bg-card">
              <h2 className="border-b px-3 py-2 text-[12.5px] font-semibold">Photos</h2>
              {photos.length ? photos.map((p) => (
                <figure key={String(p.id)} className="border-b p-2 last:border-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static webp in /public */}
                  <img src={String(p.url).replace(/(?<!-400)\.webp$/, "-400.webp")} alt={String(p.caption || "Request photo")} className="aspect-[4/3] w-full rounded object-cover" />
                  <figcaption className="mt-1.5.5">
                    <PhotoCheckBadge result={p.check_result as string | null} confidence={p.check_confidence as number | null} note={p.check_note as string | null} />
                    {p.check_note ? <p className="text-[11.5px] text-muted-foreground">{String(p.check_note)}</p> : null}
                  </figcaption>
                </figure>
              )) : <p className="px-3 py-2 text-[12.5px] text-muted-foreground">No photo on this request.</p>}
            </section>
          </aside>
        </div>
      </PageBody>
    </div>
  );
}
