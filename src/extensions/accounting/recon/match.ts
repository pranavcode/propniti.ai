// Bank reconciliation matching (pure). Statement lines from the bank feed are paired with ledger
// transfers on the same account: an existing transfer_id link is a match; otherwise candidates
// within $25 and 3 days are scored on amount, date and payee words, and each transfer is used at
// most once (best score first). Deposits left without a candidate scoring 0.5 are "unexplained".

export type StatementLine = { id: string; posted_on: string; description: string; amount_cents: number; transfer_id: string | null };
export type LedgerItem = { id: string; on: string; amount_cents: number; kind: string; from_name: string; to_name: string; ref: string };
export type MatchStatus = "Matched" | "Suggested" | "Unmatched";
export type LineMatch = { line: StatementLine; status: MatchStatus; transfer: LedgerItem | null; confidence: number; why: string[]; unexplained: boolean };

export const SUGGEST_FLOOR = 0.5;
const AMOUNT_TOLERANCE = 2500;
const DAY_WINDOW = 3;

const days = (a: string, b: string) => Math.round(Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86_400_000);
const STOP = new Set(["ACH", "CREDIT", "DEBIT", "THE", "AND", "LLC", "INC", "CO", "PAYMENT", "DEPOSIT", "BATCH", "TRANSFER", "OPERATING", "TRUST"]);
export const tokens = (s: string) => new Set(s.toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)));

export function score(line: StatementLine, t: LedgerItem): { confidence: number; why: string[] } | null {
  if (Math.sign(line.amount_cents) !== Math.sign(t.amount_cents)) return null;
  const diff = Math.abs(line.amount_cents - t.amount_cents);
  const dd = days(line.posted_on, t.on);
  if (diff > AMOUNT_TOLERANCE || dd > DAY_WINDOW) return null;
  const amount = diff === 0 ? 1 : 0.75 - 0.5 * (diff / AMOUNT_TOLERANCE);
  const date = 1 - dd * 0.2;
  const a = tokens(line.description);
  const b = tokens(`${t.from_name} ${t.to_name} ${t.ref}`);
  const shared = [...a].filter((x) => b.has(x)).length;
  const words = a.size ? shared / a.size : 0;
  const confidence = Math.round((0.55 * amount + 0.25 * date + 0.2 * Math.min(1, words * 1.5)) * 100) / 100;
  const why = [
    diff === 0 ? "Same amount" : `Amounts differ by $${(diff / 100).toFixed(2)}`,
    dd === 0 ? "Same day" : `${dd} day${dd === 1 ? "" : "s"} apart`,
    ...(shared ? [`Payee matches (${[...a].filter((x) => b.has(x)).slice(0, 2).join(", ").toLowerCase()})`] : []),
  ];
  return { confidence, why };
}

export function matchLines(lines: StatementLine[], ledger: LedgerItem[]): { matches: LineMatch[]; unmatchedLedger: LedgerItem[] } {
  const byId = new Map(ledger.map((t) => [t.id, t]));
  const used = new Set<string>();
  const out = new Map<string, LineMatch>();
  for (const l of lines) {
    const t = l.transfer_id ? byId.get(l.transfer_id) ?? null : null;
    if (l.transfer_id) {
      used.add(l.transfer_id);
      out.set(l.id, { line: l, status: "Matched", transfer: t, confidence: 1, why: ["Linked to the ledger transfer"], unexplained: false });
    }
  }
  const pairs: { l: StatementLine; t: LedgerItem; confidence: number; why: string[] }[] = [];
  for (const l of lines) {
    if (out.has(l.id)) continue;
    for (const t of ledger) {
      if (used.has(t.id)) continue;
      const s = score(l, t);
      if (s && s.confidence >= SUGGEST_FLOOR) pairs.push({ l, t, ...s });
    }
  }
  pairs.sort((a, b) => b.confidence - a.confidence || a.l.id.localeCompare(b.l.id));
  for (const p of pairs) {
    if (out.has(p.l.id) || used.has(p.t.id)) continue;
    used.add(p.t.id);
    out.set(p.l.id, { line: p.l, status: "Suggested", transfer: p.t, confidence: p.confidence, why: p.why, unexplained: false });
  }
  const matches = lines.map((l) => out.get(l.id) ?? { line: l, status: "Unmatched" as const, transfer: null, confidence: 0, why: [], unexplained: l.amount_cents > 0 });
  return { matches, unmatchedLedger: ledger.filter((t) => !used.has(t.id)) };
}
