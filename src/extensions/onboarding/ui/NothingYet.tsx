import Link from "@/components/Link";
import { ArrowRight, Upload } from "lucide-react";
import type { Role } from "@/entities/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/states";
import { PageBody, PageHeader } from "@/components/app/page";
import { mayCreate } from "@/extensions/import/server";
import { canOnboard } from "../state";
import type { CompanyState } from "../empty";

// What a page shows before there is any data: a new company points to Guided setup and the
// importer; a property manager with no properties yet learns who adds them.

type Cta = { label: string; href: string };
export type NothingYetCopy = { title: string; description: string; action?: Cta; secondary?: Cta };

export function nothingYet(state: Exclude<CompanyState, null>, role: Role, what = "your properties, residents and figures"): NothingYetCopy {
  if (state === "unassigned") return { title: "No properties assigned to you yet", description: `Once your principal adds you to properties, ${what} for them show up here.` };
  const setup = canOnboard(role);
  const imports = mayCreate(role, "properties");
  return {
    title: "Nothing here yet — import your data",
    description: setup || imports
      ? `Your company has no properties yet. Import exports from AppFolio, Buildium, Yardi or a spreadsheet, and ${what} show up here.`
      : `Your company hasn't imported its portfolio yet. A principal or regional manager does that in Guided setup; then ${what} show up here.`,
    action: setup ? { label: "Start guided setup", href: "/app/onboarding" } : imports ? { label: "Import data", href: "/app/settings/import" } : undefined,
    secondary: setup && imports ? { label: "Import data", href: "/app/settings/import" } : undefined,
  };
}

// The whole page body (home, portfolio, Today).
export function NothingYet({ state, role, what }: { state: Exclude<CompanyState, null>; role: Role; what?: string }) {
  return (
    <div className="rounded-lg border bg-card" data-testid="nothing-yet">
      <EmptyState kind="table" {...nothingYet(state, role, what)} />
    </div>
  );
}

// A one-line callout above a page that still has its own empty content (Data Health, reports).
export function NothingYetBanner({ state, role, what }: { state: Exclude<CompanyState, null>; role: Role; what?: string }) {
  const c = nothingYet(state, role, what);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/25 bg-primary/[0.035] px-4 py-3" data-testid="nothing-yet">
      <Upload className="size-4 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{c.title}</div>
        <p className="text-[12.5px] text-muted-foreground">{c.description}</p>
      </div>
      {c.action && <Button asChild size="sm"><Link href={c.action.href}>{c.action.label}<ArrowRight /></Link></Button>}
    </div>
  );
}

// A page with nothing to show yet: its header, then the empty card.
export function EmptyPage({ title, meta, state, role, what }: { title: React.ReactNode; meta?: React.ReactNode; state: Exclude<CompanyState, null>; role: Role; what?: string }) {
  return (
    <>
      <PageHeader title={title} meta={meta} />
      <PageBody><NothingYet state={state} role={role} what={what} /></PageBody>
    </>
  );
}
