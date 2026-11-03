import { redirect } from "next/navigation";

// Ledgers are per lease (/app/receivables/ledger/<lease>); the breadcrumb's "Ledger" lands on the
// list of residents who owe.
export default function LedgerIndex() {
  redirect("/app/receivables/delinquency");
}
