import "server-only";
import type { Session } from "@/auth/session";
import { ErrorBanner } from "@/components/app/states";
import { getPlatform } from "@/lib/platform";
import { BvaView } from "./BvaView";
import { bvaData, explainVariance, type BvaType } from "./data";

// Loads and renders budget vs actual for the page and for the budget record's tab. `params` are
// the URL params to keep in links; on a record tab, basePath sends the links to the full page.
export async function Bva({ session, year, type, property, explain, params, basePath = "" }: { session: Session; year: number; type: BvaType; property: string | null; explain: string | null; params: Record<string, string>; basePath?: string }) {
  const ctx = { db: getPlatform().db, ws: session.ws, actor: session.actor };
  const loaded = await (async () => {
    const data = await bvaData(ctx, { year, type, property });
    return { data, explanation: explain ? await explainVariance(ctx, data, explain) : null };
  })().catch((e) => (console.error("[bva]", e), null));
  if (!loaded) return <ErrorBanner title="Budget vs actual couldn't load" message="The budget or ledger query failed. Reload the page; if it keeps failing, narrow it to one property." />;
  const href = (p: Record<string, string | null>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(p)) if (v == null) q.delete(k); else q.set(k, v);
    return `${basePath}?${q}`;
  };
  return <BvaView data={loaded.data} explanation={loaded.explanation} explainKey={loaded.explanation ? explain : null} href={href} />;
}
