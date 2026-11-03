import { Money } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { portalCtx } from "@/extensions/owners/portal/context";
import { ownerProperties } from "@/extensions/owners/portal/owner-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { monthLabel, prevMonth } from "@/extensions/owners/statements";
import { CURRENT_PERIOD } from "@/seed/constants";

const photosOf = (json: string, id: string) => {
  try {
    const list = JSON.parse(json) as string[];
    return list.length ? list : [`/img/props/${id}.webp`];
  } catch {
    return [`/img/props/${id}.webp`];
  }
};
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

// The owner's properties with photos and last month's numbers.
export default async function OwnerProperties() {
  const c = await portalCtx("owner");
  if (!c) return null;
  const props = await ownerProperties(c);
  if (!props.length) return <EmptyState title="No properties yet" description="Properties held by your entities appear here." />;
  return (
    <>
      <PortalTitle title="Properties" description={`How each property did in ${monthLabel(prevMonth(CURRENT_PERIOD))}.`} />
      <div className="space-y-5">
        {props.map((p) => {
          const photos = photosOf(p.photos, p.id);
          const vsBudget = p.noi_cents != null && p.budget_noi_cents ? (p.noi_cents - p.budget_noi_cents) / p.budget_noi_cents : null;
          return (
            <article key={p.id} id={p.id} className="scroll-mt-20 overflow-hidden rounded-xl border bg-card" aria-labelledby={`h-${p.id}`}>
              <div className="grid grid-cols-4 gap-1">
                {photos.slice(0, 4).map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element -- static webp in /public; the Workers build has no image optimizer
                  <img key={src} src={i === 0 ? src : src.replace(/\.webp$/, "-400.webp")} alt={i === 0 ? `${p.name} exterior` : `${p.name} photo ${i + 1}`} loading={i ? "lazy" : undefined}
                    className={i === 0 ? "col-span-4 aspect-[16/7] w-full object-cover sm:col-span-2 sm:row-span-2 sm:aspect-auto sm:h-full" : "hidden aspect-[4/3] w-full object-cover sm:block"} />
                ))}
              </div>
              <div className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 id={`h-${p.id}`} className="text-[16px] font-semibold">{p.name}</h2>
                    <p className="text-[12.5px] text-muted-foreground">{[p.neighborhood, p.metro].filter(Boolean).join(", ")} · {p.type}{p.class ? ` · Class ${p.class}` : ""}{p.year_built ? ` · Built ${p.year_built}` : ""} · {p.entity}</p>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-5">
                  {[
                    ["Homes", p.units.toLocaleString("en-US")],
                    ["Occupancy", pct(p.occupancy)],
                    ["Rent collected", pct(p.charged_cents ? (p.collected_cents ?? 0) / p.charged_cents : null)],
                    ["NOI", <Money key="n" value={p.noi_cents} cents style="whole" />],
                    ["NOI vs budget", vsBudget == null ? "—" : <span key="b" className={vsBudget < 0 ? "text-tone-danger" : "text-tone-success"}>{vsBudget >= 0 ? "+" : ""}{(vsBudget * 100).toFixed(1)}%</span>],
                  ].map(([k, v]) => (
                    <div key={k as string} className="bg-card px-3 py-2"><dt className="text-[11.5px] text-muted-foreground">{k}</dt><dd className="mt-0.5 text-[14px] font-semibold tabular-nums">{v}</dd></div>
                  ))}
                </dl>
                <p className="mt-2 text-[12px] text-muted-foreground">{p.wo_open ?? 0} open work orders at month end.</p>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
