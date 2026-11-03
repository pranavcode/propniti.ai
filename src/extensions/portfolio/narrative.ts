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
