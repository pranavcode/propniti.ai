import Link from "next/link";
import { ExternalLink, MapPin } from "lucide-react";
import type { TabProps } from "@/extensions/tabs";
import { metrics, type QueryCtx } from "@/server/query";
import { ChartCard } from "@/components/app/dashboard";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { Money, StatusBadge } from "@/components/app/display";
import { formatDate, formatMoney, formatNumber, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Gallery } from "./Gallery";
import { FloorPlan } from "./FloorPlan";
import { UnitStack, type StackUnit } from "./UnitStack";
import { ACTIVE, asOf, days, inScope, one, parseList, photosOf, rows, tabCtx } from "./data";

const Card = ({ title, meta, children, className }: { title: React.ReactNode; meta?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={cn("min-w-0 rounded-lg border bg-card", className)}>
    <h3 className="flex items-center justify-between gap-2 border-b px-3 py-2 text-[12.5px] font-semibold">{title}{meta && <span className="text-[11.5px] font-normal text-muted-foreground">{meta}</span>}</h3>
    {children}
  </section>
);

const OutOfScope = () => <EmptyState compact title="This property is outside your scope" description="Switch role from your avatar menu to see it." />;

// ---------------------------------------------------------------------------------------------
// Overview: gallery, location, key facts, amenities, unit mix
// ---------------------------------------------------------------------------------------------

const METRO_CENTER: Record<string, [number, number, string]> = {
  Austin: [30.2672, -97.7431, "downtown Austin"], Dallas: [32.7767, -96.797, "downtown Dallas"],
  Atlanta: [33.749, -84.388, "downtown Atlanta"], Phoenix: [33.4484, -112.074, "downtown Phoenix"],
};

function fromCenter(lat: number, lng: number, metro: string) {
  const c = METRO_CENTER[metro];
  if (!c) return null;
  const dy = (lat - c[0]) * 69;
  const dx = (lng - c[1]) * 69 * Math.cos((c[0] * Math.PI) / 180);
  const miles = Math.hypot(dx, dy);
  const dirs = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"];
  const dir = dirs[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
  return { dx, dy, miles, dir, label: c[2] };
}

// Stylised locator: concentric rings around the metro centre and the property's bearing. No map tiles.
function Locator({ dx, dy, miles }: { dx: number; dy: number; miles: number }) {
  const R = 64, max = Math.max(6, Math.ceil(miles / 5) * 5);
  const px = (dx / max) * R, py = (-dy / max) * R;
  return (
    <svg viewBox="-80 -80 160 160" className="size-36 shrink-0" aria-hidden>
      <rect x={-80} y={-80} width={160} height={160} rx={10} fill="var(--muted)" opacity={0.5} />
      {[1, 2, 3].map((i) => <circle key={i} r={(R * i) / 3} fill="none" stroke="var(--border)" strokeWidth={1} />)}
      <line x1={-R} x2={R} y1={0} y2={0} stroke="var(--border)" />
      <line y1={-R} y2={R} x1={0} x2={0} stroke="var(--border)" />
      <text x={R + 3} y={-R + 8} fontSize={8} fill="var(--muted-foreground)" textAnchor="end">{max} mi</text>
      <text y={-R - 4} fontSize={8} fill="var(--muted-foreground)" textAnchor="middle">N</text>
      <circle r={3} fill="var(--muted-foreground)" />
      <line x1={0} y1={0} x2={px} y2={py} stroke="var(--primary)" strokeWidth={1.25} strokeDasharray="3 2" />
      <circle cx={px} cy={py} r={9} fill="var(--primary)" opacity={0.18} />
      <circle cx={px} cy={py} r={4.5} fill="var(--primary)" stroke="var(--card)" strokeWidth={1.5} />
    </svg>
  );
}

const AMENITY_PHOTO: [RegExp, string][] = [
  [/pool/i, "pool"], [/gym|fitness/i, "gym"], [/clubhouse|lounge/i, "clubhouse"], [/roof/i, "rooftop"], [/lobby|concierge/i, "lobby"],
  [/co-?work|office|business/i, "office-suite"], [/retail|storefront/i, "retail-unit"], [/warehouse|loading|dock/i, "warehouse"],
];

export async function PropertyOverview({ id, row, actor }: TabProps) {
  if (!inScope(actor, id)) return <OutOfScope />;
  const ctx = await tabCtx(actor);
  const [p, mix, lease] = await Promise.all([
    one(ctx, `SELECT p.*, oe.name AS owner_entity, s.name AS manager, (SELECT count(*) FROM {buildings} b WHERE b.property_id = p.id) AS buildings
      FROM {properties} p LEFT JOIN {owner_entities} oe ON oe.id = p.owner_entity_id LEFT JOIN {staff} s ON s.id = p.manager_id WHERE p.id = ?`, id),
    rows<{ id: string; name: string; beds: number; baths: number; sqft: number; market_rent_cents: number; n: number; occ: number }>(ctx,
      `SELECT ut.id, ut.name, ut.beds, ut.baths, ut.sqft, ut.market_rent_cents, count(u.id) AS n, coalesce(sum(u.status IN ('Occupied', 'Notice')), 0) AS occ
       FROM {unit_types} ut LEFT JOIN {units} u ON u.unit_type_id = ut.id WHERE ut.property_id = ? GROUP BY ut.id ORDER BY ut.beds, ut.sqft LIMIT 50`, id),
    rows<{ unit_type_id: string; avg: number }>(ctx,
      `SELECT u.unit_type_id, avg(l.rent_cents) AS avg FROM {leases} l JOIN {units} u ON u.id = l.unit_id WHERE l.property_id = ? AND l.status IN ${ACTIVE} GROUP BY u.unit_type_id`, id),
  ]);
  if (!p) return <ErrorBanner message="This property couldn't load." />;
  const photos = photosOf(parseList(p.photos));
  const amenities = parseList(p.amenities);
  const lat = Number(p.lat), lng = Number(p.lng);
  const loc = Number.isFinite(lat) && Number.isFinite(lng) ? fromCenter(lat, lng, String(p.metro)) : null;
  const avgRent = new Map(lease.map((l) => [l.unit_type_id, l.avg]));
  const units = mix.reduce((s, m) => s + m.n, 0);
  const facts: [string, React.ReactNode][] = [
    ["Type", String(p.type)], ["Class", p.class ? `Class ${p.class}` : "—"], ["Year built", p.year_built ? String(p.year_built) : "—"],
    ["Stories", p.stories ? String(p.stories) : "—"], ["Buildings", formatNumber(Number(p.buildings))], ["Units", formatNumber(units)],
    ["Rentable sq ft", p.rentable_sqft ? formatNumber(Number(p.rentable_sqft)) : "—"], ["Acquired", p.acquired_on ? formatDate(String(p.acquired_on), "always") : "—"],
    ["Owner entity", p.owner_entity_id ? <Link key="oe" href={`/app/owner-entities/${encodeURIComponent(String(p.owner_entity_id))}`} className="hover:text-primary hover:underline">{String(p.owner_entity ?? p.owner_entity_id)}</Link> : "—"],
    ["Property manager", String(p.manager ?? "Unassigned")],
  ];

  return (
    <div className="flex flex-col gap-3">
      {photos.length ? <Gallery photos={photos} title={String(row._title ?? p.name)} /> : <EmptyState compact kind="table" title="No photos yet" description="Upload exterior and amenity photos from the Documents tab." />}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card title="Key facts">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 p-3 sm:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[11.5px] text-muted-foreground">{k}</dt>
                <dd className="truncate text-[13px] font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Location" meta={String(p.metro)}>
          <div className="flex items-center gap-4 p-3">
            {loc && <Locator {...loc} />}
            <div className="min-w-0 text-[13px]">
              <p className="flex items-start gap-1.5 font-medium"><MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{String(p.street)}</p>
              <p className="pl-5 text-muted-foreground">{String(p.city)}, {String(p.state)} {String(p.zip)}</p>
              {p.neighborhood ? <p className="mt-2 pl-5"><span className="text-muted-foreground">Neighborhood </span>{String(p.neighborhood)}</p> : null}
              {loc && <p className="pl-5"><span className="tabular-nums">{loc.miles.toFixed(1)} mi {loc.dir}</span> <span className="text-muted-foreground">of {loc.label}</span></p>}
              {Number.isFinite(lat) && <p className="mt-2 pl-5 text-[11.5px] text-muted-foreground tabular-nums">{lat.toFixed(4)}°, {lng.toFixed(4)}°</p>}
              {Number.isFinite(lat) && (
                <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer" className="mt-1.5 ml-5 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                  Open in maps <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card title="Amenities" meta={`${amenities.length}`}>
        {amenities.length ? (
          <div className="flex flex-col gap-3 p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {amenities.flatMap((a) => {
                const hit = AMENITY_PHOTO.find(([re]) => re.test(a));
                return hit ? [{ a, img: hit[1] }] : [];
              }).filter((x, i, all) => all.findIndex((y) => y.img === x.img) === i).slice(0, 4).map(({ a, img }) => (
                <figure key={img} className="overflow-hidden rounded-md border">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static webp in /public */}
                  <img src={`/img/amenities/amenity-${img}-400.webp`} alt={a} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                  <figcaption className="truncate px-2 py-1 text-[12px]">{a}</figcaption>
                </figure>
              ))}
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {amenities.map((a) => <li key={a} className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-[12px]">{a}</li>)}
            </ul>
          </div>
        ) : <p className="p-3 text-[12.5px] text-muted-foreground">No amenities recorded.</p>}
      </Card>

      <Card title="Unit mix" meta={`${mix.length} floor plans · ${formatNumber(units)} units`}>
        {mix.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[11.5px] text-muted-foreground">
                <tr className="border-b">{["Floor plan", "Beds / baths", "Sq ft", "Units", "Occupied", "Market rent", "Avg lease rent", "Gap"].map((h, i) => <th key={h} className={cn("px-3 py-1.5 font-medium", i ? "text-right" : "text-left")}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {mix.map((m) => {
                  const avg = avgRent.get(m.id);
                  return (
                    <tr key={m.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-1.5 font-medium"><Link href="?tab=floorplans" scroll={false} className="hover:text-primary">{m.name}</Link></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m.beds === 0 ? "Studio" : `${m.beds} bd`} / {m.baths} ba</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(m.sqft)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m.n}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m.n ? formatPct(m.occ / m.n) : "—"}</td>
                      <td className="px-3 py-1.5 text-right"><Money value={m.market_rent_cents} cents style="whole" /></td>
                      <td className="px-3 py-1.5 text-right">{avg ? <Money value={avg} cents style="whole" /> : "—"}</td>
                      <td className={cn("px-3 py-1.5 text-right tabular-nums", avg && avg < m.market_rent_cents * 0.97 ? "text-tone-warning" : "text-muted-foreground")}>{avg && m.market_rent_cents ? formatPct(avg / m.market_rent_cents - 1) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="p-3 text-[12.5px] text-muted-foreground">No floor plans on file.</p>}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Unit stack
// ---------------------------------------------------------------------------------------------

export async function PropertyStack({ id, actor }: TabProps) {
  if (!inScope(actor, id)) return <OutOfScope />;
  const ctx = await tabCtx(actor);
  const [units, leases, today] = await Promise.all([
    rows<{ id: string; number: string; floor: number | null; building: string | null; status: string; plan: string | null; market_rent_cents: number }>(ctx,
      `SELECT u.id, u.number, u.floor, b.name AS building, u.status, ut.name AS plan, u.market_rent_cents FROM {units} u
       LEFT JOIN {buildings} b ON b.id = u.building_id LEFT JOIN {unit_types} ut ON ut.id = u.unit_type_id WHERE u.property_id = ? LIMIT 1000`, id),
    rows<{ unit_id: string; rent_cents: number; end_on: string | null; household: string | null }>(ctx,
      `SELECT l.unit_id, l.rent_cents, l.end_on, h.name AS household FROM {leases} l LEFT JOIN {households} h ON h.id = l.household_id
       WHERE l.property_id = ? AND l.status IN ${ACTIVE} ORDER BY l.start_on`, id),
    asOf(ctx),
  ]);
  if (!units.length) return <EmptyState title="No units on file" description="Add units or import a rent roll to see the stack." action={{ label: "Add unit", href: "/app/units?new=1" }} />;
  const byUnit = new Map(leases.map((l) => [l.unit_id, l]));
  const data: StackUnit[] = units.map((u) => {
    const l = byUnit.get(u.id);
    return { id: u.id, number: u.number, floor: u.floor ?? 1, building: u.building ?? "Main building", status: u.status, plan: u.plan ?? "—", market: u.market_rent_cents / 100, rent: l ? l.rent_cents / 100 : null, resident: l?.household ?? null, leaseEnd: l?.end_on ?? null };
  });
  return <UnitStack units={data} today={today} />;
}

// ---------------------------------------------------------------------------------------------
// Floor plans
// ---------------------------------------------------------------------------------------------

export async function PropertyFloorplans({ id, actor }: TabProps) {
  if (!inScope(actor, id)) return <OutOfScope />;
  const ctx = await tabCtx(actor);
  const plans = await rows<{ id: string; name: string; beds: number; baths: number; sqft: number; market_rent_cents: number; photos: string; n: number; avail: number }>(ctx,
    `SELECT ut.id, ut.name, ut.beds, ut.baths, ut.sqft, ut.market_rent_cents, ut.photos, count(u.id) AS n, coalesce(sum(u.status IN ('Vacant', 'Make-ready')), 0) AS avail
     FROM {unit_types} ut LEFT JOIN {units} u ON u.unit_type_id = ut.id WHERE ut.property_id = ? GROUP BY ut.id ORDER BY ut.beds, ut.sqft LIMIT 50`, id);
  if (!plans.length) return <EmptyState title="No floor plans on file" description="Floor plans come from the property's unit types." />;
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {plans.map((p) => {
        const photos = photosOf(parseList(p.photos), "Living room");
        return (
          <section key={p.id} className="flex min-w-0 flex-col rounded-lg border bg-card">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-3 py-2">
              <h3 className="text-[13.5px] font-semibold">{p.name}</h3>
              <span className="text-[12px] text-muted-foreground tabular-nums">{p.beds === 0 ? (p.sqft > 1200 ? "Suite" : "Studio") : `${p.beds} bd`} · {p.baths} ba · {formatNumber(p.sqft)} sq ft</span>
              <span className="ml-auto text-[13px] font-semibold tabular-nums">{formatMoney(p.market_rent_cents / 100, "whole")}<span className="text-[11.5px] font-normal text-muted-foreground">/mo market</span></span>
            </header>
            <div className="bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:12px_12px] p-3">
              <FloorPlan beds={p.beds} baths={p.baths} sqft={p.sqft} name={p.name} className="mx-auto h-auto max-h-[300px] w-full" />
            </div>
            <div className="flex items-center gap-3 border-t px-3 py-2 text-[12px]">
              <span><span className="font-medium tabular-nums">{p.n}</span> <span className="text-muted-foreground">units</span></span>
              <span className={cn(p.avail ? "text-tone-success" : "text-muted-foreground")}><span className="font-medium tabular-nums">{p.avail}</span> available</span>
              {p.avail > 0 && <Link href={`/app/units?f.property_id=${encodeURIComponent(id)}&f.unit_type_id=${encodeURIComponent(p.id)}&f.status=Vacant`} className="ml-auto font-medium text-primary hover:underline">See available units →</Link>}
            </div>
            {photos.length > 0 && <Gallery photos={photos} title={p.name} variant="strip" className="border-t p-2" />}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Financials: T12 charts from metrics, plus the month table
// ---------------------------------------------------------------------------------------------

async function chart(ctx: QueryCtx, key: string, property: string) {
  try {
    return { ok: true as const, m: await metrics(ctx, key, { property, months: 12 }) };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't load" };
  }
}

export async function PropertyFinancials({ id, actor }: TabProps) {
  if (!inScope(actor, id)) return <OutOfScope />;
  const ctx = await tabCtx(actor);
  const today = await asOf(ctx);
  const [noi, ie, occ, coll, months] = await Promise.all([
    chart(ctx, "portfolio.noi", id), chart(ctx, "portfolio.income_expense", id), chart(ctx, "portfolio.occupancy", id), chart(ctx, "receivables.collections_rate", id),
    rows<{ month: string; gpr_cents: number; collected_cents: number; opex_cents: number; noi_cents: number; budget_noi_cents: number | null; occupancy_phys: number; vacancy_loss_cents: number }>(ctx,
      "SELECT month, gpr_cents, collected_cents, opex_cents, noi_cents, budget_noi_cents, occupancy_phys, vacancy_loss_cents FROM metrics_monthly WHERE workspace_id = 'base' AND property_id = ? AND month < ? ORDER BY month DESC LIMIT 12",
      id, today.slice(0, 7)),
  ]);
  const label = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  const pts = (r: typeof noi) => (r.ok ? r.m.points.map((p) => ({ ...p, label: label(String(p.month)) })) as Record<string, string | number | null>[] : []);
  const sum = (k: keyof (typeof months)[number]) => months.reduce((s, m) => s + Number(m[k] ?? 0), 0);
  const budget = months.some((m) => m.budget_noi_cents != null) ? sum("budget_noi_cents") : null;
  const card = (r: typeof noi, el: React.ReactNode) => (r.ok ? el : <ErrorBanner message={r.error} />);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {card(noi, <ChartCard title="NOI vs budget, trailing 12 months" kind="line" data={pts(noi)} x="label" series={[{ key: "noi", label: "NOI", format: "money" }, { key: "budget", label: "Budget", format: "money", dashed: true }]} help="Net operating income per closed month: collected income less operating expenses." />)}
        {card(ie, <ChartCard title="Income vs expenses" kind="bar" data={pts(ie)} x="label" series={[{ key: "income", label: "Collected income", format: "money" }, { key: "expenses", label: "Operating expenses", format: "money" }]} />)}
        {card(occ, <ChartCard title="Occupancy, physical vs economic" kind="line" data={pts(occ)} x="label" series={[{ key: "physical", label: "Physical", format: "pct" }, { key: "economic", label: "Economic", format: "pct" }]} drill={`/app/units?f.property_id=${encodeURIComponent(id)}&f.status=Vacant`} help="Physical: occupied units over rentable units. Economic: rent collected over gross potential rent." />)}
        {card(coll, <ChartCard title="Charged vs collected" kind="bar" data={pts(coll)} x="label" series={[{ key: "charged", label: "Charged", format: "money" }, { key: "collected", label: "Collected", format: "money" }]} drill={`/app/receivables/charges?f.property_id=${encodeURIComponent(id)}`} />)}
      </div>

      <Card title="Trailing 12 months" meta="Closed months · GPR is gross potential rent">
        {months.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[11.5px] text-muted-foreground">
                <tr className="border-b">{["Month", "GPR", "Collected", "Vacancy loss", "Opex", "NOI", "Budget", "Variance", "Occupancy"].map((h, i) => <th key={h} className={cn("px-3 py-1.5 font-medium whitespace-nowrap", i ? "text-right" : "text-left")}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const v = m.budget_noi_cents == null ? null : m.noi_cents - m.budget_noi_cents;
                  return (
                    <tr key={m.month} className="border-b hover:bg-muted/40">
                      <td className="px-3 py-1.5 font-medium whitespace-nowrap">{label(m.month)}</td>
                      <td className="px-3 py-1.5 text-right"><Money value={m.gpr_cents} cents style="whole" /></td>
                      <td className="px-3 py-1.5 text-right"><Money value={m.collected_cents} cents style="whole" /></td>
                      <td className="px-3 py-1.5 text-right"><Money value={m.vacancy_loss_cents} cents style="whole" tone="none" /></td>
                      <td className="px-3 py-1.5 text-right"><Money value={m.opex_cents} cents style="whole" /></td>
                      <td className="px-3 py-1.5 text-right font-medium"><Money value={m.noi_cents} cents style="whole" /></td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{m.budget_noi_cents == null ? "—" : <Money value={m.budget_noi_cents} cents style="whole" tone="none" />}</td>
                      <td className={cn("px-3 py-1.5 text-right tabular-nums", v == null ? "text-muted-foreground" : v < 0 ? "text-tone-danger" : "text-tone-success")}>{v == null ? "—" : `${v < 0 ? "−" : "+"}${formatMoney(Math.abs(v) / 100, "whole")}`}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatPct(m.occupancy_phys)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/40 font-semibold">
                <tr>
                  <td className="px-3 py-1.5 whitespace-nowrap">T12 total</td>
                  <td className="px-3 py-1.5 text-right"><Money value={sum("gpr_cents")} cents style="whole" /></td>
                  <td className="px-3 py-1.5 text-right"><Money value={sum("collected_cents")} cents style="whole" /></td>
                  <td className="px-3 py-1.5 text-right"><Money value={sum("vacancy_loss_cents")} cents style="whole" tone="none" /></td>
                  <td className="px-3 py-1.5 text-right"><Money value={sum("opex_cents")} cents style="whole" /></td>
                  <td className="px-3 py-1.5 text-right"><Money value={sum("noi_cents")} cents style="whole" /></td>
                  <td className="px-3 py-1.5 text-right">{budget == null ? "—" : <Money value={budget} cents style="whole" tone="none" />}</td>
                  <td className={cn("px-3 py-1.5 text-right tabular-nums", budget != null && sum("noi_cents") < budget ? "text-tone-danger" : "text-tone-success")}>{budget == null ? "—" : `${sum("noi_cents") < budget ? "−" : "+"}${formatMoney(Math.abs(sum("noi_cents") - budget) / 100, "whole")}`}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatPct(months.reduce((s, m) => s + m.occupancy_phys, 0) / months.length)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : <EmptyState compact kind="chart" title="No closed months yet" description="Figures appear after the first monthly close." />}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Compliance and insurance
// ---------------------------------------------------------------------------------------------

function Expiry({ on, today }: { on: string; today: string }) {
  const d = days(today, on);
  const tone = d < 0 ? "danger" : d < 60 ? "warning" : "success";
  return <StatusBadge value={d < 0 ? "Expired" : `${d} days`} tone={tone} label={d < 0 ? `Expired ${-d} days ago` : `${d} days left`} />;
}

export async function PropertyCompliance({ id, row, actor }: TabProps) {
  if (!inScope(actor, id)) return <OutOfScope />;
  const ctx = await tabCtx(actor);
  const [today, policies, items, inspections, capex] = await Promise.all([
    asOf(ctx),
    rows<{ id: string; kind: string; carrier: string; policy_number: string; coverage_cents: number; premium_cents: number; starts_on: string; expires_on: string }>(ctx, "SELECT * FROM {insurance_policies} WHERE property_id = ? ORDER BY expires_on LIMIT 50", id),
    rows<{ id: string; kind: string; title: string; due_on: string; completed_on: string | null; status: string }>(ctx, "SELECT * FROM {compliance_items} WHERE property_id = ? ORDER BY (status = 'Done'), due_on LIMIT 50", id),
    rows<{ id: string; kind: string; scheduled_on: string; completed_on: string | null; status: string; score: number | null; unit: string | null }>(ctx,
      "SELECT i.*, u.number AS unit FROM {inspections} i LEFT JOIN {units} u ON u.id = i.unit_id WHERE i.property_id = ? ORDER BY i.scheduled_on DESC LIMIT 10", id),
    rows<{ id: string; name: string; category: string; budget_cents: number; spent_cents: number; status: string; target_on: string | null }>(ctx, "SELECT * FROM {capex_projects} WHERE property_id = ? ORDER BY status, target_on LIMIT 25", id),
  ]);
  const th = (h: string[], right = 0) => <thead className="text-[11.5px] text-muted-foreground"><tr className="border-b">{h.map((x, i) => <th key={x} className={cn("px-3 py-1.5 font-medium whitespace-nowrap", i >= h.length - right ? "text-right" : "text-left")}>{x}</th>)}</tr></thead>;
  const expiringSoon = policies.filter((p) => days(today, p.expires_on) < 60).length;

  return (
    <div className="flex flex-col gap-3">
      <Card title="Insurance" meta={policies.length ? (expiringSoon ? `${expiringSoon} expiring within 60 days` : "All policies current") : undefined}>
        {policies.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              {th(["Policy", "Carrier", "Policy #", "Term", "Expires", "Coverage", "Annual premium"], 2)}
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-medium whitespace-nowrap">{p.kind}</td>
                    <td className="px-3 py-1.5">{p.carrier}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px] whitespace-nowrap text-muted-foreground">{p.policy_number}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{formatDate(p.starts_on, "always")} – {formatDate(p.expires_on, "always")}</td>
                    <td className="px-3 py-1.5"><Expiry on={p.expires_on} today={today} /></td>
                    <td className="px-3 py-1.5 text-right"><Money value={p.coverage_cents} cents style="compact" /></td>
                    <td className="px-3 py-1.5 text-right"><Money value={p.premium_cents} cents style="whole" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState compact title="No insurance policies on file" description="Add the property and liability policies so renewals show up here and on the compliance agent's list." />}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Compliance items" meta={items.length ? `${items.filter((i) => i.status !== "Done").length} open` : undefined}>
          {items.length ? (
            <ul className="divide-y">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{i.title.replace(` — ${String(row._title ?? "")}`, "")}</p><p className="text-[11.5px] text-muted-foreground">{i.kind} · due {formatDate(i.due_on, "always")}</p></div>
                  <StatusBadge value={i.status} />
                </li>
              ))}
            </ul>
          ) : <EmptyState compact title="No compliance items recorded" description="Permits, elevator and fire certificates and pool licences for this property will be tracked here with due dates." />}
        </Card>
        <Card title="Inspections" meta={inspections.length ? "Latest 10" : undefined}>
          {inspections.length ? (
            <ul className="divide-y">
              {inspections.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{i.kind}{i.unit ? ` · Unit ${i.unit}` : ""}</p><p className="text-[11.5px] text-muted-foreground tabular-nums">{formatDate(i.completed_on ?? i.scheduled_on, "always")}{i.score != null ? ` · score ${i.score}` : ""}</p></div>
                  <StatusBadge value={i.status} />
                </li>
              ))}
            </ul>
          ) : <EmptyState compact title="No inspections recorded" description="Move-in, move-out, annual and safety inspections appear here once scheduled." />}
        </Card>
      </div>

      <Card title="Capital projects" meta={capex.length ? `${capex.length} projects` : undefined}>
        {capex.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              {th(["Project", "Category", "Status", "Target", "Spent of budget"], 1)}
              <tbody>
                {capex.map((c) => {
                  const pct = c.budget_cents ? c.spent_cents / c.budget_cents : 0;
                  return (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-3 py-1.5 font-medium">{c.name}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{c.category || "—"}</td>
                      <td className="px-3 py-1.5"><StatusBadge value={c.status} /></td>
                      <td className="px-3 py-1.5 tabular-nums">{c.target_on ? formatDate(c.target_on, "always") : "—"}</td>
                      <td className="px-3 py-1.5 text-right">
                        <span className="inline-flex items-center gap-2">
                          <span className="tabular-nums">{formatMoney(c.spent_cents / 100, "compact")} / {formatMoney(c.budget_cents / 100, "compact")}</span>
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", pct > 1 ? "bg-tone-danger" : pct > 0.9 ? "bg-tone-warning" : "bg-tone-success")} style={{ width: `${Math.min(100, pct * 100)}%` }} /></span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState compact title="No capital projects" description="Roof, HVAC and renovation projects with budgets and milestones will show here." />}
      </Card>
    </div>
  );
}
