import type { Row } from "@/entities/types";
import { fixProposal } from "../tools/write";
import { defineAgent, type Candidate } from "./framework";

// Detects and fixes data problems. Detection re-runs each enabled SQL rule (read-only) and reports
// how many records it flags; fixes come from data_issues.suggested_fix, filled in by the helpers
// below when the rule left it empty. Safe fixes (formatting, typos) can auto-apply within policy;
// money, fraud and legal fixes always go to a person.

const SUFFIX: Record<string, string> = { STREET: "St", ST: "St", AVENUE: "Ave", AVE: "Ave", BOULEVARD: "Blvd", BLVD: "Blvd", DRIVE: "Dr", DR: "Dr", ROAD: "Rd", RD: "Rd", LANE: "Ln", LN: "Ln", PARKWAY: "Pkwy", PKWY: "Pkwy", COURT: "Ct", CT: "Ct", PLACE: "Pl", PL: "Pl", HIGHWAY: "Hwy", HWY: "Hwy", TRAIL: "Trl", CIRCLE: "Cir" };
const DIR: Record<string, string> = { NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", N: "N", S: "S", E: "E", W: "W" };

// USPS-style street line: title case, standard suffix and direction abbreviations, no trailing period.
export function normalizeStreet(s: string) {
  return s
    .replace(/[.,]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w, i, all) => {
      const u = w.toUpperCase();
      if (i === all.length - 1 && SUFFIX[u]) return SUFFIX[u];
      if (DIR[u] && (i === 1 || i === all.length - 1)) return DIR[u];
      if (/^\d/.test(w)) return u;
      return u.charAt(0) + u.slice(1).toLowerCase();
    })
    .join(" ");
}

const PHONE = /^\+?1?[\s.-]?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})$/;
export function phoneInEmail(email: string) {
  const m = email.trim().match(PHONE);
  return m ? { phone: `(${m[1]}) ${m[2]}-${m[3]}`, email: "" } : null;
}

const METRO_STATE: Record<string, string> = { Austin: "TX", Dallas: "TX", Atlanta: "GA", Phoenix: "AZ" };

// Fills a fix the rule didn't supply, from the record itself. Returns null when a person must decide.
export function computeFix(rule: string, row: Row): { changes: Record<string, unknown>; why: string[]; confidence: number } | null {
  if (rule === "properties.address_format" && typeof row.street === "string") {
    const street = normalizeStreet(row.street);
    return street !== row.street ? { changes: { street }, why: [`"${row.street}" → "${street}" (USPS style)`], confidence: 0.95 } : null;
  }
  if (rule === "residents.phone_in_email" && typeof row.email === "string") {
    const f = phoneInEmail(row.email);
    return f ? { changes: { phone: row.phone || f.phone, email: f.email }, why: [`The email field holds a phone number (${row.email}); move it to phone and ask the resident for an email`], confidence: 0.93 } : null;
  }
  if (rule === "properties.missing_zip_state" && !row.state && typeof row.metro === "string" && METRO_STATE[row.metro]) {
    return { changes: { state: METRO_STATE[row.metro] }, why: [`${row.metro} properties are in ${METRO_STATE[row.metro]}`], confidence: 0.9 };
  }
  if (rule === "leases.end_before_start" && typeof row.start_on === "string" && typeof row.end_on === "string" && row.end_on < row.start_on) {
    const months = Number(row.term_months ?? 12);
    const d = new Date(row.start_on + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + months);
    d.setUTCDate(d.getUTCDate() - 1);
    return { changes: { end_on: d.toISOString().slice(0, 10) }, why: [`End date ${row.end_on} is before the start ${row.start_on}; set it to start + ${months} months`], confidence: 0.85 };
  }
  return null;
}

const SEVERITY: Record<string, number> = { critical: 3, warn: 2, info: 1 };

export default defineAgent({
  key: "data_health",
  name: "Data Health agent",
  ownerRole: "admin",
  goal: "Find bad data before owners or auditors do: re-check the data rules, then propose a fix for each open issue with before/after, a reason and a confidence. Merge duplicates, recode miscoded bills and normalize contact details and addresses.",
  tools: ["data.issues", "records.get", "records.search", "data.propose_fix"],
  triggers: { schedule: "0 6 * * *", events: ["data_issue.detected", "import.completed"] },
  autonomy: "act_with_approval",
  entities: ["data_issues", "data_rules"],
  actions: ["data_issues.apply_fix"],
  maxProposals: 12,
  async collect(ctx) {
    // Detection: each SQL rule is a read-only SELECT returning offending ids.
    // Only the shipped rules (base rows) run their SQL; overlay edits can't inject a query.
    const rules = { rows: (await ctx.db.prepare("SELECT id, check_kind, check_sql FROM data_rules WHERE workspace_id = 'base' AND deleted = 0 AND enabled = 1 LIMIT 50").all<Row>()).results };
    const counts: Record<string, number | string> = {};
    for (const r of rules.rows) {
      const q = String(r.check_sql ?? "").trim();
      if (r.check_kind !== "sql" || !/^select\b/i.test(q) || q.includes(";")) continue;
      try {
        const { results } = await ctx.db.prepare(`SELECT count(*) AS n FROM (${q})`).all<{ n: number }>();
        counts[String(r.id)] = results[0]?.n ?? 0;
      } catch {
        counts[String(r.id)] = "check failed";
      }
    }
    await ctx.step({ kind: "reasoning_summary", output: { rule_checks: counts }, ok: true });

    const open = await ctx.call<{ rows: Row[]; total: number }>("data.issues", { status: "open", size: 50 });
    const out: Candidate[] = [];
    for (const issue of open.rows) {
      let fix = issue.suggested_fix as Record<string, unknown> | null;
      if (!fix || (!fix.changes && !fix.action && !fix.merge_into)) {
        const table = String(issue.entity_type);
        const row = await ctx.call<Row>("records.get", { entity: table, id: String(issue.entity_id) }).catch(() => null);
        const computed = row ? computeFix(String(issue.rule_id), row) : null;
        if (!computed) continue;
        fix = { ...computed, source: "data_health" };
      }
      const p = fixProposal({ ...issue, suggested_fix: JSON.stringify(fix), evidence: JSON.stringify(issue.evidence ?? {}) });
      const { effects, ...extra } = p.payload as { effects: Record<string, unknown>[] };
      out.push({
        ...p, extra, facts: { rule: String(issue.rule_id), severity: String(issue.severity), entity: String(issue.entity_type), record: String(issue.entity_id) },
        effects, mandatory: p.alwaysHuman, priority: (SEVERITY[String(issue.severity)] ?? 1) * 1000 + Math.round((p.confidence ?? 0) * 100),
      });
    }
    return out;
  },
});
