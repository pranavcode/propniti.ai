// The data-health rules the Data Health agent runs: only shipped (base), enabled rules, at most 50,
// and of those only single read-only SELECTs. Shared with the Automations page's count.
export const RUNNABLE_RULES_SQL = "SELECT id, check_kind, check_sql FROM data_rules WHERE workspace_id = 'base' AND deleted = 0 AND enabled = 1 LIMIT 50";
export const isRunnableRule = (r: { check_kind?: unknown; check_sql?: unknown }) => {
  const q = String(r.check_sql ?? "").trim();
  return r.check_kind === "sql" && /^select\b/i.test(q) && !q.includes(";");
};
