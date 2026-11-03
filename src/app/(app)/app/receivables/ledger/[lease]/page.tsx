import type { Metadata } from "next";
import { staffSession } from "@/extensions/receivables/staff";
import { notFound } from "next/navigation";
import { can } from "@/entities";
import { getPlatform } from "@/lib/platform";
import { leaseFor } from "@/extensions/receivables/queries";
import { PageHeader } from "@/extensions/receivables/ui/bits";
import { LedgerView } from "@/extensions/receivables/ui/LedgerView";

type Props = { params: Promise<{ lease: string }>; searchParams: Promise<{ highlight?: string }> };

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Ledger ${decode((await params).lease) ?? ""} · Propniti` };
}

export default async function LeaseLedgerPage({ params, searchParams }: Props) {
  const lease = decode((await params).lease);
  if (!lease) notFound();
  const { highlight } = await searchParams;
  const session = await staffSession();
  if (!can(session.actor.role, "read", "charges")) notFound();
  const ctx = { db: getPlatform().db, ws: session.ws, actor: session.actor };
  const header = await leaseFor(ctx, lease);
  if (!header) notFound();
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title={`${header.household} · ${header.property} #${header.unit}`}
        description="Resident ledger: every charge, payment and credit on the lease with a running balance. Click any figure to see the rows that make it up."
      />
      <LedgerView ctx={ctx} leaseId={lease} highlight={highlight} switchHref={(id) => `/app/receivables/ledger/${id}`} />
    </div>
  );
}
