import "server-only";
import type { Session } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { modelInfo, usageOf } from "@/ai/providers";
import { effective } from "@/server/query";
import { AS_OF } from "@/seed/constants";
import { IMPORT_TABLES, mayCreate, recentImports } from "./server";
import type { WizardOptions } from "./ui/ImportWizard";

// What the import wizard needs from the server: today, what the role may create, portfolios to
// import into, the model (if any) and recent imports. Shared by Settings › Import and onboarding.
export async function wizardOptions(session: Session): Promise<WizardOptions> {
  const db = getPlatform().db;
  const ws = session.ws;
  const [portfolios, recent] = await Promise.all([
    db.prepare(`SELECT p.id, p.name, coalesce(o.name, p.owner_entity_id) AS owner FROM ${effective("portfolios", ws)} p LEFT JOIN ${effective("owner_entities", ws)} o ON o.id = p.owner_entity_id ORDER BY o.name, p.name LIMIT 100`).all<{ id: string; name: string; owner: string }>(),
    recentImports(db, ws),
  ]);
  const info = modelInfo();
  return {
    today: AS_OF,
    allowed: Object.fromEntries(IMPORT_TABLES.map((t) => [t, mayCreate(session.actor.role, t)])) as WizardOptions["allowed"],
    // SQLite rows have a null prototype; copy them into plain objects for the client.
    portfolios: portfolios.results.map((p) => ({ id: p.id, name: p.name, owner: p.owner })),
    ai: { available: info.provider !== "rules", label: info.label, model: info.model, centsPer1kIn: usageOf(info.model, 1000, 0, 0).costCents, centsPer1kOut: usageOf(info.model, 0, 1000, 0).costCents },
    recent: recent.map((r) => ({ ...r, created: { ...r.created } })),
  };
}
