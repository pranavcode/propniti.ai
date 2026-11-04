import { effective } from "@/server/query";
import type { Role, Row } from "@/entities/types";
import { registerMetric, type MetricCtx } from "../metrics";

// Vendors and applicants have no property scope, so owner money metrics are closed to them.
const roles: Role[] = ["platform_admin", "principal", "regional_manager", "property_manager", "broker", "accountant", "admin", "owner"];

// Owner metrics: distributions per closed month, the waterfall from income to payout, and what is
// owed now. Scope: an entity counts when any of its properties is in the actor's scope.

const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

function entityScope(ctx: MetricCtx, alias: string, col = `${alias}.owner_entity_id`) {
  if (ctx.propertyIds === "all") return { sql: "", binds: [] as unknown[] };
  return { sql: ` AND EXISTS (SELECT 1 FROM ${effective("properties", ctx.ws)} p WHERE p.owner_entity_id = ${col} AND p.id IN (SELECT value FROM json_each(?)))`, binds: [JSON.stringify(ctx.propertyIds)] };
}

async function monthlyDistributions(ctx: MetricCtx, months = 12) {
  const to = addMonths(ctx.asOf, -1);
  const from = addMonths(to, -(months - 1));
  const s = entityScope(ctx, "d");
  const { results } = await ctx.db
    .prepare(`SELECT d.period AS month, sum(d.income_cents) AS income, sum(d.expense_cents) AS expense, sum(d.fee_cents) AS fee, sum(d.reserve_cents) AS reserve, sum(d.amount_cents) AS amount, count(*) AS n
      FROM ${effective("owner_distributions", ctx.ws)} d WHERE d.period BETWEEN ? AND ?${s.sql} GROUP BY d.period ORDER BY d.period`)
    .bind(from, to, ...s.binds)
    .all<{ month: string; income: number; expense: number; fee: number; reserve: number; amount: number; n: number }>();
  return results.map((r) => ({ month: r.month, income: r.income / 100, expense: r.expense / 100, fee: r.fee / 100, reserve: r.reserve / 100, amount: r.amount / 100, statements: r.n }));
}

registerMetric({
  key: "owners.distributions",
  label: "Owner distributions",
  roles,
  run: async (ctx, params) => {
    const points = await monthlyDistributions(ctx, params.months ?? 12);
    return { value: points.at(-1)?.amount ?? null, previous: points.at(-2)?.amount ?? null, spark: points.map((p) => p.amount), points, asOf: points.at(-1)?.month, source: "owner_distributions" };
  },
});

registerMetric({
  key: "owners.waterfall",
  label: "Income to distribution",
  roles,
  run: async (ctx, params) => {
    const points = await monthlyDistributions(ctx, params.months ?? 12);
    return { value: points.at(-1)?.income ?? null, points, asOf: points.at(-1)?.month, source: "owner_distributions" };
  },
});

registerMetric({
  key: "owners.by_entity",
  label: "Distribution by entity",
  roles,
  run: async (ctx, params) => {
    const month = params.month ?? addMonths(ctx.asOf, -1);
    const s = entityScope(ctx, "d");
    const { results } = await ctx.db
      .prepare(`SELECT d.owner_entity_id, e.name, sum(d.amount_cents) AS amount FROM ${effective("owner_distributions", ctx.ws)} d JOIN ${effective("owner_entities", ctx.ws)} e ON e.id = d.owner_entity_id
        WHERE d.period = ?${s.sql} GROUP BY d.owner_entity_id ORDER BY amount DESC`)
      .bind(month, ...s.binds)
      .all<{ owner_entity_id: string; name: string; amount: number }>();
    const points: Row[] = results.map((r) => ({ owner_entity_id: r.owner_entity_id, name: r.name.replace(/, LLC$/, ""), amount: r.amount / 100 }));
    return { value: points.reduce((a, p) => a + Number(p.amount), 0), points, asOf: month, source: "owner_distributions" };
  },
});

registerMetric({
  key: "owners.owed_now",
  label: "Owed to owners now",
  roles,
  run: async (ctx) => {
    const s = entityScope(ctx, "e", "e.id");
    const t = effective("transfers", ctx.ws);
    // Same open-items rule as Lane A's ownerStatement(): everything after the entity's last payout.
    // Cutoffs are computed once per entity, then CROSS JOIN makes SQLite range-scan transfers_entity
    // (seq > cutoff) instead of scanning every transfer and re-running the cutoff per row (~100x).
    const r = await ctx.db
      .prepare(`WITH cut AS MATERIALIZED (SELECT e.id, coalesce((SELECT max(y.seq) FROM ${t} y WHERE y.owner_entity_id = e.id AND y.kind = 'Owner payout' AND y.status <> 'Returned' AND y.key NOT LIKE 'owner-adj:%'), 0) AS s
          FROM ${effective("owner_entities", ctx.ws)} e WHERE 1 = 1${s.sql})
        SELECT coalesce(sum(CASE WHEN x.kind IN ('Rent', 'Other receipt') THEN CASE WHEN x.status = 'Cleared' THEN x.amount_cents ELSE 0 END WHEN x.kind = 'Management fee' THEN CASE WHEN x.status = 'Cleared' THEN -x.amount_cents ELSE 0 END WHEN x.kind IN ('Vendor payout', 'Returned payment') THEN -x.amount_cents ELSE 0 END), 0) AS owed
        FROM cut CROSS JOIN ${t} x
        WHERE x.owner_entity_id = cut.id AND x.seq > cut.s AND x.bank_account_id = 'ba-' || cut.id || '-trust' AND x.status <> 'Returned' AND x.kind <> 'Owner payout'`)
      .bind(...s.binds)
      .first<{ owed: number }>();
    return { value: (r?.owed ?? 0) / 100, points: [], asOf: ctx.asOf, source: "transfers (open statements)" };
  },
});

registerMetric({
  key: "owners.unreconciled",
  label: "Unreconciled statements",
  roles,
  run: async (ctx) => {
    const s = entityScope(ctx, "d");
    const r = await ctx.db
      .prepare(`SELECT count(*) AS n FROM ${effective("owner_distributions", ctx.ws)} d WHERE (d.income_cents - d.expense_cents - d.fee_cents - d.reserve_cents - d.amount_cents - coalesce((SELECT a.amount_cents FROM ${effective("transfers", ctx.ws)} a WHERE a.key = 'owner-adj:' || d.id AND a.status <> 'Returned'), 0)) <> 0${s.sql}`)
      .bind(...s.binds)
      .first<{ n: number }>();
    return { value: r?.n ?? 0, points: [], asOf: ctx.asOf, source: "owner_distributions" };
  },
});
