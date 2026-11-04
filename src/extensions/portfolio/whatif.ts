// What-if scenario engine (addendum 3, pillar 4). Pure and integer-cents, so the browser simulator
// and the server-side narrative compute the same numbers from the same T12 baseline.

export type Baseline = {
  property_id: string;
  name: string;
  metro: string;
  units: number;
  occupancy: number;            // average physical occupancy over the T12, 0–1
  gpr_cents: number;
  collected_cents: number;
  vacancy_loss_cents: number;
  concessions_cents: number;
  opex_cents: number;
  noi_cents: number;
};

export type Levers = {
  rentPct: number;              // change to in-place rent, e.g. 3 = +3%
  opexPct: number;              // change to operating expenses
  occTarget: number | null;     // absolute physical occupancy target in percent (e.g. 95); wins over occDeltaPts
  occDeltaPts: number;          // occupancy change in points when there is no target
};

export const NO_CHANGE: Levers = { rentPct: 0, opexPct: 0, occTarget: null, occDeltaPts: 0 };

export type Result = {
  property_id: string;
  name: string;
  metro: string;
  occupancy: number;
  scenario_occupancy: number;
  revenue_cents: number;
  scenario_revenue_cents: number;
  opex_cents: number;
  scenario_opex_cents: number;
  noi_cents: number;
  scenario_noi_cents: number;
  delta_cents: number;
  delta_pct: number | null;     // percent, e.g. 4.2
  margin: number | null;        // scenario NOI / scenario revenue, 0–1
  break_even_occupancy: number | null; // occupancy where scenario NOI is zero, 0–1 (null when not reachable)
};

export type Totals = Omit<Result, "property_id" | "name" | "metro"> & { properties: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Revenue is the T12 cash collected. It moves with rent and with occupancy relative to the baseline,
// so the baseline's collection rate, fee income and concessions carry through unchanged:
//   scenario revenue = collected × (1 + rent%) × (scenario occupancy ÷ baseline occupancy)
//   scenario opex    = opex × (1 + opex%)
//   scenario NOI     = scenario revenue − scenario opex + other (baseline NOI − (collected − opex))
// "Other" keeps any income or expense in the reported NOI that isn't collected rent or opex.
export function simulate(b: Baseline, l: Levers): Result {
  const occ = b.occupancy;
  const target = clamp(l.occTarget != null ? l.occTarget / 100 : occ + l.occDeltaPts / 100, 0, 1);
  const occFactor = occ > 0 ? target / occ : 0;
  const rent = 1 + l.rentPct / 100;
  const other = b.noi_cents - (b.collected_cents - b.opex_cents);
  const revenue = Math.round(b.collected_cents * rent * occFactor);
  const opex = Math.round(b.opex_cents * (1 + l.opexPct / 100));
  const noi = revenue - opex + other;
  const delta = noi - b.noi_cents;
  // NOI is linear in occupancy, so solve revenue(x) − opex + other = 0 for x.
  const perOcc = occ > 0 ? (b.collected_cents * rent) / occ : 0;
  const be = perOcc > 0 ? (opex - other) / perOcc : null;
  return {
    property_id: b.property_id, name: b.name, metro: b.metro,
    occupancy: occ, scenario_occupancy: target,
    revenue_cents: b.collected_cents, scenario_revenue_cents: revenue,
    opex_cents: b.opex_cents, scenario_opex_cents: opex,
    noi_cents: b.noi_cents, scenario_noi_cents: noi,
    delta_cents: delta,
    delta_pct: b.noi_cents ? Math.round((delta / Math.abs(b.noi_cents)) * 1000) / 10 : null,
    margin: revenue ? noi / revenue : null,
    break_even_occupancy: be != null && be >= 0 && be <= 1 ? be : null,
  };
}

export function simulateAll(baselines: Baseline[], l: Levers): { rows: Result[]; totals: Totals } {
  const rows = baselines.map((b) => simulate(b, l));
  const sum = (k: keyof Result) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const units = baselines.reduce((s, b) => s + b.units, 0);
  const wOcc = (k: "occupancy" | "scenario_occupancy") => (units ? rows.reduce((s, r, i) => s + r[k] * baselines[i].units, 0) / units : 0);
  const noi = sum("noi_cents");
  const scenario = sum("scenario_noi_cents");
  const revenue = sum("scenario_revenue_cents");
  const opex = sum("scenario_opex_cents");
  const other = noi - (sum("revenue_cents") - sum("opex_cents"));
  const occ = wOcc("occupancy");
  const perOcc = occ > 0 ? (sum("revenue_cents") * (1 + l.rentPct / 100)) / occ : 0;
  const be = perOcc > 0 ? (opex - other) / perOcc : null;
  return {
    rows,
    totals: {
      properties: rows.length,
      occupancy: occ, scenario_occupancy: wOcc("scenario_occupancy"),
      revenue_cents: sum("revenue_cents"), scenario_revenue_cents: revenue,
      opex_cents: sum("opex_cents"), scenario_opex_cents: opex,
      noi_cents: noi, scenario_noi_cents: scenario, delta_cents: scenario - noi,
      delta_pct: noi ? Math.round(((scenario - noi) / Math.abs(noi)) * 1000) / 10 : null,
      margin: revenue ? scenario / revenue : null,
      break_even_occupancy: be != null && be >= 0 && be <= 1 ? be : null,
    },
  };
}
