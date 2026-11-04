import Link from "@/components/Link";
import { ArrowRight } from "lucide-react";
import { can } from "@/entities";
import { getPlatform } from "@/lib/platform";
import { currentSession } from "@/auth/session";
import { registerTab } from "../tabs";
import { entityInScope, periodsOf, statementOf, monthLabel } from "./statements";
import { StatementView } from "./ui/StatementView";

// Record tabs: the open statement (with Send distribution) on an owner entity, and the statement
// behind one distribution.

registerTab({
  key: "owners.statement",
  label: "Statement",
  entity: "owner_entities",
  component: async ({ id, actor }) => {
    const c = { db: getPlatform().db, ws: (await currentSession()).ws };
    if (!can(actor.role, "read", "owner_distributions") || !(await entityInScope(c, id, actor.propertyIds))) return <p className="text-[13px] text-muted-foreground">Statements for this entity are outside your access.</p>;
    const periods = await periodsOf(c, id);
    const [open, last] = await Promise.all([statementOf(c, id, periods[0].period), periods[1] ? statementOf(c, id, periods[1].period) : null]);
    const distribute = can(actor.role, "owner_entities.distribute", "owner_entities");
    const fix = can(actor.role, "owner_distributions.pay_rounding_cent", "owner_distributions");
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-muted-foreground">{periods.length - 1} closed statements. Click <span className="font-medium text-tone-ai">Explain</span> on any line to see the transfers behind it.</p>
          <Link href={`/app/owner-statements?entity=${id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">All statements<ArrowRight className="size-3.5" /></Link>
        </div>
        {open && <StatementView st={open} explainUrl="/app/owner-statements/explain" mode="staff" canDistribute={distribute} canFix={fix} />}
        {last && (
          <section aria-label={`Last closed statement, ${monthLabel(last.period)}`}>
            <h3 className="mb-2 text-[13px] font-semibold">Last closed: {monthLabel(last.period)}</h3>
            <StatementView st={last} explainUrl="/app/owner-statements/explain" mode="staff" canFix={fix} />
          </section>
        )}
      </div>
    );
  },
});

registerTab({
  key: "owners.distribution",
  label: "Statement",
  entity: "owner_distributions",
  component: async ({ row, actor }) => {
    const c = { db: getPlatform().db, ws: (await currentSession()).ws };
    const st = await statementOf(c, String(row.owner_entity_id), String(row.period));
    if (!st) return <p className="text-[13px] text-muted-foreground">This statement can&apos;t be rebuilt from the trust ledger.</p>;
    return <StatementView st={st} explainUrl="/app/owner-statements/explain" mode="staff" canFix={can(actor.role, "owner_distributions.pay_rounding_cent", "owner_distributions")} />;
  },
});
