// Narrative hygiene for AI and rules text built from facts whose keys carry units (_usd, _pct,
// _pts). Models sometimes copy the unit suffix ("5.2_pct") or leave template braces; those never
// reach the screen.

const SUFFIX = /(\d(?:[\d,]*\d)?(?:\.\d+)?)\s?_(pct|pts|usd|count)\b/g;
const TOKEN = /\{[^}]*\}|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)*_(?:pct|pts|usd|count)\b|\d_(?:pct|pts|usd|count)\b/;

export function cleanNarrative(text: string): string {
  return text.replace(SUFFIX, (_, n: string, unit: string) => (unit === "pct" ? `${n}%` : unit === "pts" ? `${n} pts` : unit === "usd" ? `$${n}` : n));
}

// True when text still holds a fact key ("delta_pct"), a unit suffix or a {placeholder}.
export const hasTokens = (text: string) => TOKEN.test(text);

// The figure check proves a number came from the facts, not that the sentence moves it the right
// way: "$4,619 decrease" passes when the fact is +4,619. These checks catch the direction.
const UP = /^(increas\w*|gain\w*|ris(e|es|ing)|rose|grow\w*|grew|higher|up|add(s|ed|ing)?|boost\w*)$/i;
const DOWN = /^(decreas\w*|declin\w*|drop\w*|fell|fall\w*|lower\w*|loss\w*|los(e|es|ing)|lost|loser|down|reduc\w*|shrink\w*|shrank|tak(e|es|ing))$/i;
// For costs, "rose" means NOI fell, so clauses about costs are left to the figure check. "Improved"
// is no direction at all: delinquency improves when it falls.
const COST = /\b(expense|opex|cost|vacancy|concession|tax|insurance|payroll|repair|utilit)/i;

export function wrongDirections(text: string, facts: Record<string, unknown>): string[] {
  const signed = Object.entries(facts).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] !== 0 && /(delta|change|effect)/.test(e[0]) && e[0].endsWith("_usd"));
  const out: string[] = [];
  for (const clause of text.split(/[;.](?=\s|$)|,\s|\s(?:and|while|but)\s/)) {
    if (COST.test(clause)) continue;
    const words = [...clause.matchAll(/[A-Za-z]+/g)].map((m) => ({ w: m[0], at: m.index! })).filter((x) => UP.test(x.w) || DOWN.test(x.w));
    for (const m of clause.matchAll(/([+\-−])?\$\s?(\d[\d,]*)(?:\.\d+)?/g)) {
      const n = Number(m[2].replace(/,/g, ""));
      const signs = new Set(signed.filter(([, v]) => Math.abs(Math.round(v)) === n).map(([, v]) => Math.sign(v)));
      if (signs.size !== 1) continue;
      const sign = [...signs][0];
      let said = m[1] ? (m[1] === "+" ? 1 : -1) : 0;
      if (!said && words.length) {
        const near = words.reduce((a, b) => (Math.abs(b.at - m.index!) < Math.abs(a.at - m.index!) ? b : a));
        said = UP.test(near.w) ? 1 : -1;
      }
      if (said && said !== sign) out.push(`${m[0].trim()} is a ${sign > 0 ? "gain" : "loss"}`);
    }
  }
  // "Top loser" for a property that gained (or "top gainer" for one that lost), when the facts rank properties.
  if (!["top_gainer", "top_loser", "holds_up_best", "gains_least"].some((k) => k in facts)) return out;
  const ranked = (kind: "gainer" | "loser") => Object.entries(facts).some(([k, v]) => k.includes(kind) && k.endsWith("_usd") && typeof v === "number" && (kind === "gainer" ? v > 0 : v < 0));
  if (/\blosers?\b|\bloses (the )?most\b/i.test(text) && !ranked("loser")) out.push("names a top loser, but no property lost");
  if (/\bgainers?\b|\bgains (the )?most\b/i.test(text) && !ranked("gainer")) out.push("names a top gainer, but no property gained");
  return out;
}
