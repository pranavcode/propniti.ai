import { FIELDS, KIND_SPECS, KINDS, normHeader, similarity, synonymsOf, type FieldKey, type Kind } from "./fields";
import { PRESETS, type Preset, type ToolKey } from "./presets";

// Header → field matching without a model: the source tool's report preset first, then exact
// synonyms, then close spellings. Each match keeps where it came from and a confidence.

export type MatchSource = "preset" | "synonym" | "similar" | "ai" | "manual";
export type FieldMatch = { col: number; source: MatchSource; confidence: number; reason?: string };
export type Mapping = Partial<Record<FieldKey, FieldMatch>>;

const SIMILAR = 0.82;

export function presetScore(headers: string[], preset: Preset) {
  const have = new Set(headers.map(normHeader));
  const hits = preset.columns.filter(([h]) => have.has(normHeader(h))).length;
  // Share of the preset's columns present, weighed against stray columns in the file.
  return hits < 2 ? 0 : (hits / preset.columns.length) * 0.75 + (hits / Math.max(have.size, 1)) * 0.25;
}

export function presetMapping(headers: string[], preset: Preset): Mapping {
  const idx = new Map(headers.map((h, i) => [normHeader(h), i] as const).reverse());
  const out: Mapping = {};
  for (const [h, f] of preset.columns) {
    const col = idx.get(normHeader(h));
    if (f && col != null && !out[f]) out[f] = { col, source: "preset", confidence: 0.97, reason: `"${h}" in the ${preset.report} preset` };
  }
  return out;
}

// Fills fields of `kind` that `base` leaves empty, from columns `base` hasn't used.
export function synonymMapping(headers: string[], kind: Kind, base: Mapping = {}): Mapping {
  const out: Mapping = { ...base };
  const used = new Set(Object.values(out).map((m) => m!.col));
  const fields = KIND_SPECS[kind].fields.filter((f) => !out[f]);
  const norm = headers.map(normHeader);
  for (const f of fields) {
    const col = norm.findIndex((h, i) => !used.has(i) && synonymsOf(f).includes(h));
    if (col >= 0) { out[f] = { col, source: "synonym", confidence: 0.9, reason: `"${headers[col]}" is a usual name for ${FIELDS[f].label.toLowerCase()}` }; used.add(col); }
  }
  for (const f of fields) {
    if (out[f]) continue;
    let best = { col: -1, sim: 0 };
    norm.forEach((h, i) => {
      if (used.has(i)) return;
      const sim = Math.max(...synonymsOf(f).map((s) => similarity(h, s)));
      if (sim > best.sim) best = { col: i, sim };
    });
    if (best.sim >= SIMILAR) { out[f] = { col: best.col, source: "similar", confidence: Math.round(best.sim * 85) / 100, reason: `"${headers[best.col]}" is spelled like ${FIELDS[f].label.toLowerCase()}` }; used.add(best.col); }
  }
  return out;
}

export function missingRequired(kind: Kind, mapping: Mapping, hasDefaultProperty = false): string[] {
  return KIND_SPECS[kind].required.flatMap((r) => {
    const any = Array.isArray(r) ? r : [r];
    if (any.some((f) => mapping[f])) return [];
    if (any.includes("property") && hasDefaultProperty) return [];
    return [any.map((f) => FIELDS[f].label).join(" or ")];
  });
}

const HINTS: Partial<Record<Kind, RegExp>> = {
  vendors: /vendor|trade|1099|categor|service pro/,
  owners: /owner|management fee|ownership/,
  balances: /0 ?- ?30|31 ?- ?60|30 ?- ?60|over 90|90\+|aging|past due/,
  recurring: /charge|frequency/,
};

// Which kind a file holds: the matching preset when one fits, else the kind whose required fields
// are all found and that explains the most columns. hasSection: rows sit under property headings.
export function detect(headers: string[], tool?: ToolKey, hasSection = false): { kind: Kind; preset?: Preset; mapping: Mapping; score: number } {
  const ranked = PRESETS.map((p) => ({ p, s: presetScore(headers, p) + (p.tool === tool ? 0.05 : 0) })).sort((a, b) => b.s - a.s);
  const top = ranked[0];
  if (top && top.s >= 0.6) return { kind: top.p.kind, preset: top.p, mapping: synonymMapping(headers, top.p.kind, presetMapping(headers, top.p)), score: top.s };
  const text = headers.map(normHeader).join(" | ");
  const unitCol = headers.some((h) => /\bunit\b|\bapt\b|suite/.test(normHeader(h)));
  const scored = KINDS.map((kind) => {
    const mapping = synonymMapping(headers, kind);
    const complete = missingRequired(kind, mapping, hasSection).length === 0;
    const hint = HINTS[kind]?.test(text) && !(kind === "owners" && unitCol) ? 0.5 : 0;
    return { kind, mapping, score: (complete ? 2 : 0) + Object.keys(mapping).length / Math.max(headers.length, 1) + hint };
  }).sort((a, b) => b.score - a.score);
  return { ...scored[0]!, score: scored[0]!.score };
}
