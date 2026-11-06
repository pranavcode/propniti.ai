import "server-only";
import type { Session } from "@/auth/session";
import { ErrorBanner } from "@/components/app/states";
import { getPlatform } from "@/lib/platform";
import { BvaView } from "./BvaView";
import { bvaData, type BvaType } from "./data";

// Loads and renders budget vs actual for the page and for the budget record's tab. Explaining a
// variance is a click that posts to /api/ai/budget-explain; rendering never calls the model.
export async function Bva({ session, year, type, property }: { session: Session; year: number; type: BvaType; property: string | null }) {
  const ctx = { db: getPlatform().db, ws: session.ws, actor: session.actor };
  const data = await bvaData(ctx, { year, type, property }).catch((e) => (console.error("[bva]", e), null));
  if (!data) return <ErrorBanner title="Budget vs actual couldn't load" message="The budget or ledger query failed. Reload the page; if it keeps failing, narrow it to one property." />;
  return <BvaView data={data} />;
}
