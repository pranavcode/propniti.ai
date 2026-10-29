import type { Db, DbStatement } from "@/lib/platform/types";
import { seed } from "@/lib/seed";
import { insertItems } from "./repo";

// The demo's starting data as insert statements for one workspace, parents before children.
// OR IGNORE makes a clone that races another clone of the same workspace a no-op.
export function seedStatements(db: Db, ws: string): DbStatement[] {
  const s = seed();
  return [
    insertItems(db, "users", ws, s.users, true),
    insertItems(db, "properties", ws, s.properties, true),
    insertItems(db, "vendors", ws, s.vendors, true),
    insertItems(db, "tenancies", ws, s.tenancies, true),
    insertItems(db, "invoices", ws, s.invoices, true),
    insertItems(db, "work_orders", ws, s.workOrders, true),
    insertItems(db, "transfers", ws, s.transfers, true),
    insertItems(db, "ratings", ws, s.ratings, true),
    insertItems(db, "notifications", ws, s.notifications, true),
    insertItems(db, "audit", ws, s.audit, true),
  ];
}
