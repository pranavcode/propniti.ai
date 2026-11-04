import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { formatNumber, plural } from "@/lib/format";
import { effective } from "@/server/query";
import { PageBody, PageHeader } from "@/components/app/page";
import { SetupView } from "./SetupView";

export const metadata: Metadata = { title: "Setup · Propniti" };

// Live state behind each checklist step, read from the org's data.
async function hints(ws: string | null): Promise<Record<string, string>> {
  const db = getPlatform().db;
  const count = (table: string, where = "1 = 1") => db.prepare(`SELECT count(*) AS n FROM ${effective(table, ws)} WHERE ${where}`).first<{ n: number }>().then((r) => Number(r?.n ?? 0)).catch(() => 0);
  const [org, banks, trust, props, units, staff, pending, roles, policies, rules] = await Promise.all([
    db.prepare(`SELECT name FROM ${effective("orgs", ws)} WHERE id = 'org-summit'`).first<{ name: string }>().catch(() => null),
    count("bank_accounts"), count("bank_accounts", "kind = 'Trust'"), count("properties"), count("units"),
    count("staff", "active = 1"), count("staff", "active = 0 AND last_active_at IS NULL"), count("role_assignments"),
    count("approval_policies"), count("state_rules"),
  ]);
  return {
    company: org ? `${org.name} is on file.` : "No company profile yet.",
    bank: banks ? `${plural(banks, "bank account")} on file, ${formatNumber(trust)} of them trust accounts.` : "No bank accounts connected yet.",
    import: props ? `${plural(props, "property", "properties")} and ${plural(units, "unit")} in the portfolio.` : "No properties imported yet.",
    roles: roles ? `${plural(roles, "role assignment")} across your team.` : "No roles assigned yet.",
    team: `${plural(staff, "active user")}${pending ? `, ${plural(pending, "invite")} pending` : ""}.`,
    payments: policies || rules ? `${plural(policies, "approval policy", "approval policies")} and ${plural(rules, "state rule")} set.` : "No approval policies or state rules set yet.",
  };
}

export default async function SetupPage() {
  const session = await currentSession();
  return (
    <>
      <PageHeader icon={<ListChecks />} title="Set up Propniti" description="Six steps to go live: company, bank, portfolio, roles, team and payment rules." />
      <PageBody>
        <SetupView hints={await hints(session.ws)} />
      </PageBody>
    </>
  );
}
