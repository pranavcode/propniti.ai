import Link from "@/components/Link";
import { CheckCircle2 } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { APPLICATION_FEE_CENTS } from "@/server/money";
import { portalCtx } from "@/extensions/owners/portal/context";
import { application } from "@/extensions/owners/portal/applicant-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { NoApplication } from "@/extensions/owners/portal/ui/applicant/NoApplication";
import { PayFee } from "@/extensions/owners/portal/ui/applicant/PayFee";

const CLOSED = ["Denied", "Withdrawn", "Leased"];

// The application fee: one card payment per application, into the property's trust account.
export default async function ApplicantPay() {
  const c = await portalCtx("applicant");
  if (!c) return null;
  const app = await application(c);
  if (!app) return <NoApplication />;
  return (
    <>
      <PortalTitle title="Application fee" description={`${app.property}, unit ${app.unit}. The fee pays for your credit and background screening.`} />
      <section className="max-w-xl rounded-xl border bg-card p-5">
        <dl className="flex items-baseline justify-between gap-3">
          <dt className="text-[13px] text-muted-foreground">Application fee</dt>
          <dd className="text-[24px] font-semibold tabular-nums">{formatMoney(APPLICATION_FEE_CENTS / 100)}</dd>
        </dl>
        <div className="mt-4 border-t pt-4">
          {app.fee_paid ? (
            <p className="flex items-center gap-2 text-[14px]"><CheckCircle2 className="size-5 text-tone-success" />Paid. Nothing else is due until you sign your lease.</p>
          ) : CLOSED.includes(app.stage) ? (
            <p className="text-[13.5px] text-muted-foreground">Your application is {app.stage.toLowerCase()}, so no fee is due.</p>
          ) : (
            <PayFee me={c.me} cents={APPLICATION_FEE_CENTS} property={app.property} />
          )}
        </div>
        <p className="mt-4 text-[12px] text-muted-foreground"><Link href="/portal/applicant" className="text-primary hover:underline">Back to your application status</Link></p>
      </section>
    </>
  );
}
