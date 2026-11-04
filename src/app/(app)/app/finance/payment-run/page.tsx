import type { Metadata } from "next";
import { CircleDollarSign } from "lucide-react";
import "@/entities";
import { can } from "@/entities";
import { currentSession } from "@/auth/session";
import Link from "@/components/Link";
import { PageHeader } from "@/components/app/page";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { getPlatform } from "@/lib/platform";
import { paymentRunCandidates } from "@/extensions/payables/paymentRun";
import { PaymentRunBuilder } from "@/extensions/payables/ui/PaymentRun";

export const metadata: Metadata = { title: "Payment run · Propniti" };

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export default async function PaymentRunPage() {
  const session = await currentSession();
  if (!can(session.actor.role, "bills.pay", "bills")) {
    return <main className="p-6"><EmptyState kind="table" title="Payment runs aren't part of your role" description="Accountants, regional managers and principals pay bills. Switch role from your avatar menu." action={{ label: "Go to your home", href: "/app" }} /></main>;
  }
  const run = await paymentRunCandidates({ db: getPlatform().db, ws: session.ws ?? "~", actor: session.actor }).catch((e) => (console.error("payment run", e), null));
  const bills = run?.vendors.flatMap((v) => v.bills) ?? [];
  const total = bills.reduce((s, b) => s + b.amount_cents, 0);

  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader
        icon={<CircleDollarSign />}
        title="Payment run"
        description={<>Approved bills past their due date in {session.actor.scope.label.toLowerCase()}, by vendor. Choose what to pay, review, then pay. Bills over the bill-payment approval limit go to the approvals inbox instead; vendors with an unverified bank change can&apos;t be paid.</>}
      />
      {!run ? <ErrorBanner title="Bills couldn't load" message="Refresh the page to try again." /> : (
        <>
          <p className="text-[13px] text-muted-foreground">
            {bills.length ? <>{bills.length} approved bills, {usd(total)}, from {run.vendors.length} vendors.</> : "No approved bills are past due."}
            {run.pendingApproval.n > 0 && <> {run.pendingApproval.n} more past-due bills ({usd(run.pendingApproval.cents)}) still need approval before they can be paid: <Link href="/app/payables/bills?view=to-approve" className="text-primary hover:underline">Approve bills</Link>.</>}
          </p>
          {bills.length ? <PaymentRunBuilder vendors={run.vendors} /> : <EmptyState kind="table" title="Nothing to pay" description="Every approved bill is paid or not yet due." action={{ label: "Open payables", href: "/app/payables/bills" }} />}
        </>
      )}
    </main>
  );
}
