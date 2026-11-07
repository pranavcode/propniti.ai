import "server-only";
import { demoNowIso } from "@/lib/clock";
import { getEntity } from "@/entities";
import type { Row } from "@/entities/types";
import { computeFix } from "@/ai/rules";
import { isRunnableRule } from "@/ai/data-rules";
import { effective, forgetOverlay, type QueryCtx, type WriteCtx } from "@/server/query";
import { orgId, prefsData } from "@/extensions/settings/data";
import { mergePrefs, setupStep } from "@/extensions/settings/write";
import { canInvite } from "@/extensions/settings/nav";
import { canEditPolicies } from "@/ai/policy-editors";
import { mayCreate } from "@/extensions/import/server";
import type { Role } from "@/entities/types";
import { applyPatch, parseState, setupKeysFor, type OnboardingPatch, type OnboardingState } from "./state";
import type { Stats } from "./suggest";

// Storage and data reads behind /app/onboarding: progress in the org's settings, portfolio figures
// for the suggested limits, and the Data Health rules run over one import's records.

export async function loadState(ctx: QueryCtx): Promise<OnboardingState> {
  return parseState((await prefsData(ctx, orgId(ctx))).onboarding);
}

export async function saveState(ctx: WriteCtx, patch: OnboardingPatch): Promise<OnboardingState> {
  const before = await loadState(ctx);
  const next = applyPatch(before, patch);
  await mergePrefs(ctx, orgId(ctx), "onboarding", next as Record<string, unknown>, `Onboarding: ${patch.done?.length ? `finished ${patch.done.join(", ")}` : patch.skipped?.length ? `skipped ${patch.skipped.join(", ")}` : "progress saved"}`);
  const newly = (patch.done ?? []).filter((k) => !before.done.includes(k));
  const keys = newly.flatMap(setupKeysFor).filter((k) => setupAllowed(ctx.actor.role, k));
  if (keys.length) await ctx.db.batch(keys.map((k) => setupStep(ctx, k, "Done")));
  return next;
}

// A finished step ticks a checklist item only when the role can do that item's work; a skip-through
// by someone who can't import, set policies or add people leaves it open for someone who can.
export function setupAllowed(role: Role, key: string) {
  if (key === "import") return mayCreate(role, "properties");
  if (key === "payments") return canEditPolicies(role);
  if (key === "roles" || key === "team") return canInvite(role);
  return true;
}

const batchPattern = (batch: string) => `%-i${batch}-%`;

// Whether `batch` is an import in this workspace that hasn't been undone.
export async function liveImport(ctx: QueryCtx, batch: string): Promise<boolean> {
  if (!ctx.ws) return false;
  const r = await ctx.db.prepare("SELECT sum(action = 'import.completed') AS done, sum(action = 'import.undone') AS undone FROM audit WHERE workspace_id = ? AND entity_id = ? AND action IN ('import.completed', 'import.undone')").bind(ctx.ws, batch).first<{ done: number | null; undone: number | null }>();
  return Number(r?.done ?? 0) > Number(r?.undone ?? 0);
}

const dollars = (rows: { c: number }[]) => rows.map((r) => Number(r.c) / 100);
// About 1,000 values spread evenly over the sorted column (every k-th), so medians and percentiles
// match the whole table, plus the true count.
const SAMPLE = 1000;
const spread = (expr: string, from: string, where: string) =>
  `SELECT v AS c, n FROM (SELECT ${expr} AS v, row_number() OVER (ORDER BY ${expr}) AS rn, count(*) OVER () AS n FROM ${from} WHERE ${where}) WHERE (rn - 1) % max(1, n / ${SAMPLE}) = 0`;

// The figures the suggested limits are sized from. Units and rents come from the import when there
// is one; work orders and bills don't come over in an import, so those are the workspace's own.
// Only vendor work orders count: in-house jobs don't spend against the maintenance limit.
export async function portfolioStats(ctx: QueryCtx, s: OnboardingState): Promise<Stats> {
  const { db, ws } = ctx;
  const batch = s.import?.batch && (await liveImport(ctx, s.import.batch)) ? s.import.batch : null;
  const all = (sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).all<{ c: number; n: number }>().then((r) => r.results);
  const ACTIVE = "status IN ('Active', 'Notice', 'Month-to-month', 'Future')";
  const [importedUnits, importedRents, allUnits, allRents, workOrders, bills] = await Promise.all([
    batch ? db.prepare(`SELECT count(*) AS n FROM ${effective("units", ws)} WHERE id LIKE ?`).bind(batchPattern(batch)).first<{ n: number }>().then((r) => Number(r?.n ?? 0)) : 0,
    batch ? all(spread("rent_cents", effective("leases", ws), `id LIKE ?1 AND ${ACTIVE} AND rent_cents > 0`), batchPattern(batch)) : [],
    db.prepare(`SELECT count(*) AS n FROM ${effective("units", ws)}`).first<{ n: number }>().then((r) => Number(r?.n ?? 0)),
    all(spread("rent_cents", effective("leases", ws), `${ACTIVE} AND rent_cents > 0`)),
    all(spread("cost_cents", effective("work_orders", ws), "status IN ('Completed', 'Paid') AND vendor_id IS NOT NULL AND cost_cents > 0")),
    all(spread("amount_cents", effective("bills", ws), "amount_cents > 0")),
  ]);
  const units = importedUnits ? { units: importedUnits, unitsFrom: "import" as const } : s.company?.size ? { units: s.company.size, unitsFrom: "stated" as const } : { units: allUnits, unitsFrom: "workspace" as const };
  const rents = importedRents.length ? { rows: importedRents, rentsFrom: "import" as const } : { rows: allRents, rentsFrom: "workspace" as const };
  const total = (rows: { n: number }[]) => Number(rows[0]?.n ?? 0);
  return {
    ...units,
    workOrders: dollars(workOrders), bills: dollars(bills), rents: dollars(rents.rows), rentsFrom: rents.rentsFrom,
    counts: { workOrders: total(workOrders), bills: total(bills), rents: total(rents.rows) },
  };
}

export type CheckIssue = { id: string; rule: string; name: string; severity: string; entity: string; label: string; href: string | null; fix: string | null };
export type CheckResult = { rules: number; issues: CheckIssue[] };

const ISSUE_CAP = 50;
const label = (r: Row | null, id: string) => String(r?.name ?? r?.legal_name ?? (r?.first_name ? `${r.first_name} ${r.last_name ?? ""}`.trim() : null) ?? (r?.number ? `Unit ${r.number}` : null) ?? id);

// Runs the shipped Data Health rules (the same base rules the Data Health Agent runs) over the
// records of one import, and files what they flag as open data issues with the rule's fix when
// there is one. Issue ids are fixed per rule and record, so a second run adds nothing.
export async function runChecks(ctx: WriteCtx, batch: string): Promise<CheckResult> {
  const { db, ws } = ctx;
  const rules = (await db.prepare("SELECT id, entity_type, name, severity, check_kind, check_sql FROM data_rules WHERE workspace_id = 'base' AND deleted = 0 AND enabled = 1 LIMIT 50").all<Row>()).results.filter(isRunnableRule);
  const issues: CheckIssue[] = [];
  const at = demoNowIso(ctx.nowMs);
  const inserts = [];
  for (const r of rules) {
    if (issues.length >= ISSUE_CAP) break;
    const sql = String(r.check_sql).trim().replace(/\{\{([a-z_]+)\}\}/g, (_, t: string) => effective(t, ws));
    let ids: string[];
    try {
      ids = (await db.prepare(`SELECT id FROM (${sql}) WHERE id LIKE ? LIMIT ${ISSUE_CAP}`).bind(batchPattern(batch)).all<{ id: string }>()).results.map((x) => String(x.id));
    } catch {
      continue;
    }
    const entity = String(r.entity_type);
    const def = getEntity(entity);
    for (const id of ids.slice(0, ISSUE_CAP - issues.length)) {
      const row = def ? await db.prepare(`SELECT * FROM ${effective(entity, ws)} WHERE id = ?`).bind(id).first<Row>().catch(() => null) : null;
      const fix = row ? computeFix(String(r.id), row) : null;
      const issueId = `di-onb-${String(r.id).replace(/[^a-z0-9]+/gi, "-")}-${id}`;
      issues.push({ id: issueId, rule: String(r.id), name: String(r.name), severity: String(r.severity), entity, label: label(row, id), href: def?.route ? `${def.route}/${encodeURIComponent(id)}` : null, fix: fix?.why[0] ?? null });
      inserts.push(db.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, suggested_fix, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open') ON CONFLICT (workspace_id, id) DO NOTHING")
        .bind(ws, issueId, r.id, entity, id, entity === "properties" ? id : (row?.property_id ?? null), at, r.severity, JSON.stringify({ import_batch: batch }), fix ? JSON.stringify({ ...fix, source: "rule" }) : null));
    }
  }
  if (inserts.length) {
    await db.batch(inserts);
    forgetOverlay(ctx.actor);
  }
  return { rules: rules.length, issues };
}
