import "server-only";
import { AS_OF } from "@/seed/constants";
import type { Db } from "@/lib/platform/types";
import { effective } from "@/server/query";
import { baseOf } from "@/server/effective";
import type { Baseline } from "./whatif";

// T12 baselines per property for the what-if simulator: the 12 closed months before the demo's
// today (meta.as_of), from the precomputed metrics_monthly rows, limited to the persona's scope.

const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

export async function t12Window(db: Db): Promise<{ from: string; to: string }> {
  const asOf = (await db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>())?.value ?? AS_OF;
  const to = addMonths(asOf.slice(0, 7), -1);
  return { from: addMonths(to, -11), to };
}

export async function loadBaselines(db: Db, ws: string | null, propertyIds: string[] | "all", only?: string[]): Promise<{ rows: Baseline[]; from: string; to: string }> {
  const { from, to } = await t12Window(db);
  const where: string[] = [];
  const binds: unknown[] = [from, to];
  if (propertyIds !== "all") {
    where.push("m.property_id IN (SELECT value FROM json_each(?))");
    binds.push(JSON.stringify(propertyIds));
  }
  if (only?.length) {
    where.push("m.property_id IN (SELECT value FROM json_each(?))");
    binds.push(JSON.stringify(only));
  }
  const res = await db.prepare(
    `SELECT m.property_id, p.name, p.metro, max(m.units) AS units, avg(m.occupancy_phys) AS occupancy,
       sum(m.gpr_cents) AS gpr_cents, sum(m.collected_cents) AS collected_cents, sum(m.vacancy_loss_cents) AS vacancy_loss_cents,
       sum(m.concessions_cents) AS concessions_cents, sum(m.opex_cents) AS opex_cents, sum(m.noi_cents) AS noi_cents
     FROM metrics_monthly m JOIN ${effective("properties", ws)} p ON p.id = m.property_id
     WHERE m.workspace_id = '${baseOf(ws)}' AND m.month BETWEEN ? AND ?${where.map((w) => ` AND ${w}`).join("")}
     GROUP BY m.property_id, p.name, p.metro ORDER BY p.name`,
  ).bind(...binds).all<Baseline>();
  const rows = res.results.map((r) => ({
    property_id: String(r.property_id), name: String(r.name), metro: String(r.metro), units: Number(r.units), occupancy: Number(r.occupancy),
    gpr_cents: Number(r.gpr_cents), collected_cents: Number(r.collected_cents), vacancy_loss_cents: Number(r.vacancy_loss_cents),
    concessions_cents: Number(r.concessions_cents), opex_cents: Number(r.opex_cents), noi_cents: Number(r.noi_cents),
  }));
  return { rows, from, to };
}
