import type { Metadata } from "next";
import "@/entities";
import { currentSession } from "@/auth/session";
import { EmptyState } from "@/components/app/states";
import { FinanceHome } from "@/extensions/payables/home/FinanceHome";

export const metadata: Metadata = { title: "Finance · Propniti" };

const ROLES = new Set(["principal", "regional_manager", "accountant"]);

// Finance overview and the accountant's home (Grace Kim).
export default async function FinancePage() {
  const session = await currentSession();
  if (!ROLES.has(session.actor.role)) {
    return <main className="p-6"><EmptyState kind="chart" title="Finance overview isn't part of your role" description="Switch role from your avatar menu to see this page as an accountant or principal." action={{ label: "Go to your home", href: "/app" }} /></main>;
  }
  return <FinanceHome session={session} />;
}
