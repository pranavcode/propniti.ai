import "server-only";
import type { Row } from "@/entities/types";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { effective } from "@/server/query";
import { formatDate, formatMoney } from "@/lib/format";
import { EmptyState } from "@/components/app/states";
import { registerTab } from "../tabs";
import { checkFairHousing, NEVER_SCORED } from "./fairHousing";
import { APPROVERS } from "./pipeline";
import { ListingEditor, type EditorData } from "./ui/ListingEditor";
import { ScoringPanel, type Factor, type ScoringData } from "./ui/ScoringPanel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Custom record tabs: the application's AI scoring and decision, the listing editor and the
// listing's price history. Each reads the visitor's overlay over the base (their workspace).

const LEASING_WRITERS = ["principal", "regional_manager", "property_manager", "leasing_agent", "broker"];
const json = <T,>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  if (typeof v !== "string") return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};

async function ctx() {
  const s = await currentSession();
  return { db: getPlatform().db, ws: s.ws, s };
}

registerTab({
  key: "leasing.scoring",
  label: "AI scoring",
  entity: "applications",
  // Shows the screening summary, so the same need-to-know roles as the Screening tab.
  roles: ["principal", "regional_manager", "property_manager", "leasing_agent", "broker", "platform_admin"],
  component: async ({ id, row, actor }) => {
    const { db, ws } = await ctx();
    const E = (t: string) => effective(t, ws);
    const [app, screening, proposal, log] = await Promise.all([
      db.prepare(`SELECT a.*, ap.first_name, ap.last_name, ap.employer, ap.monthly_income_cents, (SELECT coalesce(sum(c.monthly_income_cents), 0) FROM ${E("applicants")} c WHERE c.id IN (SELECT value FROM json_each(a.co_applicants))) AS co_income, (SELECT name FROM ${E("staff")} st WHERE st.id = a.decided_by) AS decider FROM ${E("applications")} a JOIN ${E("applicants")} ap ON ap.id = a.applicant_id WHERE a.id = ?`).bind(id).first<Row>(),
      db.prepare(`SELECT * FROM ${E("screening_results")} WHERE application_id = ? ORDER BY completed_at DESC LIMIT 1`).bind(id).first<Row>(),
      db.prepare(`SELECT p.*, (SELECT d.decision FROM ${E("ai_decisions")} d WHERE d.proposal_id = p.id LIMIT 1) AS decision FROM ${E("ai_proposals")} p WHERE p.entity_type = 'applications' AND p.entity_id = ? AND p.agent = 'leasing' ORDER BY p.created_at DESC LIMIT 1`).bind(id).first<Row>(),
      db.prepare(`SELECT id, at, summary, actor_kind FROM ${E("activity_events")} WHERE entity_type = 'applications' AND entity_id = ? ORDER BY at DESC LIMIT 12`).bind(id).all<Row>(),
    ]);
    if (!app) return <EmptyState compact title="This application couldn't load" />;
    const payload = json<{ facts?: { score?: number; recommendation?: string }; summary?: string }>(proposal?.payload, {});
    const stored = json<Factor[]>(app.scoring_factors, []);
    // Proposals from the scheduled agent run carry their reasons as "For: …" / "Against: …".
    const fromWhy = json<string[]>(proposal?.why, []).filter((w) => /^(For|Against): /.test(w)).map((w): Factor => ({ factor: w.startsWith("For") ? "Reason for" : "Reason against", direction: w.startsWith("For") ? "+" : "-", weight: 0, detail: w.replace(/^(For|Against): /, "") }));
    const titled = /score (\d+)/.exec(String(proposal?.title ?? ""));
    const score = app.score != null ? Number(app.score) : payload.facts?.score ?? (titled ? Number(titled[1]) : null);
    const income = Number(app.monthly_income_cents ?? 0) + Number(app.co_income ?? 0);
    const open = ["Started", "Submitted", "Screening", "Review"].includes(String(app.stage));
    const data: ScoringData = {
      appId: id, stage: String(app.stage), open,
      applicant: { name: `${app.first_name} ${app.last_name}`, href: `/app/leasing/applicants/${app.applicant_id}`, employer: String(app.employer ?? ""), income: income ? income / 100 : null, coApplicants: json<string[]>(app.co_applicants, []).length },
      rent: app.rent_cents == null ? null : Number(app.rent_cents) / 100,
      ratio: app.rent_cents && income ? income / Number(app.rent_cents) : app.income_to_rent == null ? null : Number(app.income_to_rent),
      screening: screening ? { decision: String(screening.decision), credit_band: (screening.credit_band as string) ?? null, eviction_found: !!screening.eviction_found, income_verified: !!screening.income_verified, criminal_flag: !!screening.criminal_flag, completed_at: (screening.completed_at as string) ?? null } : null,
      score,
      recommendation: (app.recommendation as string) ?? payload.facts?.recommendation ?? null,
      factors: stored.length ? stored : fromWhy,
      summary: payload.summary ?? null,
      confidence: proposal ? Number(proposal.confidence) : null,
      source: !proposal?.model || proposal.model === "rules" ? "rules" : "precomputed",
      model: (proposal?.model as string) ?? null,
      runId: (proposal?.run_id as string) ?? null,
      scoredAt: (proposal?.created_at as string) ?? null,
      decidedBy: (app.decider as string) ?? (app.decided_by as string) ?? null,
      decidedAt: (app.decided_at as string) ?? null,
      canDecide: APPROVERS.includes(actor.role),
      canScore: LEASING_WRITERS.includes(actor.role),
      neverScored: NEVER_SCORED,
      log: log.results.map((l) => ({ id: String(l.id), at: String(l.at), summary: String(l.summary), agent: l.actor_kind === "agent" })),
    };
    void row;
    return <ScoringPanel data={data} />;
  },
});

registerTab({
  key: "leasing.listing_editor",
  label: "Editor",
  entity: "listings",
  component: async ({ id, row, actor }) => {
    const { db, ws } = await ctx();
    const E = (t: string) => effective(t, ws);
    const d = await db.prepare(`SELECT l.*, u.number, ut.photos AS type_photos, ut.name AS type_name, p.name AS property, p.photos AS property_photos FROM ${E("listings")} l JOIN ${E("units")} u ON u.id = l.unit_id LEFT JOIN ${E("unit_types")} ut ON ut.id = u.unit_type_id JOIN ${E("properties")} p ON p.id = l.property_id WHERE l.id = ?`).bind(id).first<Row>();
    if (!d) return <EmptyState compact title="This listing couldn't load" />;
    const photos = json<string[]>(d.photos, []);
    const library = [...new Set([...json<string[]>(d.type_photos, []), ...json<string[]>(d.property_photos, []), ...photos])];
    const data: EditorData = {
      id, status: String(d.status), headline: String(d.headline ?? ""), description: String(d.description ?? ""), photos, library,
      syndication: json<Record<string, string>>(d.syndication, {}), rent: Number(d.rent_cents) / 100, property: String(d.property), unit: String(d.number), typeName: String(d.type_name ?? ""),
      canEdit: LEASING_WRITERS.includes(actor.role), flags: checkFairHousing(`${d.headline ?? ""} ${d.description ?? ""}`),
    };
    void row;
    return <ListingEditor data={data} />;
  },
});

registerTab({
  key: "leasing.price_history",
  label: "Price history",
  entity: "listings",
  component: async ({ id }) => {
    const { db, ws } = await ctx();
    const res = await db.prepare(`SELECT * FROM ${effective("listing_price_history", ws)} WHERE listing_id = ? ORDER BY changed_on DESC, seq DESC LIMIT 50`).bind(id).all<Row>();
    const rows = res.results;
    if (!rows.length) return <EmptyState compact title="No price changes yet" description="Every change to the asking rent is kept here with the reason." />;
    return (
      <div className="rounded-lg border"><Table className="text-[13px]">
        <TableHeader className="bg-muted/40 text-[12px]">
          <TableRow><TableHead className="px-3 py-2 font-medium">Date</TableHead><TableHead className="px-3 py-2 text-right font-medium">Asking rent</TableHead><TableHead className="px-3 py-2 text-right font-medium">Change</TableHead><TableHead className="px-3 py-2 font-medium">Reason</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const prev = rows[i + 1];
            const delta = prev ? Number(r.rent_cents) - Number(prev.rent_cents) : null;
            return (
              <TableRow key={String(r.id)}>
                <TableCell className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDate(String(r.changed_on), "always")}</TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">{formatMoney(Number(r.rent_cents) / 100, "whole")}</TableCell>
                <TableCell className={delta == null ? "px-3 py-2 text-right text-muted-foreground" : delta < 0 ? "px-3 py-2 text-right text-tone-danger tabular-nums" : "px-3 py-2 text-right text-tone-success tabular-nums"}>{delta == null ? "First listed" : `${delta < 0 ? "−" : "+"}${formatMoney(Math.abs(delta) / 100, "whole")}`}</TableCell>
                <TableCell className="px-3 py-2 text-muted-foreground">{String(r.reason || "—")}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table></div>
    );
  },
});
