import Link from "@/components/Link";
import { Sparkles } from "lucide-react";
import { AIBadge } from "@/components/app/ai";
import { ChartCard } from "@/components/app/dashboard";
import { EmptyState } from "@/components/app/states";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { favourable, type BvaData, type BvaRow, type Explanation } from "./data";

// The budget vs actual grid: rows (properties, or GL accounts for one property) × months, with
// YTD totals. Each cell shows actual, tinted by variance against budget (green favourable, red
// unfavourable, stronger the further off), and drills to the journal entries behind it.

type Props = { data: BvaData; explanation: Explanation | null; explainKey: string | null; href: (p: Record<string, string | null>) => string };

const MONTH = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

function heat(type: BvaData["type"], budget: number, actual: number | null) {
  if (actual == null || (!budget && !actual)) return "";
  const off = budget ? Math.abs(actual - budget) / Math.abs(budget) : 1;
  if (off < 0.02) return "";
  const good = favourable(type, budget, actual);
  const level = off < 0.05 ? 0 : off < 0.1 ? 1 : 2;
  return good ? ["bg-tone-success/[0.06]", "bg-tone-success/[0.12]", "bg-tone-success/[0.2]"][level] : ["bg-tone-danger/[0.06]", "bg-tone-danger/[0.12]", "bg-tone-danger/[0.2]"][level];
}

const varPct = (budget: number, actual: number) => (budget ? (actual - budget) / Math.abs(budget) : null);

export function BvaView({ data, explanation, explainKey, href }: Props) {
  if (!data.rows.length) {
    return <EmptyState kind="chart" title={`No ${data.year} ${data.type.toLowerCase()} budget in your scope`} description="Budgets are entered per property, GL account and month. Once one is approved, actuals from the ledger line up against it here." />;
  }
  const drill = (r: BvaRow, m?: string) => {
    const q = new URLSearchParams();
    if (data.property) { q.set("f.property_id", data.property); if (r.id !== "total") q.set("f.gl_account_id", r.id); } else if (r.id !== "total") q.set("f.property_id", r.id);
    if (m) q.set("f.period", m);
    return `/app/gl/journal?${q}`;
  };
  const chart = data.months.map((m) => ({ month: m, label: MONTH(m), budget: Math.round(data.total.cells[m].budget), actual: data.total.cells[m].actual == null ? null : Math.round(data.total.cells[m].actual!) }));
  const worst = (r: BvaRow) => data.closed.map((m) => ({ m, v: (r.cells[m].actual ?? 0) - r.cells[m].budget })).sort((a, b) => (data.type === "Expense" ? b.v - a.v : a.v - b.v)).slice(0, 3);
  const explained = explainKey ? (explainKey.split("@")[0] === "total" ? data.total : data.rows.find((r) => r.id === explainKey.split("@")[0])) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ChartCard title={`${data.type}: budget vs actual, ${data.year}`} description={data.propertyName ?? "All properties in your scope"} kind="line" data={chart} x="label"
          series={[{ key: "actual", label: "Actual", format: "money" }, { key: "budget", label: "Budget", format: "money", dashed: true }]}
          drill={`/app/gl/journal?f.period={month}${data.property ? `&f.property_id=${data.property}` : ""}`} height={220} />
        <section className="rounded-lg border border-tone-ai/25 bg-tone-ai/[0.03] p-3" aria-live="polite">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold"><Sparkles className="size-3.5 text-tone-ai" />Explain a variance</h2>
          {explanation ? (
            <>
              <div className="mt-1 flex items-start justify-between gap-2">
                <p className="text-[12.5px] font-medium">{explanation.title}</p>
                <AIBadge source={explanation.source} model={explanation.model} size="xs" />
              </div>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[12.5px] leading-relaxed">{explanation.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
              {explained && !explainKey?.includes("@") && (
                <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  Months to look at:
                  {worst(explained).map(({ m }) => <Link key={m} href={href({ explain: `${explained.id}@${m}` })} scroll={false} className="rounded border bg-card px-1.5 py-0.5 text-foreground hover:border-tone-ai/50">{MONTH(m)}</Link>)}
                </p>
              )}
              <details className="mt-2 text-[11.5px] text-muted-foreground">
                <summary className="cursor-pointer select-none">Facts used</summary>
                <dl className="mt-1 space-y-0.5">{Object.entries(explanation.facts).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="shrink-0 text-muted-foreground">{k.replace(/_/g, " ")}</dt><dd className="min-w-0 text-foreground">{String(v)}</dd></div>)}</dl>
              </details>
            </>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">Pick ✦ on any row to see why it&apos;s off budget. The figures come from the ledger and the bills behind it; the AI only words them.</p>
          )}
        </section>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-[12.5px] tabular-nums">
          <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
            <tr className="text-[11.5px] text-muted-foreground">
              <th scope="col" className="sticky left-0 z-10 border-b bg-muted/95 px-3 py-1.5 text-left font-medium">{data.property ? "GL account" : "Property"}</th>
              {data.months.map((m) => <th key={m} scope="col" className={cn("border-b px-2 py-1.5 text-right font-medium", !data.closed.includes(m) && "text-muted-foreground/60")}>{MONTH(m)}</th>)}
              <th scope="col" className="border-b border-l px-2 py-1.5 text-right font-medium">YTD actual</th>
              <th scope="col" className="border-b px-2 py-1.5 text-right font-medium">YTD budget</th>
              <th scope="col" className="border-b px-2 py-1.5 text-right font-medium">FY budget</th>
              {/* Pinned right so the YTD variance stays visible while months scroll. */}
              <th scope="col" className="sticky right-0 z-10 border-b border-l bg-muted/95 px-2 py-1.5 text-right font-medium">YTD variance</th>
            </tr>
          </thead>
          <tbody>
            {[...data.rows, data.total].map((r) => {
              const isTotal = r.id === "total";
              const v = r.ytdActual - r.ytdBudget;
              const p = varPct(r.ytdBudget, r.ytdActual);
              const good = favourable(data.type, r.ytdBudget, r.ytdActual);
              const active = explainKey?.split("@")[0] === r.id;
              return (
                <tr key={r.key} className={cn("group", isTotal && "font-semibold")}>
                  <th scope="row" className={cn("sticky left-0 z-[1] max-w-[240px] border-b bg-card px-3 py-1 text-left font-medium group-hover:bg-muted", isTotal && "border-t-2", active && "bg-tone-ai/[0.06]")}>
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate" title={r.label}>{r.label}</span>
                      <Link href={href({ explain: r.id })} scroll={false} aria-label={`Explain the variance for ${r.label}`} title="Explain this variance"
                        className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded text-tone-ai opacity-50 hover:bg-tone-ai/10 hover:opacity-100", active && "opacity-100")}>
                        <Sparkles className="size-3" />
                      </Link>
                    </span>
                  </th>
                  {data.months.map((m) => {
                    const c = r.cells[m];
                    const cp = c.actual == null ? null : varPct(c.budget, c.actual);
                    return (
                      <td key={m} className={cn("border-b p-0 text-right", isTotal && "border-t-2")}>
                        {c.actual == null ? (
                          <span className="block px-2 py-1 text-muted-foreground/60" title={`Budget ${formatMoney(c.budget, "whole")}`}>{formatMoney(c.budget, "compact")}</span>
                        ) : (
                          <Link href={drill(r, m)} className={cn("block px-2 py-1 hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-primary/50", heat(data.type, c.budget, c.actual))}
                            title={`Actual ${formatMoney(c.actual, "whole")} · Budget ${formatMoney(c.budget, "whole")}${cp == null ? "" : ` · ${cp >= 0 ? "+" : "−"}${Math.abs(cp * 100).toFixed(1)}%`}`}>
                            {formatMoney(c.actual, "compact")}
                          </Link>
                        )}
                      </td>
                    );
                  })}
                  <td className={cn("border-b border-l px-2 py-1 text-right", isTotal && "border-t-2")}>{formatMoney(r.ytdActual, "whole")}</td>
                  <td className={cn("border-b px-2 py-1 text-right text-muted-foreground", isTotal && "border-t-2")}>{formatMoney(r.ytdBudget, "whole")}</td>
                  <td className={cn("border-b px-2 py-1 text-right text-muted-foreground", isTotal && "border-t-2")}>{formatMoney(r.fyBudget, "whole")}</td>
                  <td className={cn("sticky right-0 z-[1] border-b border-l bg-card px-2 py-1 text-right whitespace-nowrap group-hover:bg-muted", isTotal && "border-t-2", Math.abs(p ?? 0) >= 0.02 && (good ? "text-tone-success" : "text-tone-danger"))}>
                    {formatMoney(v, "whole")}<span className="ml-1 text-[11px] opacity-80">{p == null ? "" : `${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(1)}%`}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-center gap-3 text-[11.5px] text-muted-foreground">
        <span>Cells show actual; hover for budget and variance. Grey months are budget only (not closed yet).</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-tone-success/20" /> favourable</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-tone-danger/20" /> unfavourable (2%, 5%, 10%+)</span>
      </p>
    </div>
  );
}
