// URL filters for the Data Health page. Links across the app use the list pages' `f.<column>`
// form (?f.entity_id=l1, ?f.rule_id=…); the page also takes the short names it writes itself.
// Unknown values are dropped, long ones refused.

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

const read = (sp: Params, ...keys: string[]) => {
  for (const k of keys) {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    if (typeof v === "string" && v && v.length <= 120) return v;
  }
  return undefined;
};

export type IssueFilters = { severity?: string; rule?: string; property?: string; entity?: string; entity_id?: string; issue?: string };

export function healthFilters(sp: Params): IssueFilters {
  const f: IssueFilters = {
    severity: read(sp, "severity", "f.severity"),
    rule: read(sp, "rule", "f.rule_id"),
    property: read(sp, "property", "f.property_id"),
    entity: read(sp, "entity", "f.entity_type"),
    entity_id: read(sp, "entity_id", "f.entity_id"),
    issue: read(sp, "issue", "f.id"),
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as IssueFilters;
}
