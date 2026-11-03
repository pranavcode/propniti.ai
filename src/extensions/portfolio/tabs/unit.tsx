import Link from "next/link";
import type { TabProps } from "@/extensions/tabs";
import { ChartCard } from "@/components/app/dashboard";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { Money, StatusBadge } from "@/components/app/display";
import { formatDate, formatMoney, formatNumber, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Gallery } from "./Gallery";
import { FloorPlan } from "./FloorPlan";
import { ACTIVE, asOf, days, inScope, one, parseList, photosOf, rows, tabCtx } from "./data";
import type { QueryCtx } from "@/server/query";

type UnitRow = { id: string; number: string; property_id: string; property: string; status: string; floor: number | null; sqft: number; market_rent_cents: number; unit_type_id: string | null; plan: string | null; beds: number | null; baths: number | null; plan_sqft: number | null; photos: string | null };

async function loadUnit(ctx: QueryCtx, id: string) {
  return one<UnitRow>(ctx, `SELECT u.id, u.number, u.property_id, p.name AS property, u.status, u.floor, u.sqft, u.market_rent_cents, u.unit_type_id, ut.name AS plan, ut.beds, ut.baths, ut.sqft AS plan_sqft, ut.photos
    FROM {units} u LEFT JOIN {properties} p ON p.id = u.property_id LEFT JOIN {unit_types} ut ON ut.id = u.unit_type_id WHERE u.id = ?`, id);
}

const OutOfScope = () => <EmptyState compact title="This unit is outside your scope" description="Switch role from your avatar menu to see it." />;
const Card = ({ title, meta, children, className }: { title: React.ReactNode; meta?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={cn("min-w-0 rounded-lg border bg-card", className)}>
    <h3 className="flex items-center justify-between gap-2 border-b px-3 py-2 text-[12.5px] font-semibold">{title}{meta && <span className="text-[11.5px] font-normal text-muted-foreground">{meta}</span>}</h3>
    {children}
  </section>
);
const pctDiff = (a: number, b: number) => (b ? a / b - 1 : null);
const signed = (cents: number) => `${cents < 0 ? "−" : "+"}${formatMoney(Math.abs(cents) / 100, "whole")}`;

// ---------------------------------------------------------------------------------------------
// Overview: photos, floor plan, market vs current rent, current lease
// ---------------------------------------------------------------------------------------------

export async function UnitOverview({ id, actor }: TabProps) {
  const ctx = await tabCtx(actor);
  const u = await loadUnit(ctx, id);
  if (!u) return <ErrorBanner message="This unit couldn't load." />;
  if (!inScope(actor, u.property_id)) return <OutOfScope />;
  const [lease, plan] = await Promise.all([
    one<{ id: string; status: string; start_on: string; end_on: string | null; rent_cents: number; deposit_cents: number; household_id: string; household: string | null; term_months: number | null }>(ctx,
      `SELECT l.id, l.status, l.start_on, l.end_on, l.rent_cents, l.deposit_cents, l.household_id, l.term_months, h.name AS household FROM {leases} l LEFT JOIN {households} h ON h.id = l.household_id
       WHERE l.unit_id = ? AND l.status IN ${ACTIVE} ORDER BY l.start_on DESC LIMIT 1`, id),
    u.unit_type_id
      ? one<{ n: number; avg: number | null; lo: number | null; hi: number | null }>(ctx,
        `SELECT count(*) AS n, avg(l.rent_cents) AS avg, min(l.rent_cents) AS lo, max(l.rent_cents) AS hi FROM {leases} l JOIN {units} x ON x.id = l.unit_id
         WHERE x.unit_type_id = ? AND l.status IN ${ACTIVE} AND l.rent_cents > 0`, u.unit_type_id)
      : Promise.resolve(null),
  ]);
  const photos = photosOf(parseList(u.photos), "Living room");
  const gap = lease ? lease.rent_cents - u.market_rent_cents : null;
  const range = plan?.lo != null && plan.hi != null && plan.hi > plan.lo ? plan : null;
  const pos = (c: number) => (range ? Math.max(0, Math.min(100, ((c - range.lo!) / (range.hi! - range.lo!)) * 100)) : 50);

  return (
    <div className="flex flex-col gap-3">
      {photos.length > 0 && <Gallery photos={photos} title={`${u.property} #${u.number}`} />}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Market vs current rent" meta={u.plan ?? undefined}>
          <div className="grid grid-cols-3 gap-px bg-border">
            {[
              ["Market rent", <Money key="m" value={u.market_rent_cents} cents style="whole" />],
              ["Lease rent", lease ? <Money key="l" value={lease.rent_cents} cents style="whole" /> : <span key="l" className="text-muted-foreground">Vacant</span>],
              ["Gap to market", gap == null ? "—" : <span key="g" className={gap < 0 ? "text-tone-warning" : "text-tone-success"}>{signed(gap)} <span className="text-[12px] font-normal">({formatPct(pctDiff(lease!.rent_cents, u.market_rent_cents))})</span></span>],
            ].map(([k, v]) => (
              <div key={String(k)} className="bg-card px-3 py-2.5">
                <div className="text-[11.5px] text-muted-foreground">{k}</div>
                <div className="mt-0.5 text-[17px] font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          <div className="px-3 py-3 text-[12.5px]">
            {range ? (
              <>
                <p className="text-muted-foreground">Leases on the {u.plan} plan at {u.property}: <span className="font-medium text-foreground tabular-nums">{plan!.n}</span>, averaging <span className="font-medium text-foreground tabular-nums">{formatMoney(plan!.avg! / 100, "whole")}</span>.</p>
                <div className="relative mt-5 mb-6 h-1.5 rounded-full bg-muted" role="img" aria-label={`Plan rents range from ${formatMoney(range.lo! / 100, "whole")} to ${formatMoney(range.hi! / 100, "whole")}`}>
                  <span className="absolute inset-y-0 rounded-full bg-tone-info/30" style={{ left: 0, right: 0 }} />
                  {[
                    { c: u.market_rent_cents, label: "Market", cls: "bg-foreground" },
                    ...(lease ? [{ c: lease.rent_cents, label: "This unit", cls: "bg-primary" }] : []),
                    { c: plan!.avg!, label: "Average", cls: "bg-tone-info" },
                  ].map((m, i) => (
                    <span key={m.label} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos(m.c)}%` }}>
                      <span className={cn("block size-3 rounded-full ring-2 ring-card", m.cls)} />
                      <span className={cn("absolute left-1/2 -translate-x-1/2 text-[10.5px] whitespace-nowrap text-muted-foreground", i % 2 ? "top-4" : "-top-5")}>{m.label}</span>
                    </span>
                  ))}
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums"><span>Low {formatMoney(range.lo! / 100, "whole")}</span><span>High {formatMoney(range.hi! / 100, "whole")}</span></div>
              </>
            ) : <p className="text-muted-foreground">Not enough active leases on this floor plan to compare.</p>}
          </div>
        </Card>

        <Card title="Current lease" meta={lease ? <Link href={`/app/leases/${encodeURIComponent(lease.id)}`} className="text-primary hover:underline">{lease.id} →</Link> : undefined}>
          {lease ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 p-3 text-[13px]">
              <div><dt className="text-[11.5px] text-muted-foreground">Household</dt><dd className="truncate font-medium">{lease.household ?? lease.household_id}</dd></div>
              <div><dt className="text-[11.5px] text-muted-foreground">Status</dt><dd><StatusBadge value={lease.status} /></dd></div>
              <div><dt className="text-[11.5px] text-muted-foreground">Term</dt><dd className="tabular-nums">{formatDate(lease.start_on, "always")} – {lease.end_on ? formatDate(lease.end_on, "always") : "open"}</dd></div>
              <div><dt className="text-[11.5px] text-muted-foreground">Length</dt><dd className="tabular-nums">{lease.term_months ? `${lease.term_months} months` : "Month-to-month"}</dd></div>
              <div><dt className="text-[11.5px] text-muted-foreground">Monthly rent</dt><dd><Money value={lease.rent_cents} cents style="whole" /></dd></div>
              <div><dt className="text-[11.5px] text-muted-foreground">Deposit held</dt><dd><Money value={lease.deposit_cents} cents style="whole" /></dd></div>
            </dl>
          ) : <EmptyState compact title="No active lease" description={`Unit ${u.number} is ${u.status.toLowerCase()}.`} action={{ label: "See vacant units", href: `/app/units?f.property_id=${encodeURIComponent(u.property_id)}&f.status=Vacant` }} />}
        </Card>
      </div>

      {u.beds != null && (
        <Card title="Floor plan" meta={`${u.plan} · ${formatNumber(u.sqft || u.plan_sqft || 0)} sq ft`}>
          <div className="bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:12px_12px] p-3">
            <FloorPlan beds={u.beds} baths={u.baths ?? 1} sqft={u.sqft || u.plan_sqft || 600} name={u.plan ?? u.number} className="mx-auto h-auto max-h-[320px] w-full max-w-2xl" />
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Lease history
// ---------------------------------------------------------------------------------------------

export async function UnitLeaseHistory({ id, actor }: TabProps) {
  const ctx = await tabCtx(actor);
  const u = await loadUnit(ctx, id);
  if (!u) return <ErrorBanner message="This unit couldn't load." />;
  if (!inScope(actor, u.property_id)) return <OutOfScope />;
  const leases = await rows<{ id: string; status: string; start_on: string; end_on: string | null; move_in_on: string | null; move_out_on: string | null; rent_cents: number; household_id: string; household: string | null; renewal_of: string | null }>(ctx,
    `SELECT l.id, l.status, l.start_on, l.end_on, l.move_in_on, l.move_out_on, l.rent_cents, l.household_id, l.renewal_of, h.name AS household FROM {leases} l LEFT JOIN {households} h ON h.id = l.household_id
     WHERE l.unit_id = ? ORDER BY l.start_on DESC LIMIT 50`, id);
  if (!leases.length) return <EmptyState title="No leases on this unit yet" description="Signed leases, renewals and past residents appear here." />;
  const chrono = [...leases].reverse();
  const prevRent = new Map(chrono.map((l, i) => [l.id, i ? chrono[i - 1].rent_cents : null]));
  const points = chrono.map((l) => ({ label: new Date(`${l.start_on}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }), rent: l.rent_cents / 100, market: u.market_rent_cents / 100 }));

  return (
    <div className="flex flex-col gap-3">
      {chrono.length > 1 && <ChartCard title="Rent by lease" description={`${chrono.length} leases since ${formatDate(chrono[0].start_on, "always")}`} kind="line" data={points} x="label" height={180} series={[{ key: "rent", label: "Lease rent", format: "money" }, { key: "market", label: "Current market rent", format: "money", dashed: true }]} />}
      <Card title="Leases" meta={`${leases.length} on record`}>
        <ol className="relative">
          {leases.map((l) => {
            const prev = prevRent.get(l.id);
            const change = prev != null ? l.rent_cents - prev : null;
            return (
              <li key={l.id} className="grid grid-cols-[16px_minmax(0,1fr)_auto] gap-3 border-b px-3 py-2.5 last:border-0">
                <span className={cn("mt-1.5 size-2.5 rounded-full ring-2 ring-card", ["Active", "Notice", "Month-to-month"].includes(l.status) ? "bg-tone-success" : l.status === "Future" ? "bg-tone-info" : "bg-muted-foreground/40")} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Link href={`/app/leases/${encodeURIComponent(l.id)}`} className="font-medium hover:text-primary hover:underline">{l.household ?? l.household_id}</Link>
                    <StatusBadge value={l.status} />
                    {l.renewal_of && <span className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">Renewal</span>}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
                    {formatDate(l.start_on, "always")} – {l.end_on ? formatDate(l.end_on, "always") : "open"}
                    {l.move_in_on && <> · moved in {formatDate(l.move_in_on, "always")}</>}
                    {l.move_out_on && <> · moved out {formatDate(l.move_out_on, "always")}</>}
                    <> · {l.id}</>
                  </p>
                </div>
                <div className="text-right">
                  <Money value={l.rent_cents} cents style="whole" className="text-[13px] font-semibold" />
                  {change != null && <p className={cn("text-[11.5px] tabular-nums", change > 0 ? "text-tone-success" : change < 0 ? "text-tone-danger" : "text-muted-foreground")}>{change === 0 ? "No change" : `${signed(change)} (${formatPct(pctDiff(l.rent_cents, prev!))})`}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Turnovers
// ---------------------------------------------------------------------------------------------

export async function UnitTurnovers({ id, actor }: TabProps) {
  const ctx = await tabCtx(actor);
  const u = await loadUnit(ctx, id);
  if (!u) return <ErrorBanner message="This unit couldn't load." />;
  if (!inScope(actor, u.property_id)) return <OutOfScope />;
  const [list, today] = await Promise.all([
    rows<{ id: string; move_out_on: string; target_ready_on: string; ready_on: string | null; status: string; checklist: string; cost_cents: number; vendor: string | null; vendor_id: string | null; lease_id: string | null }>(ctx,
      "SELECT t.*, v.name AS vendor FROM {turnovers} t LEFT JOIN {vendors} v ON v.id = t.vendor_id WHERE t.unit_id = ? ORDER BY t.move_out_on DESC LIMIT 50", id),
    asOf(ctx),
  ]);
  if (!list.length) return <EmptyState title="No turnovers on this unit" description="Each move-out starts a make-ready with a checklist, vendor and cost. They appear here." />;
  const done = list.filter((t) => t.ready_on);
  const avgDays = done.length ? done.reduce((s, t) => s + days(t.move_out_on, t.ready_on!), 0) / done.length : null;
  const total = list.reduce((s, t) => s + t.cost_cents, 0);

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        {[
          ["Turnovers", formatNumber(list.length)],
          ["Avg days to ready", avgDays == null ? "—" : `${avgDays.toFixed(1)} days`],
          ["Avg make-ready cost", formatMoney(total / list.length / 100, "whole")],
          ["Total make-ready cost", formatMoney(total / 100, "whole")],
        ].map(([k, v]) => <div key={k} className="bg-card px-3 py-2.5"><dt className="text-[11.5px] text-muted-foreground">{k}</dt><dd className="mt-0.5 text-[16px] font-semibold tabular-nums">{v}</dd></div>)}
      </dl>
      <div className="flex flex-col gap-2">
        {list.map((t) => {
          const steps = parseList(t.checklist).length ? (JSON.parse(t.checklist) as { step: string; done: boolean; by?: string }[]) : [];
          const doneN = steps.filter((s) => s.done).length;
          const took = t.ready_on ? days(t.move_out_on, t.ready_on) : null;
          const late = !t.ready_on && t.target_ready_on < today;
          return (
            <section key={t.id} className="rounded-lg border bg-card">
              <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2 text-[12.5px]">
                <span className="font-semibold">Moved out {formatDate(t.move_out_on, "always")}</span>
                <StatusBadge value={late ? "Overdue" : t.status} label={late ? "Past target" : undefined} />
                <span className="text-muted-foreground tabular-nums">Target {formatDate(t.target_ready_on, "always")}</span>
                <span className="text-muted-foreground tabular-nums">{t.ready_on ? <>Ready {formatDate(t.ready_on, "always")} · {took} days</> : late ? <span className="text-tone-danger">{days(t.target_ready_on, today)} days past target</span> : "In progress"}</span>
                <span className="ml-auto flex items-center gap-3">
                  {t.vendor_id && <Link href={`/app/maintenance/vendors/${encodeURIComponent(t.vendor_id)}`} className="text-muted-foreground hover:text-primary hover:underline">{t.vendor ?? t.vendor_id}</Link>}
                  <Money value={t.cost_cents} cents style="whole" className="font-semibold" />
                </span>
              </header>
              {steps.length > 0 && (
                <div className="px-3 py-2">
                  <div className="mb-2 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <span className="h-1.5 w-28 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-tone-success" style={{ width: `${(doneN / steps.length) * 100}%` }} /></span>
                    <span className="tabular-nums">{doneN} of {steps.length} steps done</span>
                  </div>
                  <ul className="flex flex-wrap gap-1.5">
                    {steps.map((s) => (
                      <li key={s.step} title={s.by ? `By ${s.by}` : undefined} className={cn("rounded-full border px-2 py-0.5 text-[11.5px]", s.done ? "border-tone-success/25 bg-tone-success/[0.07] text-tone-success" : "text-muted-foreground")}>
                        {s.done ? "✓ " : ""}{s.step}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
