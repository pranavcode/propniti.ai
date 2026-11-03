// Renewal pricing rules (pure, shared by the seed, the renewals page and its agent run).
// The rent moves toward the unit type's market rent, capped so good residents aren't pushed out:
// a turnover costs about a month of vacancy plus make-ready, which a small raise rarely recovers.

export type RenewalInput = {
  currentCents: number;
  marketCents: number | null;   // unit type market rent (the comp)
  tenureMonths: number;
  late12: number;               // late payments in the last 12 months
  nsf12: number;                // returned payments in the last 12 months
  balanceCents: number;         // open balance today
};

export type Reason = { direction: "+" | "-" | "="; text: string };
export type RenewalProposal = { rentCents: number; changePct: number; capPct: number; reasons: Reason[]; confidence: number; needsPerson: boolean };

export const MAKE_READY_CENTS = 100_000; // typical make-ready per turn, used only for the turnover estimate
const roundTo5 = (c: number) => Math.round(c / 500) * 500;
export const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function proposeRenewal(i: RenewalInput): RenewalProposal {
  const reasons: Reason[] = [];
  const cur = i.currentCents;
  const loyal = i.tenureMonths >= 24 && i.late12 === 0 && i.nsf12 === 0;
  const capPct = loyal ? 3 : 5;
  let rent = cur;
  if (i.marketCents == null) {
    reasons.push({ direction: "=", text: "No market rent on file for this unit type, so the rent holds flat" });
  } else if (i.marketCents <= cur) {
    reasons.push({ direction: "=", text: `Market rent for this unit type is ${dollars(i.marketCents)}, at or below the current ${dollars(cur)}: hold flat` });
  } else {
    rent = Math.max(cur, Math.min(i.marketCents, roundTo5((cur * (100 + capPct)) / 100)));
    const gapPct = ((i.marketCents - cur) / cur) * 100;
    reasons.push({ direction: "+", text: `Current rent is ${gapPct.toFixed(1)}% under the ${dollars(i.marketCents)} market rent for this unit type` });
    if (rent < i.marketCents) reasons.push({ direction: "-", text: `Increase capped at ${capPct}%${loyal ? " for a long, on-time resident" : ""}, so the offer stays below market` });
  }
  if (i.tenureMonths >= 24) reasons.push({ direction: loyal ? "-" : "=", text: `Has lived here ${Math.floor(i.tenureMonths / 12)} years${loyal ? "; keeping them avoids a turnover" : ""}` });
  else reasons.push({ direction: "=", text: `${i.tenureMonths} months in the unit` });
  if (i.late12 === 0 && i.nsf12 === 0) reasons.push({ direction: "+", text: "Paid on time every month in the last 12" });
  else reasons.push({ direction: "-", text: `${i.late12} late payment${i.late12 === 1 ? "" : "s"}${i.nsf12 ? ` and ${i.nsf12} returned payment${i.nsf12 === 1 ? "" : "s"}` : ""} in the last 12 months` });
  if (i.balanceCents > 0) reasons.push({ direction: "-", text: `Open balance of ${dollars(i.balanceCents)}: a person should confirm before offering` });
  const turnover = (i.marketCents ?? cur) + MAKE_READY_CENTS;
  reasons.push({ direction: "=", text: `A turnover would cost about ${dollars(turnover)} (a month vacant plus make-ready, estimated)` });

  let confidence = 0.86;
  if (i.marketCents == null) confidence -= 0.15;
  if (i.balanceCents > 0) confidence -= 0.2;
  if (i.late12 >= 3 || i.nsf12 > 0) confidence -= 0.1;
  return { rentCents: rent, changePct: Math.round(((rent - cur) / cur) * 1000) / 10, capPct, reasons, confidence: Math.round(confidence * 100) / 100, needsPerson: i.balanceCents > 0 };
}
