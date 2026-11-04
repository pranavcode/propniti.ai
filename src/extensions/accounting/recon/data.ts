import type { Db } from "@/lib/platform/types";
import { effective } from "@/server/query";
import { matchLines, type LedgerItem, type LineMatch, type MatchStatus, type StatementLine } from "./match";

// Loads one reconciliation: the account's statement lines and ledger transfers for the period,
// then pairs them. Stored reconciliation_items (the reconciliation agent's work) win over the
// live suggestions; lines without an item are matched live.

const INFLOW = "('Rent', 'Deposit', 'Other receipt')";

export type ReconRow = { id: string; bank_account_id: string; account: string; period: string; status: string; statement_cents: number; book_cents: number };
export type ReconView = {
  rec: ReconRow;
  matches: (LineMatch & { itemId: string | null })[];
  unmatchedLedger: LedgerItem[];
  issues: Record<string, { id: string; severity: string }>;
  counts: Record<MatchStatus, number> & { unexplained: number };
  source: "items" | "live" | "mixed";
};

export async function loadReconciliation(db: Db, ws: string | null, id: string): Promise<ReconView | null> {
  const rec = await db
    .prepare(`SELECT r.id, r.bank_account_id, coalesce(a.name, r.bank_account_id) AS account, r.period, r.status, r.statement_balance_cents AS statement_cents, r.book_balance_cents AS book_cents
      FROM ${effective("bank_reconciliations", ws)} r LEFT JOIN ${effective("bank_accounts", ws)} a ON a.id = r.bank_account_id WHERE r.id = ?`)
    .bind(id)
    .first<ReconRow>();
  if (!rec) return null;
  const [lines, ledger, items, issues] = await Promise.all([
    db.prepare(`SELECT id, posted_on, description, amount_cents, transfer_id FROM ${effective("bank_transactions", ws)} WHERE bank_account_id = ? AND substr(posted_on, 1, 7) = ? ORDER BY posted_on, id LIMIT 2000`)
      .bind(rec.bank_account_id, rec.period).all<StatementLine>(),
    db.prepare(`SELECT id, substr(coalesce(cleared, created), 1, 10) AS "on", CASE WHEN kind IN ${INFLOW} THEN amount_cents ELSE -amount_cents END AS amount_cents, kind, from_name, to_name, ref
      FROM ${effective("transfers", ws)} WHERE bank_account_id = ? AND status <> 'Returned' AND substr(coalesce(cleared, created), 1, 7) BETWEEN ? AND ? ORDER BY "on" LIMIT 3000`)
      .bind(rec.bank_account_id, prevMonth(rec.period), rec.period).all<LedgerItem>(),
    db.prepare(`SELECT id, bank_transaction_id, transfer_id, status, confidence, note FROM ${effective("reconciliation_items", ws)} WHERE reconciliation_id = ?`)
      .bind(id).all<{ id: string; bank_transaction_id: string | null; transfer_id: string | null; status: string; confidence: number | null; note: string }>(),
    db.prepare(`SELECT id, entity_id, severity FROM ${effective("data_issues", ws)} WHERE rule_id = 'bank_transactions.unmatched_deposit' AND status = 'open' AND entity_type = 'bank_transactions'`)
      .all<{ id: string; entity_id: string; severity: string }>(),
  ]);
  const live = matchLines(lines.results, ledger.results);
  const byTransfer = new Map(ledger.results.map((t) => [t.id, t]));
  const itemByLine = new Map(items.results.filter((i) => i.bank_transaction_id).map((i) => [i.bank_transaction_id!, i]));
  const usedByItems = new Set(items.results.map((i) => i.transfer_id).filter(Boolean) as string[]);
  const matches = live.matches.map((m) => {
    const it = itemByLine.get(m.line.id);
    // A linked line stays matched even if an older item said otherwise.
    if (!it || m.status === "Matched" || it.status === "Excluded") return { ...m, itemId: it?.id ?? null };
    const t = it.transfer_id ? byTransfer.get(it.transfer_id) ?? null : null;
    const status = (["Matched", "Suggested", "Unmatched"].includes(it.status) ? it.status : "Unmatched") as MatchStatus;
    return { line: m.line, status, transfer: t, confidence: it.confidence ?? (status === "Matched" ? 1 : 0), why: it.note ? [it.note] : m.why, unexplained: status === "Unmatched" && m.line.amount_cents > 0, itemId: it.id };
  });
  // Ledger transfers in the statement month that nothing points at.
  const taken = new Set([...matches.map((m) => m.transfer?.id).filter(Boolean) as string[], ...usedByItems]);
  const unmatchedLedger = live.unmatchedLedger.filter((t) => !taken.has(t.id) && t.on.slice(0, 7) === rec.period);
  const counts = { Matched: 0, Suggested: 0, Unmatched: 0, unexplained: 0 };
  for (const m of matches) {
    counts[m.status]++;
    if (m.unexplained) counts.unexplained++;
  }
  return {
    rec, matches, unmatchedLedger, counts,
    issues: Object.fromEntries(issues.results.map((i) => [i.entity_id, { id: i.id, severity: i.severity }])),
    source: items.results.length === 0 ? "live" : itemByLine.size >= lines.results.length ? "items" : "mixed",
  };
}

function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}
