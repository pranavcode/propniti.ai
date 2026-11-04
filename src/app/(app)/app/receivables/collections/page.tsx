import type { Metadata } from "next";
import { staffSession } from "@/extensions/receivables/staff";
import Link from "next/link";
import { PERMISSIONS } from "@/auth/personas";
import { can } from "@/entities";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { getPlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { workbench } from "@/extensions/receivables/collections";
import { PageHeader, Pager, toParams } from "@/extensions/receivables/ui/bits";
import { Workbench } from "@/extensions/receivables/ui/Workbench";

export const metadata: Metadata = { title: "Collections · Propniti" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const SIZE = 25;
const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function CollectionsPage({ searchParams }: Props) {
  const sp = toParams(await searchParams);
  const session = await staffSession();
  if (!can(session.actor.role, "read", "charges")) return <div className="p-6"><EmptyState title="Collections isn't part of your role" description="Switch role from your avatar menu to see this page as someone who works with it." action={{ label: "Go to your home", href: "/app" }} /></div>;
  const band = ["High", "Medium", "Low"].includes(sp.get("band") ?? "") ? sp.get("band")! : undefined;
  const step = ["reminder", "plan", "legal"].includes(sp.get("step") ?? "") ? sp.get("step")! : undefined;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const property = sp.get("property") ?? undefined;
  const data = await workbench({ db: getPlatform().db, ws: session.ws, actor: session.actor }, { band, step, property, page, size: SIZE }).catch((e) => (console.error("collections", e), null));
  const tab = (key: string, value: string | undefined, label: string, n: number | undefined) => {
    const next = new URLSearchParams(sp);
    next.delete("page");
    if (value) next.set(key, value);
    else next.delete(key);
    const active = (sp.get(key) ?? undefined) === value;
    return (
      <Link key={`${key}-${value}`} href={`/app/receivables/collections?${next}`} scroll={false} aria-current={active ? "page" : undefined}
        className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px]", active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
        {label}{n != null && <span className="tabular-nums opacity-70">{n}</span>}
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title="Collections"
        description={<>Delinquent residents ranked by risk, with the reasons and the Collections agent&apos;s next step. Approve low-risk reminders together; payment plans and legal referrals are decided one at a time. {session.actor.scope.label}.</>}
      />
      {!data ? <ErrorBanner title="Collections couldn't load" message="Refresh the page to try again." /> : (
        <>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
            {[
              { l: "Delinquent residents", v: data.counts.all.toLocaleString("en-US"), h: "/app/receivables/delinquency" },
              { l: "Balance in this view", v: usd(data.balance), h: "/app/receivables/charges?view=overdue" },
              { l: "High risk", v: data.counts.High.toLocaleString("en-US"), h: "/app/receivables/collections?band=High" },
              { l: "Awaiting approval", v: data.counts.proposed.toLocaleString("en-US"), h: "/app/ai/approvals?agent=collections" },
            ].map((x) => (
              <Link key={x.l} href={x.h} className="bg-card px-3 py-2 hover:bg-muted/40">
                <dt className="text-[11px] text-muted-foreground">{x.l}</dt>
                <dd className="mt-0.5 text-[17px] font-semibold tabular-nums">{x.v}</dd>
              </Link>
            ))}
          </dl>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <nav aria-label="Risk" className="flex gap-1">{tab("band", undefined, "All risk", data.counts.all)}{tab("band", "High", "High", data.counts.High)}{tab("band", "Medium", "Medium", data.counts.Medium)}{tab("band", "Low", "Low", data.counts.Low)}</nav>
            <nav aria-label="Next step" className="flex gap-1">{tab("step", undefined, "Any step", undefined)}{tab("step", "reminder", "Reminders", data.counts.reminder)}{tab("step", "plan", "Payment plans", data.counts.plan)}{tab("step", "legal", "Legal review", data.counts.legal)}</nav>
          </div>
          <Workbench key={sp.toString()} rows={data.rows} canRun={(PERMISSIONS[session.actor.role].intelligence ?? "none") !== "none"} />
          <Pager page={page} size={SIZE} total={data.total} params={sp} base="/app/receivables/collections" />
        </>
      )}
    </div>
  );
}
